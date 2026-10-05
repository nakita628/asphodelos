import { posix, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { Effect, FileSystem, Schema, SchemaIssue, SchemaTransformation } from 'effect'
import type { FormatConfig } from 'oxfmt'

/** OpenAPI 3.x Components Object kinds, in declaration / config-field order. */
export const COMPONENT_KINDS = [
  'schemas',
  'responses',
  'parameters',
  'examples',
  'requestBodies',
  'headers',
  'securitySchemes',
  'links',
  'callbacks',
  'pathItems',
  'mediaTypes',
] as const

/** The client libraries a hooks file can be generated for, in config-field order. */
export const HOOK_KINDS = [
  'swr',
  'tanstack-query',
  'preact-query',
  'solid-query',
  'vue-query',
  'svelte-query',
  'angular-query',
] as const

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
  message: Schema.String.annotate({
    description: 'The sentence printed to the caller, naming the field that is wrong.',
    examples: ['Invalid config: eden.import: must be a module specifier'],
  }),
  notFound: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: 'There is no config file at all, as opposed to one that does not validate.',
    }),
  ),
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
).annotate({
  title: 'Input document',
  description: 'OpenAPI or TypeSpec entry document that every generator reads.',
  examples: ['openapi.yaml', './spec/openapi.json', './spec/main.tsp'],
})

/** Milliseconds, bounded so a mock cannot be configured to hang a request. */
const DelayMsSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(60_000),
)

/** A faker seed: faker hashes it with Mersenne Twister, which takes a 32-bit unsigned integer. */
const SeedSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(4_294_967_295),
)

/** How many items a generated array holds when the schema does not say. */
const ArrayLengthSchema = Schema.Number.check(
  Schema.isInt(),
  Schema.isGreaterThanOrEqualTo(0),
  Schema.isLessThanOrEqualTo(1000),
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
).annotate({
  title: 'Output file',
  description:
    'Single file that receives every generated entry. A directory path is normalized to `<dir>/index.ts`.',
  examples: ['./src/swr.ts', './src/swr'],
})

const ImportSchema = Schema.String.check(
  Schema.isPattern(/^[^\s'"`\\]+$/u, {
    message: 'must be a module specifier, with no whitespace or quotes',
  }),
).annotate({
  title: 'Import specifier',
  description: 'Module specifier the generated file imports from.',
  examples: ['@packages/schemas', '../lib', '.'],
})

// No decoding default: whether the name was given is what the check against a top-level `client`
// reads, and the generators take `client` for a name left out.
const ClientSchema = Schema.optionalKey(
  Schema.String.check(
    Schema.isPattern(/^[A-Za-z_$][A-Za-z0-9_$]*$/u, {
      message: 'must be a JavaScript identifier',
    }),
  ).annotate({
    title: 'Client export name',
    description:
      'Named export to import from `import` as the Eden Treaty client, `client` when left out. Not taken with the top-level `client` block: the generated client is exported as `client`.',
    examples: ['client', 'apiClient'],
  }),
)

/**
 * Every component target is the same two-branch union: `split: true` writes one file per entry
 * into a directory, anything else writes a single file. Only those two fields differ, so the rest
 * is written once and spread into both branches.
 *
 * `Schema.Union` resolves members in order and each member pins `split` to a literal, so a member
 * is only reachable through its own discriminant — the failure reported is the one inside the
 * matching branch, not a union-wide "no member matched".
 */
function splitUnion<Fields extends Schema.Struct.Fields>(shared: Fields) {
  return Schema.Union([
    Schema.Struct({
      split: Schema.Literal(true).annotate({
        description: 'Write one file per entry into `output` rather than a single file.',
      }),
      output: Schema.String.check(
        Schema.isPattern(/^(?!.*\.ts$).+/u, {
          message: 'split mode requires directory, not .ts file',
        }),
      ).annotate({
        title: 'Output directory',
        description: 'Directory that takes one file per entry and an `index.ts` barrel.',
        examples: ['./src/components/schemas'],
      }),
      ...shared,
    }),
    Schema.Struct({
      split: Schema.Literal(false)
        .pipe(Schema.withDecodingDefault(Effect.succeed(false)))
        .annotate({ description: 'Write a single file (default).' }),
      output: FileOutputSchema,
      ...shared,
    }),
  ])
}

