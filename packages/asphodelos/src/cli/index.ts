import path, { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { Console, Effect, FileSystem, Option, Schema, Stream } from 'effect'
import type { PlatformError } from 'effect'
import { Argument, CliError, Command, Flag } from 'effect/unstable/cli'

const COMMAND_NAME = 'asphodelos'

/** Config file `asphodelos` picks up from the working directory when `--config` is omitted. */
const DEFAULT_CONFIG_FILE = 'asphodelos.config.ts'

/** Extensions a change has to carry to be worth regenerating for. */
const INPUT_EXTENSIONS = ['.yaml', '.json', '.tsp'] as const

// `Schema.refine` both rejects the value at runtime and narrows the parsed type, so a wrong
// extension never reaches the generators and the ones that do arrive as `${string}.ts` without a
// cast. The template literal alone would do the same check but reports "Expected a string
// matching template literal parts"; wrapping it in `Schema.is` and refining with it is what buys
// the sentence below.
const DocumentPathSchema = Schema.String.pipe(
  Schema.refine(
    Schema.is(Schema.TemplateLiteral([Schema.String, Schema.Literals(INPUT_EXTENSIONS)])),
    { message: 'an OpenAPI (.yaml, .json) or TypeSpec (.tsp) document' },
  ),
)

const TypeScriptPathSchema = Schema.String.pipe(
  Schema.refine(Schema.is(Schema.TemplateLiteral([Schema.String, '.ts'])), {
    message: 'a TypeScript file path ending in .ts',
  }),
)

/**
 * The command line itself: what `asphodelos` accepts, what each piece means, and the schema every
 * value is decoded through before {@link generate} ever sees it.
 */
const commandLine = {
  input: Argument.file('input', { mustExist: true }).pipe(
    Argument.withSchema(DocumentPathSchema),
    Argument.withDescription('OpenAPI (.yaml, .json) or TypeSpec (.tsp) document to generate from'),
    Argument.withMetavar('input.{yaml,json,tsp}'),
    Argument.optional,
  ),
  // `Flag.string`, not `Flag.file`: the file primitive rewrites its value to an absolute path, and
  // `--output` is echoed back in the "Generated … → " message, which should read as the path the
  // caller typed.
  output: Flag.string('output').pipe(
    Flag.withAlias('o'),
    Flag.withSchema(TypeScriptPathSchema),
    Flag.withDescription('TypeScript file the generated app is written to'),
    Flag.withMetavar('output.ts'),
    Flag.optional,
  ),
  config: Flag.file('config', { mustExist: true }).pipe(
    Flag.withAlias('c'),
    Flag.withDescription(`Config file to run (default: ./${DEFAULT_CONFIG_FILE})`),
    Flag.withMetavar('file'),
    Flag.optional,
  ),
  // `Flag.boolean` is still a required flag until it is given a default — without this, every
  // invocation is rejected for not passing `--watch`.
  watch: Flag.boolean('watch').pipe(
    Flag.withAlias('w'),
    Flag.withDescription('Rerun the config on every change to its documents or itself'),
    Flag.withDefault(false),
  ),
} as const

/**
 * One pass over a config file: read it, parse the document it names, and run every generator it
 * opts into.
 *
 * `reload` is for the passes after the first, where the config file may have been edited since it
 * was imported.
 *
 * The generator pipeline pulls in the OpenAPI parser, the TypeSpec compiler and ts-morph.
 * `--help`, `--version`, `--completions` and every rejected command line must not pay for that,
 * so it is loaded here rather than at module scope. After the first pass the loader answers from
 * cache, so a watch tick pays nothing.
 */
function runConfigPass(configPath: string, reload: boolean) {
  return Effect.gen(function* () {
    const [{ readConfig }, { parseOpenAPI }, { FormatOptions }, { makeJob }] =
      yield* Effect.promise(() =>
        Promise.all([
          import('../config/index.js'),
          import('../openapi/index.js'),
          import('../format/index.js'),
          import('../shared/index.js'),
        ]),
      )
    const config = yield* readConfig(configPath, reload)
    const openAPI = yield* parseOpenAPI(config.input)
    const messages = yield* Effect.all(
      makeJob(openAPI, config).map((job) => job.run(job.output)),
      { concurrency: 'unbounded' },
    ).pipe(Effect.provideService(FormatOptions, config.format ?? {}))
    return { config, report: messages.filter((message) => message !== '').join('\n') }
  })
}

/**
 * A pass whose failure is printed rather than raised, so the watch loop survives it, and which
 * answers with the input directory the config now names.
 *
 * `undefined` means the pass did not get far enough to say — the config is missing, will not
 * import, or does not validate. The loop keeps watching the config either way.
 */
function reportConfigPass(configPath: string, reload: boolean) {
  return Effect.gen(function* () {
    const result = yield* Effect.result(runConfigPass(configPath, reload))
    if (result._tag === 'Failure') {
      yield* Console.error(`❌ ${result.failure.message}`)
      return undefined
    }
    yield* Console.log(result.success.report)
    // Where the documents named by the config live, which is the directory worth watching.
    return path.dirname(resolve(process.cwd(), result.success.config.input))
  })
}

/**
 * Waits for the first change worth regenerating for.
 *
 * `runHead` is what ends the wait: it takes the first change that survives the filter and the
 * debounce, then tears the stream down, so the next round can watch wherever the reloaded config
 * points. Changes are debounced because one save is several filesystem events — an editor writes,
 * renames and touches — and a round per event would race itself.
 *
 * `WatchEvent.path` is relative to the directory it came from, which is why each stream is
 * filtered after being resolved back to an absolute path.
 */
function awaitChange(configPath: string, inputDirectory: string | undefined) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const directories = [
      path.dirname(configPath),
      ...(inputDirectory === undefined ? [] : [inputDirectory]),
    ].filter((directory, index, all) => all.indexOf(directory) === index)

    const stream = directories
      .map((directory) =>
        Stream.map(fs.watch(directory), (event) => path.resolve(directory, event.path)),
      )
      .reduce((merged, next) => Stream.merge(merged, next))

    yield* Stream.runHead(
      Stream.debounce(
        Stream.filter(
          stream,
          (changed) =>
            changed === configPath ||
            INPUT_EXTENSIONS.some((extension) => changed.endsWith(extension)),
        ),
        '200 millis',
      ),
    )
  })
}

