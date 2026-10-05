# Asphodelos

![img](https://raw.githubusercontent.com/nakita628/asphodelos/refs/heads/main/assets/icon/asphodelos.png)

**[Asphodelos](https://www.npmjs.com/package/asphodelos)** generates type-safe [Elysia](https://elysiajs.com/) code from [OpenAPI](https://www.openapis.org/) / [TypeSpec](https://typespec.io/) specifications.

- OpenAPI schemas to [TypeBox](https://github.com/sinclairzx81/typebox) schemas (via Elysia's `t`)
- Elysia routes with per-route validation
- App entry point + per-resource modules (controller / service / model)
- TypeBox component bundles (schemas, responses, parameters, …)
- Eden Treaty wrappers and a self-contained `App` type
- Client library hooks (SWR, TanStack Query, Preact Query, Solid Query, Vue Query, Svelte Query, Angular Query)
- A mock server

Asphodelos targets the [Bun](https://bun.sh/) runtime.

## Quick Start

### Installation

```bash
bun add -D asphodelos
```

### CLI

```bash
bunx asphodelos path/to/input.{yaml,json,tsp} -o path/to/output.ts
```

### Configuration File

Create `asphodelos.config.ts`:

```ts
import { defineConfig } from 'asphodelos'

export default defineConfig({
  input: 'openapi.yaml',
  output: 'src/index.ts', // default
})
```

```bash
bunx asphodelos
```

### CLI Reference

`asphodelos --help`:

```text
DESCRIPTION
  Asphodelos is a code generator from OpenAPI to Elysia

USAGE
  asphodelos [flags] [<input>]

ARGUMENTS
  input input.{yaml,json,tsp} OpenAPI (.yaml, .json) or TypeSpec (.tsp) document to generate from (optional)

FLAGS
  --output, -o output.ts    TypeScript file the generated app is written to
  --config, -c file         Config file to run (default: ./asphodelos.config.ts)
  --watch, -w               Rerun the config on every change to its documents or itself

GLOBAL FLAGS
  --help, -h                                                          Show help information
  --version, -v                                                       Show version information
  --wizard                                                            Start wizard mode for a command
  --completions <bash|zsh|fish|sh>                                    Print shell completion script (choices: bash, zsh, fish, sh)
  --log-level <all|trace|debug|info|warn|warning|error|fatal|none>    Sets the minimum log level (choices: all, trace, debug, info, warn, warning, error, fatal, none)

EXAMPLES
  # Generate a single app from one document
  asphodelos openapi.yaml -o src/index.ts

  # Run every generator declared in ./asphodelos.config.ts
  asphodelos

  # Run a config file from another location
  asphodelos --config config/api.config.ts

  # Rerun on every change to the input documents or the config
  asphodelos --watch
```

With an `<input>` the CLI generates one app and ignores any config file. With no `<input>` it
runs the config file.

### Watch Mode

```bash
bunx asphodelos --watch
```

Reruns the config on every change to the input documents or to the config itself, and keeps
watching when a run fails. The whole directory of the input document is watched, so TypeSpec
imports and `$ref` files beside it trigger a rerun too — and so do the files a `$ref` or an import
reaches outside that directory. An input directory that is removed and recreated, or that does not
exist yet, is picked up when it appears. It cannot be combined with `<input>` / `--output`.

### Example

input:

```yaml
openapi: 3.1.0
info:
  title: Asphodelos API
  version: '1.0.0'
paths:
  /elysia:
    get:
      summary: Welcome
      operationId: welcome
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema:
                type: object
                required: [message]
                properties:
                  message:
                    type: string
```

output:

```text
src/
├── index.ts
└── modules/
    └── elysia/
        ├── index.ts    // controller
        ├── service.ts  // abstract class for business logic
        └── model.ts    // TypeBox models
```

```ts
// src/index.ts
import { Elysia } from 'elysia'
import { elysia } from './modules/elysia'

export const app = new Elysia().use(elysia)

if (import.meta.main) {
  app.listen(3000)
  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)
}
```

```ts
// src/modules/elysia/index.ts
import { Elysia } from 'elysia'
import { ElysiaModel } from './model'

export const elysia = new Elysia().get('/elysia', () => {}, {
  response: { 200: ElysiaModel.welcomeResponse200 },
  detail: { tags: [], summary: 'Welcome', operationId: 'welcome' },
})
```

```ts
// src/modules/elysia/model.ts
import { t, type UnwrapSchema } from 'elysia'

export const ElysiaModel = { welcomeResponse200: t.Object({ message: t.String() }) } as const

export type ElysiaModel = { [k in keyof typeof ElysiaModel]: UnwrapSchema<(typeof ElysiaModel)[k]> }
```

Handlers are empty stubs: TypeScript flags each one whose response is non-void until you
implement it. Importing `app` never starts a server.

```bash
bun add elysia
bun run src/index.ts
```

## Vite Plugin

Watches your OpenAPI spec and `asphodelos.config.ts` for changes, then auto-regenerates code on save.

Requires `asphodelos.config.ts` in your project root.

```ts
// vite.config.ts
import { asphodelosVite } from 'asphodelos/vite-plugin'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [asphodelosVite()],
})
```

- **What it watches**: `asphodelos.config.ts`, every `.yaml` / `.json` / `.tsp` in the directory
  of `input` — a `$ref` or a TypeSpec import can reach a sibling file — and every file the document
  reads from outside that directory.
- **When it regenerates**: a config save always regenerates. A document save regenerates only when
  the documents' contents changed, or a generated file has gone missing; a save with nothing new in
  it is skipped.
- **When the browser reloads**: only when a generated file actually changed.
- **Cleanup**: an output that the config or the document no longer produces is removed. The app
  entry and `modules/` are never removed, because they hold your code.
- A config that fails to load is reported and the previous one stays in effect; the next save
  retries, so a typo never needs a restart. Every run is queued, so two never overlap.

## Eden Treaty Integration

### Type-Only Distribution

Emit a self-contained `export type App` so [Eden](https://elysiajs.com/eden/treaty/overview.html)
clients can call `treaty<App>(...)` without importing the runtime app.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  types: { output: 'src/types.ts' },
})
```

### Generated Client

Generate the Treaty client itself, typed by the app entry.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  output: 'src/index.ts',
  client: {
    output: 'src/lib/client.ts',
    baseUrl: 'http://localhost:3000', // or { env: 'VITE_API_URL' }, or { env: 'API_URL', import: '@/env' }
    sameOrigin: true, // in a browser, the page's own origin; baseUrl is for code without a window
  },
})
```

```ts
// src/lib/client.ts
import { treaty } from '@elysiajs/eden'
import type { app } from '../index'

const origin = typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin

export const client = treaty<typeof app>(origin)
```

The `index.ts` beside the client re-exports it, so it is imported as `./lib`; `eden` and the hooks
import it from there. `baseUrl` left out is `http://localhost:<port>`. `sameOrigin` suits an app a
host framework such as TanStack Start or Next.js serves beside its pages, where the API shares the
origin and CORS has nothing to allow. The project needs `@elysiajs/eden`.

### Imports Between Generated Files

Nothing is configured per file: how one generated file imports another follows from where the two
are written.

- In the same package, relatively — `./lib`, `../components/schemas`.
- Under the app entry's directory with `pathAlias: '@/'`, through the alias — `@/lib`,
  `@/components/schemas`.
- In different packages (each with its own `package.json`), by the name the output is published
  as: the top-level `package` for the app entry, `client.package` for the client, and `package` on
  each component section (`components.schemas.package`, `components.responses.package`, …), or on
  `components` in single-file mode. A relative path never crosses a package.

```ts
// apps/elysia/asphodelos.config.ts — the app, the client and the hooks in three packages
export default defineConfig({
  input: 'openapi.yaml',
  output: 'src/index.ts',
  package: '@packages/elysia', // the client imports `app` from here
  client: { output: '../eden/src/client.ts', package: '@packages/eden' }, // the hooks import it from here
  'tanstack-query': { output: '../react/src/api/hooks.ts' },
})
```

`@packages/elysia` exports `app` from its entry, `@packages/eden` exports the `index.ts` beside the client,
and `elysia` resolves to one copy across the workspace.

### Wrapper Functions

Generate one wrapper per operation over the generated client.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  client: { output: 'src/lib/client.ts' },
  eden: { output: 'src/eden.ts' },
})
```

## Client Library Integrations

Supported: SWR, TanStack Query, Preact Query, Solid Query, Vue Query, Svelte Query, Angular Query.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  client: { output: 'src/lib/client.ts' },
  'tanstack-query': { output: './src/tanstack-query.ts' },
})
```

The hooks are written into one file and import the generated client, so a `client` block comes
with them.

Every operation is named by its method and path: a GET on `/users/{id}` becomes `useUsersId`, with
`getUsersIdQueryKey` and `getUsersIdQueryOptions` beside it; a POST on `/users` becomes
`usePostUsers`, with `getPostUsersMutationKey` and `getPostUsersMutationOptions`. Path parameters
come first, then one `options` object, then the library's own trailing argument (a `QueryClient`,
or Angular's inject options):

```ts
const user = useUsersId(
  { id: '1' },
  {
    query: { staleTime: 1_000 }, // the library's options, minus the key and the query function
    options: { headers: { 'x-trace': 'a' } }, // the client's request options
  },
)

const create = usePostUsers({ mutation: { onSuccess: () => invalidate() } })
create.mutate({ body: { name: 'Alice' } })
```

A query's `options` are part of its key, headers excluded; a mutation honors a `mutationKey` of
your own over the generated one. SWR hooks take `{ swr, options }` instead, where `swr` adds
`swrKey` (replaces the generated key) and `enabled` (a `false` turns the key into `null`), and
return the key they used beside SWR's result.

### Infinite Query (`x-pagination`)

Set `x-pagination: true` on a GET operation to generate infinite query hooks.

```yaml
paths:
  /items:
    get:
      x-pagination: true
```

The paging rules go in a `pagination` argument, ahead of the options:

```ts
const items = useInfiniteItems(
  {
    initialPageParam: 0,
    getNextPageParam: (lastPage) => lastPage.nextPage,
    getRequestArgs: (options, pageParam) => ({
      ...options,
      query: { ...options.query, page: Number(pageParam) },
    }),
  },
  { options: { query: { page: 0 } } },
)
```

Vue Query takes only `getRequestArgs` there, with `initialPageParam` / `getNextPageParam` in
`options.query`. SWR takes `pagination.getRequestArgs(options, index)` inside its options object,
and a `swr.swrKey` loader that returns `null` stops the paging.

## Mock Server Generation

Generates a standalone Elysia server that answers every operation with a
[`@faker-js/faker`](https://fakerjs.dev/) mock of its success response. Secured operations that
declare a `401` answer it when the credential is missing, and path parameters answer a declared
`404` for a sentinel value the schema accepts but no record is likely to carry.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  mock: {
    output: 'src/mock.ts',
    delay: { min: 50, max: 200 },
    locale: 'ja',
  },
})
```

Like [Prism](https://stoplight.io/open-source/prism), a request can pick any response or named
example the document declares with the `Prefer` header (or the `__code` / `__example` query):

```bash
curl -H 'Prefer: code=404' http://localhost:3000/orders/1          # the 404 response
curl -H 'Prefer: example=pending' http://localhost:3000/orders/1   # a named example
curl -H 'Prefer: code=404, example=gone' http://localhost:3000/orders/1
curl 'http://localhost:3000/orders/1?__code=503'
```

A code falls back to its `4XX` range, then `default`. A code or example the operation does not
declare answers `500` with an `application/problem+json` body saying what is missing.

## Full Config Reference

Every generator is opted in by adding its section. `defineConfig` checks the config while you type
it, and the CLI checks it again when it runs:

- Every generator needs its own `output`. Two generators writing to one path is an error.
- `components.output` (one file) and the per-type `components.*` sections are mutually exclusive.
- A component section with `split: true` writes one file per entry plus an `index.ts` barrel into a
  directory; otherwise `output` is a single `.ts` file (a directory stands for its `index.ts`).
- A split directory belongs to the generator: every run empties its `.ts` files before refilling
  it, so an entry that leaves the document does not leave an orphaned file behind. Subdirectories,
  other files and the single-file outputs of other generators are left alone.
- Imports between generated files are worked out from where they are written; see
  [Imports Between Generated Files](#imports-between-generated-files). `package` names are
  module specifiers.
- `prefix` must start with `/`.
- `eden` and the hooks import the generated client, so they need the `client` block.
- The hooks (`swr`, `tanstack-query`, …) are always one file; `split` is no longer an option
  there, and neither is the `test` generator, `eden.docs`, or `import` and `client` on a section.

```ts
import { defineConfig } from 'asphodelos'

