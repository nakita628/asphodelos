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

/**
 * An option that is gone, kept as a key so a config written for an earlier version is told what
 * replaced it rather than silently losing the key.
 */
function removed(message: string) {
  return Schema.optionalKey(Schema.Never.annotate({ message }))
}

/** The `import` and `client` of a file that calls the client: both gone, the generated client being the one it imports. */
const CLIENT_CONSUMER_REMOVED = {
  import: removed(
    'import was removed: the file imports the client the top-level `client` block generates — relatively, through `pathAlias`, or by `client.package` from another package. Delete the import and add client: { output }.',
  ),
  client: removed(
    'client was removed: the generated client is exported as `client`. Delete the name.',
  ),
}

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

/**
 * The name the generated files in other packages import an output by: the package it is published
 * as. Files in its own package import it relatively, or through the alias.
 */
const PackageSchema = ImportSchema.annotate({
  title: 'Package name',
  description:
    'The name the generated files in other packages import this output by — the package it is published as, whose entry is this file or its barrel. Files in the same package import it relatively or through `pathAlias`. Left out, a file in another package is refused.',
  examples: ['@packages/schemas'],
})

const SECTION_IMPORT_REMOVED = removed(
  'import was removed: a section is imported relatively, through `pathAlias`, or by its `package` from another package. Delete the import.',
)

const OutputSchema = splitUnion({
  import: SECTION_IMPORT_REMOVED,
  package: Schema.optionalKey(PackageSchema),
})

const ExportTypesOutputSchema = splitUnion({
  import: SECTION_IMPORT_REMOVED,
  package: Schema.optionalKey(PackageSchema),
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
  import: removed(
    'import was removed: a client in another package imports the app by the top-level `package`, the name the app entry is published as. Delete the import and set package.',
  ),
  package: Schema.optionalKey(
    ImportSchema.annotate({
      title: 'Package name',
      description:
        "The name the generated files in other packages import the client by — the package it is published as, whose entry is the client or its barrel. Files in the client's own package import it relatively or through the alias. Left out, a file outside that package is refused.",
      examples: ['@packages/client'],
    }),
  ),
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
  examples: [
    { output: './src/client.ts', baseUrl: 'http://localhost:3000', sameOrigin: true },
    { output: '../client/src/lib/client.ts', package: '@packages/client' },
  ],
})

const HooksSchema = Schema.Struct({
  output: FileOutputSchema,
  ...CLIENT_CONSUMER_REMOVED,
  split: removed(
    'split was removed: the hooks are always generated into a single file. Set output to a .ts file path and delete the directory the previous run wrote.',
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
  package: Schema.optionalKey(PackageSchema),
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
    Schema.makeFilter((components) =>
      components.output === undefined ||
      COMPONENT_KINDS.every((kind) => components[kind] === undefined)
        ? undefined
        : "output cannot be combined with per-type component outputs. Use either a single 'output' or per-type configs.",
    ),
    Schema.makeFilter(({ output, package: name }) =>
      name === undefined || output !== undefined
        ? undefined
        : 'package names the single-file output: set output, or name the package on each section.',
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
  package: Schema.optionalKey(
    PackageSchema.annotate({
      title: 'App package name',
      description:
        "The name the app entry's package is published as. A client written into another package imports `app` by it; left out, such a client is refused.",
      examples: ['@packages/elysia'],
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
      ...CLIENT_CONSUMER_REMOVED,
      docs: removed('docs was removed: the wrappers carry no JSDoc. Delete the option.'),
    }).annotate({
      title: 'Eden wrappers output',
      description:
        'Typed function wrappers around the generated Eden Treaty client, one per operation. Needs `client`.',
      examples: [{ output: './src/eden.ts' }],
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
      examples: [{ output: './src/swr.ts' }],
    }),
  ),
  'tanstack-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'TanStack Query hooks output',
      description: 'Generates `@tanstack/react-query` hooks per operation.',
      examples: [{ output: './src/tanstack-query.ts' }],
    }),
  ),
  'preact-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'Preact Query hooks output',
      description: 'Generates `@tanstack/preact-query` hooks per operation.',
      examples: [{ output: './src/preact-query.ts' }],
    }),
  ),
  'solid-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'Solid Query hooks output',
      description: 'Generates `@tanstack/solid-query` hooks per operation.',
      examples: [{ output: './src/solid-query.ts' }],
    }),
  ),
  'vue-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'Vue Query hooks output',
      description: 'Generates `@tanstack/vue-query` hooks per operation.',
      examples: [{ output: './src/vue-query.ts' }],
    }),
  ),
  'svelte-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'Svelte Query hooks output',
      description: 'Generates `@tanstack/svelte-query` hooks per operation.',
      examples: [{ output: './src/svelte-query.ts' }],
    }),
  ),
  'angular-query': Schema.optionalKey(
    HooksSchema.annotate({
      title: 'Angular Query hooks output',
      description: 'Generates `@tanstack/angular-query-experimental` hooks per operation.',
      examples: [{ output: './src/angular-query.ts' }],
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
    // A file that calls the client imports the one the top-level `client` block generates, so the
    // block has to be there for it.
    Schema.makeFilter(
      (v) => {
        const consumers = [
          ...(v.eden ? ['eden'] : []),
          ...HOOK_KINDS.filter((kind) => v[kind] !== undefined),
        ]
        const [first] = consumers
        return v.client === undefined && first !== undefined
          ? `${first} needs the top-level client it imports: add client: { output }.`
          : true
      },
      { message: 'every file that calls the client needs the client to be generated' },
    ),
  )
  .annotate({
    title: 'asphodelos config',
    description:
      'Everything `asphodelos` generates from one OpenAPI or TypeSpec document. Only `input` is required; the app entry is always written, and each remaining field opts one generator in.',
  })

export type Config = typeof ConfigSchema.Type

// Built once and reused at the edge, as the Schema guide prescribes, rather than rebuilt per call.
// An unknown key is an error rather than dropped: a config file is written by hand, and a typo
// that is silently ignored is a generator that silently does not run.
const decodeConfig = Schema.decodeUnknownEffect(ConfigSchema, { onExcessProperty: 'error' })
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

/**
 * The hooks and the wrappers import the client the `client` block generates, so a config that
 * names one of them without the block is refused as it is typed, the way `parseConfig` refuses
 * it: the block's key is the message.
 */
type ClientRequired<T> = 'client' extends keyof T
  ? unknown
  : {
      readonly [
        K in (typeof HOOK_KINDS)[number] | 'eden'
      ]?: 'needs the top-level client it imports: add client: { output }'
    }

/**
 * The config as it is typed.
 *
 * `ConfigInput` is the schema's own input type, so an option that was removed — typed `never` —
 * and a value of the wrong shape fail here. The rules that need the whole config at once are
 * `parseConfig`'s, reported when the config is read: an unknown key, two generators on one
 * output, a prefix without its slash. The one exception is the client the hooks need, which is
 * told on the hook's key.
 */
export function defineConfig<const T extends ConfigInput>(config: T & ClientRequired<T>) {
  return config
}