/**
 * Regenerates on every change to the input documents or the config, until interrupted.
 *
 * Two things can invalidate the output, so both are watched: the config file, and the directory
 * the document it names lives in — a TypeSpec entry imports its siblings and a `$ref` can point
 * at one, so the file named by `input` is rarely the only one that matters. The config file is
 * watched through its directory rather than directly, so an editor that saves by renaming does
 * not take the watcher down with it.
 *
 * Recursive rather than a loop because the directory to watch comes from the config, and the
 * config is re-read every round: an edit that repoints `input` elsewhere has to move the watcher
 * with it, which means new streams rather than new values.
 */
function watchConfig(
  configPath: string,
  inputDirectory: string | undefined,
): Effect.Effect<never, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    yield* Console.log(
      inputDirectory === undefined
        ? `\n👀 Watching ${configPath} — Ctrl-C to stop`
        : `\n👀 Watching ${inputDirectory} and ${configPath} — Ctrl-C to stop`,
    )
    yield* awaitChange(configPath, inputDirectory)
    return yield* watchConfig(configPath, yield* reportConfigPass(configPath, true))
  })
}

/**
 * Everything the command does once the command line has parsed.
 *
 * It resolves to one of two modes and nothing else: an `<input>` with an `-o` writes a single app
 * from a single document, and anything else runs a config file — which is what opts in the
 * components, eden, types, test, mock and client-hook generators. `--config` and `<input>` are
 * mutually exclusive, and each of `<input>` / `--output` is meaningless without the other.
 *
 * Everything past the guard clauses fails with something carrying a `message`, so the single
 * `mapError` at the end is where all of it turns into rendered CLI output.
 */