export default defineConfig({
  input: 'openapi.yaml',

  output: 'src/index.ts', // app entry; its directory holds modules/ and components/
  prefix: '/api/v3', // new Elysia({ prefix })
  port: '3000',
  integration: false, // true: no .listen(), a host framework owns the server
  // pathAlias: '@/', // import prefix for the app entry's directory: `@/index`, `@/lib`
  // package: '@packages/elysia', // the app's package name, for a client in another package
  readonly: false, // wrap top-level schemas in t.Readonly(...)
  // format: {}, // oxfmt FormatConfig

  // `exportTypes` adds `Static<typeof XSchema>` aliases. Every section, and `components` in
  // single-file mode, takes a `package`: the name other packages import it by when it is written
  // into a package of its own.
  components: {
    // output: 'src/components.ts', // single-file mode
    // package: '@packages/components',

    schemas: {
      output: 'src/components/schemas',
      split: true,
      exportTypes: true,
      // package: '@packages/schemas',
    },
    responses: {
      output: 'src/components/responses',
      split: true,
      exportTypes: true,
      // package: '@packages/responses',
    },
    parameters: {
      output: 'src/components/parameters',
      split: true,
      exportTypes: true,
      // package: '@packages/parameters',
    },
    requestBodies: {
      output: 'src/components/requestBodies',
      split: true,
      exportTypes: true,
      // package: '@packages/requestBodies',
    },
    headers: {
      output: 'src/components/headers',
      split: true,
      exportTypes: true,
      // package: '@packages/headers',
    },
    mediaTypes: {
      output: 'src/components/mediaTypes',
      split: true,
      exportTypes: true,
      // package: '@packages/mediaTypes',
    },
    examples: {
      output: 'src/components/examples',
      split: true,
      // package: '@packages/examples',
    },
    securitySchemes: {
      output: 'src/components/securitySchemes',
      split: true,
      // package: '@packages/securitySchemes',
    },
    links: {
      output: 'src/components/links',
      split: true,
      // package: '@packages/links',
    },
    callbacks: {
      output: 'src/components/callbacks',
      split: true,
      // package: '@packages/callbacks',
    },
    pathItems: {
      output: 'src/components/pathItems',
      split: true,
      // package: '@packages/pathItems',
    },
  },

  types: {
    output: 'src/types.ts',
  },

  client: {
    output: 'src/lib/client.ts', // re-exported by src/lib/index.ts
    // package: '@packages/eden', // what other packages import the client by
    baseUrl: 'http://localhost:3000', // `http://localhost:<port>` when left out
    // baseUrl: { env: 'VITE_API_URL', source: 'import.meta.env' },
    // baseUrl: { env: 'API_URL', import: '@/env', name: 'env' },
    sameOrigin: false, // true: a browser uses window.location.origin, baseUrl is for the rest
  },

  // eden and the hooks import the generated client, so the `client` block above comes with them.
  eden: {
    output: 'src/eden.ts',
  },

  mock: {
    output: 'src/mock.ts',
    useExamples: true, // true: response examples | 'all': also schema/property examples | false
    locale: 'en', // @faker-js/faker/locale/<locale>
    // seed: 42, // optional: same body per route on every request (snapshot-friendly)
    delay: false, // ms, { min, max }, or false
    arrayMin: 1, // array length when the schema sets no minItems / maxItems
    arrayMax: 5,
  },

  swr: {
    output: 'src/swr.ts',
  },
  'tanstack-query': {
    output: 'src/tanstack-query.ts',
  },
  'preact-query': {
    output: 'src/preact-query.ts',
  },
  'solid-query': {
    output: 'src/solid-query.ts',
  },
  'vue-query': {
    output: 'src/vue-query.ts',
  },
  'svelte-query': {
    output: 'src/svelte-query.ts',
  },
  'angular-query': {
    output: 'src/angular-query.ts',
  },
})
```

## Vendor Extensions (x-\*)

### Custom Validation Error Messages

Attach a custom error message with `x-<jsonSchemaKeyword>-message`, one extension per keyword.

```yaml
name:
  type: string
  minLength: 3
  maxLength: 20
  x-error-message: 'name must be a string'
  x-minLength-message: 'name must be at least 3 characters'
  x-maxLength-message: 'name must be at most 20 characters'
