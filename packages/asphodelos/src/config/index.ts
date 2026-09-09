import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Effect, FileSystem, Schema, SchemaIssue, SchemaTransformation } from 'effect'
import type { FormatConfig } from 'oxfmt'

/**
 * The config file is missing, is not a module with a default export, or does not validate.
 *
 * `notFound` separates "there is no config here" from "the config here is wrong": only the first
 * is the caller who ran `asphodelos` with nothing and needs to be told what the command accepts.
 * Everything else already names the field that is wrong.
 *
 * `Schema.TaggedError` rather than `Data.TaggedError`: this is the error a schema decode turns
 * into, which makes the failure a schema in its own right. The errors that never meet a schema
 * (`FormatError`, `GenerateError`, `OpenAPIError`) stay plain `Data.TaggedError`.
 */
// oxlint-disable-next-line unicorn/throw-new-error -- `Schema.TaggedError()` is the class factory, not a throw
export class ConfigError extends Schema.TaggedError<ConfigError>()('ConfigError', {
  message: Schema.String,
  notFound: Schema.optionalKey(Schema.Boolean),
}) {}

/**
 * A path constrained to a set of extensions.
 *
 * `Schema.TemplateLiteral` carries the literal type but its rejection reads "Expected a string
 * matching template literal parts"; `Schema.declare` over the same guard keeps the type on both
 * sides — so `defineConfig` still rejects a wrong extension while you type — and lets the message
 * say which extensions are meant.
 */
const TypeScriptPathSchema = Schema.declare<`${string}.ts`>(
  Schema.is(Schema.TemplateLiteral([Schema.String, '.ts'])),
  { message: 'must be .ts file' },
)

const InputSchema = Schema.declare<`${string}.yaml` | `${string}.json` | `${string}.tsp`>(
  Schema.is(Schema.TemplateLiteral([Schema.String, Schema.Literals(['.yaml', '.json', '.tsp'])])),
  { message: 'must be .yaml | .json | .tsp' },
)

/** A directory path normalizes to `<dir>/index.ts`, so single-file mode always names a file. */
const FileOutputSchema = Schema.String.pipe(
  Schema.decodeTo(
    Schema.String,
    SchemaTransformation.transform({
      decode: (v: string) => (v.endsWith('.ts') ? v : `${v}/index.ts`),
      encode: (v: string) => v,
    }),
  ),
)

/**
 * Every output target is the same two-branch union: `split: true` writes one file per entry into
 * a directory, anything else writes a single file. Only those two fields differ, so the rest is
 * written once and spread into both branches.
 *
 * `Schema.Union` resolves members in order and each member pins `split` to a literal, so a member
 * is only reachable through its own discriminant — the failure reported is the one inside the
 * matching branch, not a union-wide "no member matched".
 */
function splitUnion<Fields extends Schema.Struct.Fields>(shared: Fields) {
  return Schema.Union([
    Schema.Struct({
      split: Schema.Literal(true),
      output: Schema.String.check(
        Schema.isPattern(/^(?!.*\.ts$).+/u, {
          message: 'split mode requires directory, not .ts file',
        }),
      ),
      ...shared,
    }),
    Schema.Struct({
      split: Schema.Literal(false).pipe(Schema.withDecodingDefault(Effect.succeed(false))),
      output: FileOutputSchema,
      ...shared,
    }),
  ])
}

const OutputSchema = splitUnion({ import: Schema.optionalKey(Schema.String) })

const ExportTypesOutputSchema = splitUnion({
  import: Schema.optionalKey(Schema.String),
  exportTypes: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
})

const HooksSchema = splitUnion({
  import: Schema.String,
  client: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed('client'))),
})

const ComponentsSchema = Schema.Struct({
  output: Schema.optionalKey(TypeScriptPathSchema),
  schemas: Schema.optionalKey(ExportTypesOutputSchema),
  responses: Schema.optionalKey(ExportTypesOutputSchema),
  parameters: Schema.optionalKey(ExportTypesOutputSchema),
  examples: Schema.optionalKey(OutputSchema),
  requestBodies: Schema.optionalKey(ExportTypesOutputSchema),
  headers: Schema.optionalKey(ExportTypesOutputSchema),
  securitySchemes: Schema.optionalKey(OutputSchema),
  links: Schema.optionalKey(OutputSchema),
  callbacks: Schema.optionalKey(OutputSchema),
  pathItems: Schema.optionalKey(OutputSchema),
  mediaTypes: Schema.optionalKey(ExportTypesOutputSchema),
}).check(
  // A single `output` bundles every section into one file; a per-type entry routes one section
  // somewhere else. Both at once has no meaning, and silently picking a winner would write a
  // file the config never asked for.
  Schema.makeFilter(({ output, ...perType }) =>
    output === undefined || Object.keys(perType).length === 0
      ? undefined
      : "output cannot be combined with per-type component outputs. Use either a single 'output' or per-type configs.",
  ),
)

