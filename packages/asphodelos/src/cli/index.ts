import path, { resolve } from 'node:path'

import { Console, Effect, FileSystem, Stream } from 'effect'
import type { PlatformError } from 'effect'

import { readConfig } from '../config/index.js'
import { elysia } from '../core/index.js'
import { GenerateError } from '../error/index.js'
import { FormatOptions } from '../format/index.js'
import { parseOpenAPI } from '../openapi/index.js'
import { makeJob } from '../shared/index.js'

const HELP_TEXT = `Usage: asphodelos <input.{yaml,json,tsp}> [-o <output.ts>]

Options:
  -w, --watch                 regenerate when the spec or the config changes
  -h, --help                  display help

Configuration:
  asphodelos.config.ts        { input, output?, prefix?, port?, format?, integration?, readonly?, components? }`

/** Extensions a spec can have, and so the changes a watch round is worth reacting to. */
const SPEC_EXTENSIONS = ['.yaml', '.json', '.tsp'] as const

const CONFIG_FILE = 'asphodelos.config.ts'

function isYamlOrJsonOrTsp(i: string): i is `${string}.yaml` | `${string}.json` | `${string}.tsp` {
  return i.endsWith('.yaml') || i.endsWith('.json') || i.endsWith('.tsp')
}

function isTs(o: string): o is `${string}.ts` {
  return o.endsWith('.ts')
}

/** Whether argv asks for the watcher. Accepted in both modes, so it is read before either. */
export function hasWatchFlag(args: readonly string[]) {
  return args.includes('--watch') || args.includes('-w')
}

/** Reads `<input> -o <output>` out of argv, or answers with the help text to print instead. */
export function parseCli(args: readonly string[]) {
  return Effect.gen(function* () {
    const positional = args.filter((arg) => arg !== '--watch' && arg !== '-w')
    const input = positional[0]
    const oIdx = positional.indexOf('-o')
    const output = oIdx === -1 ? undefined : positional[oIdx + 1]
    if (!(input && output && isYamlOrJsonOrTsp(input) && isTs(output))) {
      return yield* new GenerateError({ message: HELP_TEXT })
    }
    return { input, output }
  })
}

/**
 * One generation pass, plus the spec it read.
 *
 * The spec path comes back because the watcher needs it: which directory a change matters in is
 * decided by the config, and the config can change between rounds.
 */
function generate(argv: readonly string[], reload = false) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const configPath = resolve(process.cwd(), CONFIG_FILE)
    const hasConfig = yield* fs
      .exists(configPath)
      .pipe(Effect.catchTag('PlatformError', () => Effect.succeed(false)))

    if (!hasConfig) {
      const { input, output } = yield* parseCli(argv)
      const openAPI = yield* parseOpenAPI(input)
      const log = yield* elysia(openAPI, { output })
      return { log, input } as const
    }

    const config = yield* readConfig(reload)
    const openAPI = yield* parseOpenAPI(config.input)
    const logs = yield* Effect.all(
      makeJob(openAPI, config).map((job) => job.run(job.output)),
      { concurrency: 'unbounded' },
    ).pipe(Effect.provideService(FormatOptions, config.format ?? {}))
    return { log: logs.filter((line) => line !== '').join('\n'), input: config.input } as const
  })
}

/** Whether a changed path is one a round should react to: the config, or a spec. */
function isWatched(changed: string, specPath: string, configPath: string) {
  if (changed === configPath || changed === specPath) return true
  return SPEC_EXTENSIONS.some((extension) => changed.endsWith(extension))
}

/**
 * Every change to the config or to a spec, as one stream.
 *
 * `fs.watch` reports a path relative to the directory it was given, so each event is resolved
 * back to an absolute path before it is filtered — two watched directories can hold files of the
 * same name.
 */
function changes(directories: readonly string[]) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const streams = directories.map((directory) =>
      Stream.map(fs.watch(directory), (event) => path.resolve(directory, event.path)),
    )
    return streams.reduce((merged, stream) => Stream.merge(merged, stream))
  })
}

/**
 * One round: generate, and report rather than raise.
 *
 * A failure is printed and waited out rather than ending the watcher — an unparseable spec
 * mid-edit is the normal case, and the next save is what fixes it. The spec it read comes back so
 * the next round knows where to watch; `undefined` means the round never got far enough to say.
 */
function watchRound(argv: readonly string[], reload: boolean) {
  return Effect.gen(function* () {
    const result = yield* Effect.result(generate(argv, reload))
    yield* result._tag === 'Success'
      ? Console.log(result.success.log)
      : Console.error(`❌ ${result.failure.message}`)
    return result._tag === 'Success' ? result.success.input : undefined
  })
}

/**
 * Waits for the first change worth regenerating for.
 *
 * `runHead` is what ends the wait: it takes the first change that survives the filter and the
 * debounce, then tears the stream down, so the next round can watch wherever the reloaded config
 * points. Changes are debounced because one save is several filesystem events — an editor writes,
 * renames and touches — and a round per event would race itself.
 */
function awaitChange(specPath: string | undefined, configPath: string) {
  return Effect.gen(function* () {
    const directories = [
      path.dirname(configPath),
      ...(specPath === undefined ? [] : [path.dirname(resolve(process.cwd(), specPath))]),
    ].filter((directory, index, all) => all.indexOf(directory) === index)
    const resolvedSpec = resolve(process.cwd(), specPath ?? '')
    const stream = yield* changes(directories)
    yield* Stream.runHead(
      Stream.debounce(
        Stream.filter(stream, (changed) => isWatched(changed, resolvedSpec, configPath)),
        '200 millis',
      ),
    )
  })
}

/**
 * Regenerates on every change to the spec or the config, until interrupted.
 *
 * Recursive rather than a loop because the watched directories are decided by the config, and the
 * config is re-read every round: an edit that repoints `input` at another directory has to move
 * the watcher with it, which means new streams rather than new values.
 */
function watchRounds(
  argv: readonly string[],
  reload: boolean,
): Effect.Effect<never, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const configPath = resolve(process.cwd(), CONFIG_FILE)
    const specPath = yield* watchRound(argv, reload)
    yield* awaitChange(specPath, configPath)
    return yield* watchRounds(argv, true)
  })
}

/**
 * The whole command: a config file when there is one, otherwise the two arguments.
 *
 * Returns the log the CLI prints; every failure travels in the error channel with a message the
 * bin renders as-is. `--watch` never returns: it prints each round itself and runs until the
 * process is interrupted.
 */
export function asphodelos(argv: readonly string[]) {
  return Effect.gen(function* () {
    if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return HELP_TEXT
    if (hasWatchFlag(argv)) {
      yield* Console.log('👀 asphodelos --watch')
      return yield* watchRounds(argv, false)
    }
    const { log } = yield* generate(argv)
    return log
  })
}