function generate(args: Command.Command.Config.Infer<typeof commandLine>) {
  return Effect.gen(function* () {
    const input = Option.getOrUndefined(args.input)
    const output = Option.getOrUndefined(args.output)
    const configPath = Option.getOrUndefined(args.config)

    // Neither mode is described. `ShowHelp` is how the runner is asked for the help it renders for
    // a parse failure, so a failure caught here reads the same as one caught a layer earlier — and
    // the command describes itself in exactly one place.
    const reject = (message: string) =>
      new CliError.ShowHelp({
        commandPath: [COMMAND_NAME],
        errors: [new CliError.UserError({ cause: new Error(message), userMessage: message })],
      })

    if (configPath !== undefined && (input !== undefined || output !== undefined)) {
      return yield* reject(
        '--config cannot be combined with <input> or --output. A config file already names its own input and outputs.',
      )
    }
    if (input !== undefined && output === undefined) {
      return yield* reject('<input> requires -o <output.ts>.')
    }
    if (output !== undefined && input === undefined) {
      return yield* reject('-o <output.ts> requires an <input> document.')
    }
    // One-shot writes one app from one document and is done; there is no second pass for a change
    // to trigger.
    if (args.watch && (input !== undefined || output !== undefined)) {
      return yield* reject(
        '--watch runs a config file, so it cannot be combined with <input> or --output.',
      )
    }

    // One-shot: no config file is consulted, even when one sits in the working directory. The
    // generator pipeline pulls in the OpenAPI parser, the TypeSpec compiler and ts-morph;
    // `--help`, `--version` and every rejected command line above must not pay for that.
    if (input !== undefined && output !== undefined) {
      const [{ parseOpenAPI }, { elysia }] = yield* Effect.promise(() =>
        Promise.all([import('../openapi/index.js'), import('../core/index.js')]),
      )
      return yield* Console.log(yield* elysia(yield* parseOpenAPI(input), { output }))
    }

    const resolvedConfig = configPath ?? DEFAULT_CONFIG_FILE
    // Under `--watch` the first pass is a pass like any other: the caller asked for a command that
    // stays up and reacts to edits, and a config that does not validate yet is the first edit to
    // react to. Without it, one typo ends the session.
    if (args.watch) {
      return yield* watchConfig(
        resolve(process.cwd(), resolvedConfig),
        yield* reportConfigPass(resolvedConfig, false),
      )
    }
    const first = yield* runConfigPass(resolvedConfig, false).pipe(
      // A config that is absent and was never asked for is the "ran `asphodelos` with nothing"
      // case, the one place where the usage block is the answer. A config that is present and
      // wrong already names the field, and the usage block only buries it.
      Effect.mapError((error) =>
        configPath === undefined && error._tag === 'ConfigError' && error.notFound === true
          ? reject(error.message)
          : error,
      ),
    )
    yield* Console.log(first.report)
    return undefined
  }).pipe(
    // A `CliError` is already something the runner knows how to render — `ShowHelp` in particular,
    // which it answers with the generated help. Everything else is a generator or filesystem
    // failure that only carries a sentence.
    Effect.mapError((error) =>
      CliError.isCliError(error)
        ? error
        : new CliError.UserError({ cause: error, userMessage: error.message }),
    ),
  )
}

/**
 * The `asphodelos` command: parsing, validation, `--help`, `--version` and shell completions are
 * owned by `effect/unstable/cli`, {@link generate} is the rest.
 */
const cli = Command.make(COMMAND_NAME, commandLine, generate).pipe(
  Command.withDescription('Generate Elysia code from OpenAPI or TypeSpec'),
  Command.withExamples([
    {
      command: 'asphodelos openapi.yaml -o src/index.ts',
      description: 'Generate a single app from one document',
    },
    {
      command: 'asphodelos',
      description: `Run every generator declared in ./${DEFAULT_CONFIG_FILE}`,
    },
    {
      command: 'asphodelos --config config/api.config.ts',
      description: 'Run a config file from another location',
    },
    {
      command: 'asphodelos --watch',
      description: 'Rerun on every change to the input documents or the config',
    },
  ]),
)

/**
 * Runs `asphodelos` against an argument list.
 *
 * `entryUrl` is the `import.meta.url` of the executable, and `--version` is read from the
 * `package.json` next to it rather than baked in, so the two can never disagree.
 */
export function asphodelos(argv: readonly string[], entryUrl: string) {
  return Effect.gen(function* () {
    const manifestPath = fileURLToPath(new URL('../package.json', entryUrl))
    const fs = yield* FileSystem.FileSystem
    const source = yield* fs.readFileString(manifestPath)
    const manifest = yield* Effect.try({
      try: (): unknown => JSON.parse(source),
      catch: (cause) => new Error(`${manifestPath} is not valid JSON`, { cause }),
    })
    const { version } = yield* Schema.decodeUnknownEffect(
      Schema.Struct({ version: Schema.String }),
    )(manifest)
    return yield* Command.runWith(cli, { version })(argv)
  })
}