```

| Group       | Extensions                                                                                                                                                                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Common      | `x-error-message`, `x-required-message`†, `x-const-message`, `x-enum-message`                                                                                                                                                                                                                               |
| Numeric     | `x-minimum-message`, `x-maximum-message`, `x-exclusiveMinimum-message`, `x-exclusiveMaximum-message`, `x-multipleOf-message`                                                                                                                                                                                |
| String      | `x-minLength-message`, `x-maxLength-message`, `x-pattern-message`, `x-length-message`                                                                                                                                                                                                                       |
| Array       | `x-minItems-message`, `x-maxItems-message`, `x-uniqueItems-message`, `x-contains-message`, `x-minContains-message`, `x-maxContains-message`, `x-prefixItems-message`, `x-items-message`                                                                                                                     |
| Object      | `x-minProperties-message`, `x-maxProperties-message`, `x-additionalProperties-message`†, `x-propertyNames-message`, `x-patternProperties-message`†, `x-dependentRequired-message`, `x-dependentSchemas-message`, `x-properties-message`†, `x-unevaluatedProperties-message`†, `x-unevaluatedItems-message`† |
| Composition | `x-allOf-message`‡, `x-anyOf-message`, `x-oneOf-message`, `x-not-message`, `x-implication-message`                                                                                                                                                                                                          |
| Conditional | `x-if-message`†, `x-then-message`†, `x-else-message`†                                                                                                                                                                                                                                                       |

- † Kept on the schema, but Elysia 1.4 cannot route a 422 to it.
- ‡ Best-effort: a sibling error is usually reported first.

### Behavior Extensions

| Extension                                    | Effect                                                             |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `x-trim`                                     | `t.Transform` that trims the string                                |
| `x-toLowerCase` / `x-lowercase`              | `t.Transform` that lower-cases the string                          |
| `x-toUpperCase` / `x-uppercase`              | `t.Transform` that upper-cases the string                          |
| `x-normalize`                                | `t.Transform` with `normalize('NFC' \| 'NFD' \| 'NFKC' \| 'NFKD')` |
| `x-startsWith` / `x-endsWith` / `x-includes` | Folded into `pattern`                                              |
| `x-emailRegex`                               | Replaces `pattern` on `format: email`                              |
| `x-readonly`                                 | `t.Readonly(...)`                                                  |
| `x-brand`                                    | `t.Unsafe<T & { readonly __brand: 'Name' }>(...)` on primitives    |
| `x-transform`                                | Replaces the schema with a raw `t.Transform(...)` expression       |

String transforms run **after** validation, so write `minLength` / `pattern` against the value as
it arrives, not as it looks after trimming or case-folding.

```yaml
UpdatedAt:
  type: string
  format: date-time
  x-transform: >-
    t.Transform(t.String()).Decode((v) => new Date(v)).Encode((v) => v.toISOString())