const ConfigSchema = Schema.Struct({
  input: InputSchema,
  output: Schema.optionalKey(TypeScriptPathSchema),
  prefix: Schema.optionalKey(Schema.String),
  format: Schema.optionalKey(
    Schema.declare<FormatConfig>((u): u is FormatConfig => typeof u === 'object' && u !== null, {
      message: 'must be an oxfmt config object',
    }),
  ),
  port: Schema.optionalKey(Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed('3000')))),
  pathAlias: Schema.optionalKey(
    Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
  ),
  integration: Schema.optionalKey(Schema.Boolean),
  readonly: Schema.optionalKey(Schema.Boolean),
  components: Schema.optionalKey(ComponentsSchema),
  eden: Schema.optionalKey(
    Schema.Struct({
      output: Schema.String,
      import: Schema.String,
      client: Schema.String.pipe(Schema.withDecodingDefault(Effect.succeed('client'))),
      docs: Schema.optionalKey(
        Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))),
      ),
    }),
  ),
  types: Schema.optionalKey(Schema.Struct({ output: TypeScriptPathSchema })),
  test: Schema.optionalKey(
    Schema.Union([
      Schema.Struct({
        split: Schema.Literal(true),
        pathAlias: Schema.optionalKey(Schema.String),
      }),
      Schema.Struct({
        split: Schema.Literal(false).pipe(Schema.withDecodingDefault(Effect.succeed(false))),
        output: FileOutputSchema,
        pathAlias: Schema.optionalKey(Schema.String),
      }),
    ]),
  ),
  mock: Schema.optionalKey(Schema.Struct({ output: FileOutputSchema })),
  swr: Schema.optionalKey(HooksSchema),
  'tanstack-query': Schema.optionalKey(HooksSchema),
  'preact-query': Schema.optionalKey(HooksSchema),
  'solid-query': Schema.optionalKey(HooksSchema),
  'vue-query': Schema.optionalKey(HooksSchema),
  'svelte-query': Schema.optionalKey(HooksSchema),
  'angular-query': Schema.optionalKey(HooksSchema),
})

export type Config = typeof ConfigSchema.Type

// Built once and reused at the edge, as the Schema guide prescribes, rather than rebuilt per call.
const decodeConfig = Schema.decodeUnknownEffect(ConfigSchema)
const formatIssue = SchemaIssue.makeFormatterStandardSchemaV1()

/**
 * Validates an already-loaded config object.
 *
 * The first issue is reported as `<a.b.c>: <message>`: a config file is written by hand, so
 * naming the field that is wrong matters more than listing every consequence of it.
 */
export function parseConfig(config: unknown) {
  return decodeConfig(config).pipe(
    Effect.mapError((error) => {
      const issue = formatIssue(error.issue).issues[0]
      const path = (issue?.path ?? [])
        .map((segment) => String(typeof segment === 'object' ? segment.key : segment))
        .join('.')
      const prefix = path === '' ? '' : `${path}: `
      return new ConfigError({ message: `Invalid config: ${prefix}${issue?.message ?? ''}` })
    }),
  )
}

/** Loads and validates `asphodelos.config.ts`, resolved against the current directory. */
export function readConfig() {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const abs = resolve(process.cwd(), 'asphodelos.config.ts')
    // Checked before importing so a missing file reads as "no config here" rather than as
    // whatever the module loader throws.
    const found = yield* fs
      .exists(abs)
      .pipe(Effect.catchTag('PlatformError', () => Effect.succeed(false)))
    if (!found) {
      return yield* new ConfigError({ message: `Config not found: ${abs}`, notFound: true })
    }
    const mod: unknown = yield* Effect.tryPromise({
      try: () => import(pathToFileURL(abs).href),
      catch: (error) =>
        new ConfigError({ message: error instanceof Error ? error.message : String(error) }),
    })
    // `'default' in mod` is what narrows `mod` for TypeScript, not a second runtime check — an
    // absent key already reads as `undefined` below. `export default undefined` leaves the key
    // present, which is why both halves are here.
    if (
      typeof mod !== 'object' ||
      mod === null ||
      !('default' in mod) ||
      mod.default === undefined
    ) {
      return yield* new ConfigError({ message: 'Config must export default object' })
    }
    return yield* parseConfig(mod.default)
  })
}

export function defineConfig(config: typeof ConfigSchema.Encoded) {
  return config
}