const OutputSchema = splitUnion({ import: Schema.optionalKey(ImportSchema) })

const ExportTypesOutputSchema = splitUnion({
  import: Schema.optionalKey(ImportSchema),
  exportTypes: Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
    description: 'Also export the TypeScript type inferred from each generated schema.',
  }),
})

/**
 * What the generated client is created with.
 *
 * A URL written into the file, an environment variable read when the client is created, or a
 * property of an environment a module exports. The member that names a module stands first: the
 * other would accept the object as well and leave `import` out.
 */
const BaseUrlSchema = Schema.Union([
  Schema.String.check(
    Schema.isPattern(/^[^\s'"`\\]+$/u, { message: 'must be a URL, with no whitespace or quotes' }),
  ).annotate({
    title: 'URL',
    description: 'The origin the client sends its requests to, written into the file as it stands.',
    examples: ['http://localhost:3000', 'https://api.example.com'],
  }),
  Schema.Struct({
    env: Schema.String.check(
      Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u, {
        message: 'must be the name of an environment variable',
      }),
    ).annotate({
      title: 'Environment variable',
      description: 'The property of the imported environment the base URL is read from.',
      examples: ['API_URL'],
    }),
    import: ImportSchema.annotate({
      title: 'Import specifier',
      description:
        'The module that exports the environment, written into the client file as it stands. One that validates what it exports hands out a value that is there, so nothing stands in for it.',
      examples: ['@/env', '../env'],
    }),
    name: Schema.String.check(
      Schema.isPattern(/^[A-Za-z_$][A-Za-z0-9_$]*$/u, {
        message: 'must be a JavaScript identifier',
      }),
    )
      .pipe(Schema.withDecodingDefault(Effect.succeed('env')))
      .annotate({
        title: 'Environment export name',
        description:
          'Named export to import from `import` as the environment, `env` when left out.',
        examples: ['env'],
      }),
  }),
  Schema.Struct({
    env: Schema.String.check(
      Schema.isPattern(/^[A-Za-z_][A-Za-z0-9_]*$/u, {
        message: 'must be the name of an environment variable',
      }),
    ).annotate({
      title: 'Environment variable',
      description:
        'The variable the base URL is read from when the client is created, with `http://localhost:<port>` in its place when it is not set.',
      examples: ['VITE_API_URL', 'API_URL'],
    }),
    source: Schema.Literals(['import.meta.env', 'process.env'])
      .pipe(Schema.withDecodingDefault(Effect.succeed('import.meta.env')))
      .annotate({
        title: 'Where the variable is read from',
        description:
          '`import.meta.env` for code a bundler such as Vite builds, `process.env` for code Node.js or Bun runs.',
        examples: ['import.meta.env', 'process.env'],
      }),
  }),
]).annotate({
  title: 'Base URL',
  description:
    'What the client is created with, `treaty<typeof app>(baseUrl)`: a URL written into the file, an environment variable read when the client is created, or a property of an environment a module exports. `http://localhost:<port>` when left out, the address the app entry listens on.',
  examples: [
    'http://localhost:3000',
    { env: 'VITE_API_URL', source: 'import.meta.env' },
    { env: 'API_URL', import: '@/env', name: 'env' },
  ],
})

const ClientOutputSchema = Schema.Struct({
  output: TypeScriptPathSchema.annotate({
    title: 'Client output file',
    description: 'The `.ts` file the client is written to.',
    examples: ['./src/client.ts'],
  }),
  baseUrl: Schema.optionalKey(BaseUrlSchema),
  sameOrigin: Schema.optionalKey(
    Schema.Boolean.pipe(Schema.withDecodingDefault(Effect.succeed(false))).annotate({
      title: 'Same origin in the browser',
      description:
        "In a browser the client sends its requests to the page's own origin, `window.location.origin`, and `baseUrl` is for code that runs without a window: a server render, a loader, a script. For an app a host framework such as TanStack Start or Next.js serves beside its pages, where the API shares the origin and CORS has nothing to allow. Needs the DOM lib.",
    }),
  ),
}).annotate({
  title: 'Eden Treaty client',
  description:
    'The Eden Treaty client of the generated app, `treaty<typeof app>(baseUrl)`, typed by a type-only import of the app entry so the server never reaches a browser bundle. `eden` and the hooks import it unless they name an `import` of their own. Needs `@elysiajs/eden` in the project.',
  examples: [{ output: './src/client.ts', baseUrl: 'http://localhost:3000', sameOrigin: true }],
})

const HooksSchema = Schema.Struct({
  output: FileOutputSchema,
  import: Schema.optionalKey(
    ImportSchema.annotate({
      description:
        'Module specifier the generated file imports the Eden Treaty client from. Not taken with the top-level `client` block, whose client the file imports.',
    }),
  ),
  client: ClientSchema,
  split: Schema.optionalKey(
    Schema.Never.annotate({
      message:
        'split was removed: the hooks are always generated into a single file. Set output to a .ts file path and delete the directory the previous run wrote.',
    }),
  ),
})

const ComponentsSchema = Schema.Struct({
  output: Schema.optionalKey(
    TypeScriptPathSchema.annotate({
      title: 'Single-file components output',
      description:
        'Every component section in one file. Mutually exclusive with the per-type fields below.',
      examples: ['./src/components/index.ts'],
    }),
  ),
  schemas: Schema.optionalKey(
    ExportTypesOutputSchema.annotate({
      title: 'Schemas output',
      description: 'Destination for `components.schemas`.',
    }),
  ),
  responses: Schema.optionalKey(
    ExportTypesOutputSchema.annotate({
      title: 'Responses output',
      description: 'Destination for `components.responses`.',
    }),
  ),
  parameters: Schema.optionalKey(
    ExportTypesOutputSchema.annotate({
      title: 'Parameters output',
      description: 'Destination for `components.parameters`.',
    }),
  ),
  examples: Schema.optionalKey(
    OutputSchema.annotate({
      title: 'Examples output',
      description: 'Destination for `components.examples`.',
    }),
  ),
  requestBodies: Schema.optionalKey(
    ExportTypesOutputSchema.annotate({
      title: 'Request bodies output',
      description: 'Destination for `components.requestBodies`.',
    }),
  ),
  headers: Schema.optionalKey(
    ExportTypesOutputSchema.annotate({
      title: 'Headers output',
      description: 'Destination for `components.headers`.',
    }),
  ),
  securitySchemes: Schema.optionalKey(
    OutputSchema.annotate({
      title: 'Security schemes output',
      description: 'Destination for `components.securitySchemes`.',
    }),
  ),
  links: Schema.optionalKey(
    OutputSchema.annotate({
      title: 'Links output',
      description: 'Destination for `components.links`.',
    }),
  ),
  callbacks: Schema.optionalKey(
    OutputSchema.annotate({
      title: 'Callbacks output',
      description: 'Destination for `components.callbacks`.',
    }),
  ),
  pathItems: Schema.optionalKey(
    OutputSchema.annotate({
      title: 'Path items output',
      description: 'Destination for `components.pathItems`.',
    }),
  ),
  mediaTypes: Schema.optionalKey(
    ExportTypesOutputSchema.annotate({
      title: 'Media types output',
      description: 'Destination for `components.mediaTypes`.',
    }),
  ),
})
  .check(
    // A single `output` bundles every section into one file; a per-type entry routes one section
    // somewhere else. Both at once has no meaning, and silently picking a winner would write a
    // file the config never asked for.
    Schema.makeFilter(({ output, ...perType }) =>
      output === undefined || Object.keys(perType).length === 0
        ? undefined
        : "output cannot be combined with per-type component outputs. Use either a single 'output' or per-type configs.",
    ),
  )
  .annotate({
    title: 'Components outputs',
    description:
      'Where `components.*` is written: one file for every section, or a target per section. Left out, each section the document has goes to `components/<section>.ts` beside the app entry.',
  })

const ConfigSchema = Schema.Struct({
  input: InputSchema,
  output: Schema.optionalKey(
    TypeScriptPathSchema.annotate({
      title: 'App entry',
      description:
        'The Elysia app entry; its directory takes `modules/` and the default `components/`. `src/index.ts` when left out.',
      examples: ['./src/index.ts', './server/index.ts'],
    }),
  ),
  prefix: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(/^\/[^\s'"`\\]*$/u, {
        message: "must start with '/' and contain no whitespace or quotes",
      }),
    ).annotate({
      title: 'Prefix',
      description:
        'Prefix the generated app is mounted on, emitted as `new Elysia({ prefix })`. Elysia wants the leading slash.',
      examples: ['/api', '/api/v1'],
    }),
  ),
  format: Schema.optionalKey(
    Schema.declare<FormatConfig>((u): u is FormatConfig => typeof u === 'object' && u !== null, {
      message: 'must be an oxfmt config object',
    }).annotate({
      title: 'Formatter options',
      description:
        'oxfmt `FormatConfig` applied to every generated file. Defaults to printWidth 100, single quotes, no semicolons.',
      examples: [{ printWidth: 80, semi: true }],
    }),
  ),
  port: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^\d{1,5}$/u, { message: 'must be a port number' }))
      .pipe(Schema.withDecodingDefault(Effect.succeed('3000')))
      .annotate({
        title: 'Port',
        description: 'Port the app entry listens on when it is run directly, `3000` when left out.',
        examples: ['3000', '8080'],
      }),
  ),
  pathAlias: Schema.optionalKey(
    Schema.String.check(
      Schema.isPattern(/^[^\s'"`\\]+$/u, {
        message: 'must be an import prefix, with no whitespace or quotes',
      }),
    ).annotate({
      title: 'Path alias',
      description:
        'Import prefix the generated files use for each other instead of relative paths. It stands for the app entry\'s directory, so with `@/` and `src/index.ts` the entry is `@/index` and `src/client.ts` is `@/client`; a file outside that directory is still imported relatively. Map it in tsconfig: `"paths": { "@/*": ["./src/*"] }`.',
      examples: ['@/', '~/'],
    }),
  ),
  integration: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: 'Leave `.listen()` out of the app entry: a host framework owns the server.',
    }),
  ),
  readonly: Schema.optionalKey(
    Schema.Boolean.annotate({
      description: 'Wrap every top-level generated schema in `t.Readonly(...)`.',
    }),
  ),
  components: Schema.optionalKey(ComponentsSchema),
  client: Schema.optionalKey(ClientOutputSchema),
  eden: Schema.optionalKey(
    Schema.Struct({
      output: FileOutputSchema,
      import: Schema.optionalKey(
        ImportSchema.annotate({
          description:
            'Module specifier the generated file imports the Eden Treaty client from. Not taken with the top-level `client` block, whose client the file imports.',
        }),
      ),
      client: ClientSchema,
      docs: Schema.optionalKey(
        Schema.Never.annotate({
          message: 'docs was removed: the wrappers carry no JSDoc. Delete the option.',
        }),
      ),
    }).annotate({
      title: 'Eden wrappers output',
      description: 'Typed function wrappers around the Eden Treaty client, one per operation.',
      examples: [{ output: './src/eden.ts', import: './lib', client: 'client' }],
    }),
  ),
  types: Schema.optionalKey(
    Schema.Struct({
      output: TypeScriptPathSchema.annotate({
        title: 'Output file',
        description: 'The `.ts` file the `App` type is written to.',
        examples: ['./src/types.ts'],
      }),
    }).annotate({
      title: 'App type output',
      description: 'A self-contained `export type App` for `treaty<App>(...)` clients.',
      examples: [{ output: './src/types.ts' }],
    }),
  ),
  test: Schema.optionalKey(
    Schema.Never.annotate({
      message:
        'test was removed: asphodelos no longer generates tests. Delete the block and the files the previous run wrote.',
    }),
  ),
  mock: Schema.optionalKey(
    Schema.Struct({
      output: FileOutputSchema,
      useExamples: Schema.optionalKey(
        Schema.Union([Schema.Boolean, Schema.Literal('all')]).annotate({
          description:
            "Answer with the response examples the document writes (default: true), or with `'all'` also the scalar example of every schema and property. `false` uses faker alone.",
        }),
      ),
      seed: Schema.optionalKey(
        Schema.Union([SeedSchema, Schema.NonEmptyArray(SeedSchema)]).annotate({
          description:
            'Re-seeds faker at the start of every handler, so each route answers the same body on every request.',
          examples: [42, [1, 2, 3]],
        }),
      ),
      locale: Schema.optionalKey(
        Schema.String.check(
          Schema.isPattern(/^[A-Za-z_]{1,40}$/u, {
            message: "must be a faker locale code such as 'ja', 'en' or 'zh_CN'",
          }),
        ).annotate({
          title: 'Faker locale',
          description: 'Passed straight through to `@faker-js/faker/locale/<locale>`.',
          examples: ['en', 'ja', 'zh_CN'],
        }),
      ),
      delay: Schema.optionalKey(
        Schema.Union([
          DelayMsSchema,
          Schema.Literal(false),
          Schema.Struct({ min: DelayMsSchema, max: DelayMsSchema }).check(
            Schema.makeFilter(({ min, max }) =>
              min <= max ? undefined : 'delay.min must be <= delay.max',
            ),
          ),
        ]).annotate({
          description:
            'A fixed number of milliseconds, a range to pick from, or `false` for no delay at all.',
          examples: [200, { min: 100, max: 800 }, false],
        }),
      ),
      arrayMin: Schema.optionalKey(
        ArrayLengthSchema.annotate({
          description: 'Fewest items a generated array holds when the schema sets no `minItems`.',
        }),
      ),
      arrayMax: Schema.optionalKey(
        ArrayLengthSchema.annotate({
          description: 'Most items a generated array holds when the schema sets no `maxItems`.',
        }),
      ),
    })
      .check(
        Schema.makeFilter(({ arrayMin, arrayMax }) =>
          arrayMin === undefined || arrayMax === undefined || arrayMin <= arrayMax
            ? undefined
            : 'arrayMin must be <= arrayMax. Swap the values or remove one.',
        ),
      )
      .annotate({
        title: 'Mock server output',
        description: 'A standalone Elysia server answering every operation with a faker body.',
        examples: [{ output: './src/mock.ts', useExamples: true, seed: 42, delay: false }],
      }),
  ),
  swr: Schema.optionalKey(
    HooksSchema.annotate({
      title: 'SWR hooks output',
      description: 'Generates `useSWR` / `useSWRMutation` hooks per operation.',
      examples: [{ output: './src/swr.ts', import: '../lib', client: 'client' }],
    }),
  ),
  'tanstack-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'TanStack Query hooks output',
      description: 'Generates `@tanstack/react-query` hooks per operation.',
      examples: [{ output: './src/tanstack-query.ts', import: '../lib', client: 'client' }],
    }),
  ),
  'preact-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'Preact Query hooks output',
      description: 'Generates `@tanstack/preact-query` hooks per operation.',
      examples: [{ output: './src/preact-query.ts', import: '../lib', client: 'client' }],
    }),
  ),
  'solid-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'Solid Query hooks output',
      description: 'Generates `@tanstack/solid-query` hooks per operation.',
      examples: [{ output: './src/solid-query.ts', import: '../lib', client: 'client' }],
    }),
  ),
  'vue-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'Vue Query hooks output',
      description: 'Generates `@tanstack/vue-query` hooks per operation.',
      examples: [{ output: './src/vue-query.ts', import: '../lib', client: 'client' }],
    }),
  ),
  'svelte-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'Svelte Query hooks output',
      description: 'Generates `@tanstack/svelte-query` hooks per operation.',
      examples: [{ output: './src/svelte-query.ts', import: '../lib', client: 'client' }],
    }),
  ),
  'angular-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'Angular Query hooks output',
      description: 'Generates `@tanstack/angular-query-experimental` hooks per operation.',
      examples: [{ output: './src/angular-query.ts', import: '../lib', client: 'client' }],
    }),
  ),
})
  .check(
    // Two generators aimed at one path would take turns overwriting it; the second one named is
    // reported, with the first it collides with. The app entry stands for `src/index.ts` when it
    // is left out, so a generator pointed there collides with it as well.
    Schema.makeFilter(
      (v) => {
        const declared: readonly (readonly [string, string | undefined])[] = [
          ['output', v.output ?? 'src/index.ts'],
          ['components.output', v.components?.output],
          ...COMPONENT_KINDS.map(
            (kind) => [`components.${kind}.output`, v.components?.[kind]?.output] as const,
          ),
          ['client.output', v.client?.output],
          ['eden.output', v.eden?.output],
          ['types.output', v.types?.output],
          ['mock.output', v.mock?.output],
          ...HOOK_KINDS.map((kind) => [`${kind}.output`, v[kind]?.output] as const),
        ]
        const seen = new Map<string, string>()
        for (const [field, output] of declared) {
          if (output === undefined) continue
          const key = posix.normalize(output).replace(/\/+$/u, '')
          const first = seen.get(key)
          if (first !== undefined) {
            return `${field} and ${first} both write to ${output}. Give each generator its own output path.`
          }
          seen.set(key, field)
        }
        return true
      },
      { message: 'every generator needs its own output path' },
    ),
    // A file that calls the client has to be told where it is: by its own `import`, or by the
    // top-level `client` block that generates it. With the block, that client is the one every
    // file imports, under its export name `client` — so neither an `import` nor a `client` is
    // taken there; a block that names one is written for another client.
    Schema.makeFilter(
      (v) => {
        const consumers: readonly (readonly [string, { import?: string; client?: string }])[] = [
          ...(v.eden ? [['eden', v.eden] as const] : []),
          ...HOOK_KINDS.flatMap((kind) => {
            const block = v[kind]
            return block ? [[kind, block] as const] : []
          }),
        ]
        for (const [field, block] of consumers) {
          if (v.client === undefined) {
            if (block.import === undefined) {
              return `${field}.import is required unless a top-level client is generated: name the module that exports the Eden Treaty client, or add client: { output }.`
            }
          } else if (block.import !== undefined) {
            return `${field}.import is not taken with a top-level client: the file imports the client it generates. Delete the import.`
          } else if (block.client !== undefined) {
            return `${field}.client is not taken with a top-level client: the generated client is exported as \`client\`. Delete the name.`
          }
        }
        return true
      },
      { message: 'every file that calls the client needs to know where it is' },
    ),
  )
  .annotate({
    title: 'asphodelos config',
    description:
      'Everything `asphodelos` generates from one OpenAPI or TypeSpec document. Only `input` is required; the app entry is always written, and each remaining field opts one generator in.',
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

// A module specifier is imported once per process, so a watch pass that asked for the same
// config file would get the copy from before the edit. The counter is what makes each reload a
// specifier the loader has not seen — monotonic rather than a timestamp, because two edits inside
// one millisecond would collide.
const reloads = { count: 0 }

/**
 * Imports the config module, bypassing the loader cache when asked.
 *
 * Node busts its cache with a `?reload=n` query on the specifier. Bun — the runtime this
 * generator targets — resolves `file:///x.ts?reload=1` back to the module it already has, so the
 * query buys nothing there. What both honour is a path they have not seen, so a reload copies the
 * config next to itself and imports the copy.
 *
 * A sibling rather than a temp directory: the config's own imports are relative to where it sits,
 * and a copy anywhere else would fail to resolve them. The copy is removed however the import
 * ends, and its name carries the pid so two processes watching one project cannot collide.
 */
function importConfigModule(abs: string, reload: boolean) {
  return Effect.gen(function* () {
    const importModule = (specifier: string) =>
      Effect.tryPromise({
        try: (): Promise<unknown> => import(specifier),
        catch: (error) =>
          new ConfigError({ message: error instanceof Error ? error.message : String(error) }),
      })
    if (!reload) return yield* importModule(pathToFileURL(abs).href)

    const fs = yield* FileSystem.FileSystem
    const copy = resolve(
      abs,
      '..',
      `.asphodelos.config.${String(process.pid)}.${String((reloads.count += 1))}.ts`,
    )
    yield* fs
      .copyFile(abs, copy)
      .pipe(
        Effect.mapError(
          (error) => new ConfigError({ message: `Config reload failed: ${error.message}` }),
        ),
      )
    return yield* importModule(pathToFileURL(copy).href).pipe(
      Effect.ensuring(fs.remove(copy, { force: true }).pipe(Effect.orElseSucceed(() => undefined))),
    )
  })
}

/**
 * Loads and validates a config file, resolved against the current directory.
 *
 * `reload` re-reads a config that has already been imported — what `--watch` needs after the file
 * changes, and nothing else should ask for, since every reload leaves another copy of the module
 * behind.
 */
export function readConfig(configPath?: string, reload = false) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const abs = resolve(process.cwd(), configPath ?? 'asphodelos.config.ts')
    // Checked before importing so a missing file reads as "no config here" rather than as
    // whatever the module loader throws.
    const found = yield* fs
      .exists(abs)
      .pipe(Effect.catchTag('PlatformError', () => Effect.succeed(false)))
    if (!found) {
      return yield* new ConfigError({ message: `Config not found: ${abs}`, notFound: true })
    }
    const mod = yield* importConfigModule(abs, reload)
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

type ConfigInput = typeof ConfigSchema.Encoded

type HookKind = (typeof HOOK_KINDS)[number]

type ComponentKind = (typeof COMPONENT_KINDS)[number]

type OptionOf<S> = S extends unknown ? keyof S : never

type ValueOf<S, K> = S extends unknown ? (K extends keyof S ? S[K] : never) : never

/**
 * `T` with every key the schema does not know replaced by a sentence.
 *
 * The schema strips an unknown key at run time; here, while the config is typed, a typo is
 * reported on the key itself rather than accepted and ignored.
 */
type Known<T, S> = T extends readonly unknown[]
  ? T
  : T extends object
    ? {
        readonly [K in keyof T]: K extends OptionOf<NonNullable<S>>
          ? Known<T[K], ValueOf<NonNullable<S>, K>>
          : 'is not an option'
      }
    : T

type Replaced<V, P, M, S> = {
  readonly [Q in keyof V]: Q extends P
    ? M
    : Q extends OptionOf<NonNullable<S>>
      ? Known<V[Q], ValueOf<NonNullable<S>, Q>>
      : 'is not an option'
}

/**
 * The `output` of a generator block, read without a conditional on the block itself.
 *
 * `T` is inferred from the argument through the mapped type below, and TypeScript leaves a
 * conditional on such an inferred property unresolved — `V extends { output: infer O }` never
 * answers for a block with more than one field. An indexed access does answer, and a block
 * without an `output` reads as `unknown`, which no literal output is.
 */
type OutputOf<V> = (V & { readonly output?: unknown })['output']

/** Every `[field, output]` pair the config declares, the app entry included. */
type Outputs<T> = {
  readonly [K in keyof T]: K extends 'output'
    ? readonly ['output', T[K]]
    : K extends 'components'
      ? {
          readonly [P in keyof T[K]]: P extends 'output'
            ? readonly ['components.output', T[K][P]]
            : readonly [`components.${P & string}`, OutputOf<T[K][P]>]
        }[keyof T[K]]
      : readonly [K, OutputOf<T[K]>]
}[keyof T]

type Sharing<T, F, O> = string extends O
  ? never
  : Extract<Exclude<Outputs<T>, readonly [F, unknown]>, readonly [unknown, O]>

type Shared<T, F, O> = [Sharing<T, F, O>] extends [never]
  ? never
  : `is also the output of ${Sharing<T, F, O>[0] & string}: every generator needs its own output path`

type SplitOf<V> = (V & { readonly split?: unknown })['split']

type Collided<T, F, V, S> = [Shared<T, F, OutputOf<V>>] extends [never]
  ? Known<V, S>
  : Replaced<V, 'output', Shared<T, F, OutputOf<V>>, S>

type Written<T, F, V, S> = [SplitOf<V>] extends [true]
  ? [OutputOf<V>] extends [`${string}.ts`]
    ? Replaced<V, 'output', 'split mode requires a directory, not a .ts file', S>
    : Collided<T, F, V, S>
  : Collided<T, F, V, S>

type Hooked<T, F, V, S> = [SplitOf<V>] extends [boolean]
  ? Replaced<
      V,
      'split',
      'was removed: the hooks are always generated into a single file, so output names a .ts file',
      S
    >
  : Written<T, F, V, S>

/**
 * A block that calls the client, checked against the top-level `client`: with the block, the
 * generated client is the one the file imports, as `client`, so neither an `import` nor a
 * `client` name is taken there.
 */
type Consuming<T, V, S, Else> = 'client' extends keyof T
  ? 'import' extends keyof V
    ? Replaced<
        V,
        'import',
        'is not taken with a top-level client: the file imports the client it generates',
        S
      >
    : 'client' extends keyof V
      ? Replaced<
          V,
          'client',
          'is not taken with a top-level client: the generated client is exported as `client`',
          S
        >
      : Else
  : Else

type Documented<T, F, V, S> = 'docs' extends keyof V
  ? Replaced<V, 'docs', 'was removed: the wrappers carry no JSDoc', S>
  : Written<T, F, V, S>

type Single<T, O> = [Shared<T, 'output', O>] extends [never] ? O : Shared<T, 'output', O>

type Mounted<P> = P extends `/${string}` ? P : string extends P ? P : "must start with '/'"

type Composed<T, V, S> = {
  readonly [P in keyof V]: P extends ComponentKind
    ? [OutputOf<V>] extends [string]
      ? 'components.output and the outputs of each type are mutually exclusive'
      : Written<T, `components.${P}`, V[P], ValueOf<NonNullable<S>, P>>
    : P extends 'output'
      ? [Shared<T, 'components.output', V[P]>] extends [never]
        ? V[P]
        : Shared<T, 'components.output', V[P]>
      : P extends OptionOf<NonNullable<S>>
        ? Known<V[P], ValueOf<NonNullable<S>, P>>
        : 'is not an option'
}

/**
 * The config as `defineConfig` checks it while it is typed.
 *
 * Every rule `parseConfig` applies at run time that can be told from the literal is told here,
 * on the field it concerns: an unknown key, a `.ts` output in split mode, an output two
 * generators share, a prefix without its slash, an import or a client name beside a generated
 * client, and the options that were removed.
 */
type Checked<T> = {
  readonly [K in keyof T]: K extends keyof ConfigInput
    ? K extends 'test'
      ? 'is not an option: asphodelos no longer generates tests'
      : K extends HookKind
        ? Consuming<T, T[K], ConfigInput[K], Hooked<T, K, T[K], ConfigInput[K]>>
        : K extends 'eden'
          ? Consuming<T, T[K], ConfigInput[K], Documented<T, K, T[K], ConfigInput[K]>>
          : K extends 'output'
            ? Single<T, T[K]>
            : K extends 'prefix'
              ? Mounted<T[K]>
              : K extends 'components'
                ? Composed<T, T[K], ConfigInput[K]>
                : Written<T, K, T[K], ConfigInput[K]>
    : 'is not an option'
}

export function defineConfig<const T extends ConfigInput>(config: Checked<T>) {
  return config
}