```

> **⚠️ Security:** `x-transform` is emitted verbatim and runs when the generated module is
> imported. Only generate from specs you author or fully trust.

`Decode` runs on requests and `Encode` on responses (only when the response declares a schema).
Keep query / path / header transforms on a `string` base. Eden types the decoded value, but the
wire carries the encoded one.

`x-uuidVersion`, `x-urlHostname`, `x-urlProtocol`, `x-urlNormalize`, `x-isoPrecision`,
`x-isoOffset`, `x-isoLocal`, `x-macDelimiter`, `x-jwtAlg`, `x-hashAlg` and `x-hashEnc` are
round-tripped through OpenAPI but emit no code.

### Coercion Formats

| `format`         | Generates           |
| ---------------- | ------------------- |
| `numeric`        | `t.Numeric()`       |
| `boolean-string` | `t.BooleanString()` |

Elysia already coerces query / path / header / cookie values and JSON bodies, so these only make
the intent explicit in a body. Do not add them to parameters.

### Unsupported Extensions

`x-refine`, `x-superRefine`, `x-prefault` (use `default`), `x-decode` / `x-encode` (use
`x-transform`), `x-cookie-secrets`, `x-unionEnum`, `x-composite` and `x-form` are not supported.

## Contributing

We welcome feedback and contributions!

- Open an issue at [GitHub Issues](https://github.com/nakita628/asphodelos/issues)
- Submit a pull request with your improvements

Lint and tests run from the repository root:

```bash
bun run check          # format check, lint, type check, tests, then the client suite
bun run fix            # autofix formatting, oxlint, markdownlint and textlint
bun run lint           # oxlint, markdownlint, textlint, cspell, secretlint, actionlint
bun run test           # unit tests
bun run test:clients   # build, then compile and run the generated hooks under test/
bun run test:pack      # build, pack, and install the tarball with npm into an empty project
```

## License

Distributed under the MIT License. See [LICENSE](https://github.com/nakita628/asphodelos?tab=MIT-1-ov-file) for more information.
