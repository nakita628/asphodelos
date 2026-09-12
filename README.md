![img](https://raw.githubusercontent.com/nakita628/asphodelos/refs/heads/main/assets/icon/asphodelos.png)

# Asphodelos

**[Asphodelos](https://www.npmjs.com/package/asphodelos)** generates type-safe [Elysia](https://elysiajs.com/) code from [OpenAPI](https://www.openapis.org/) / [TypeSpec](https://typespec.io/) specifications.

- OpenAPI schemas to [TypeBox](https://github.com/sinclairzx81/typebox) schemas (via Elysia's `t`)
- Elysia routes with per-route validation
- App entry point + per-resource modules (controller / service / model)
- TypeBox component bundles (schemas, responses, parameters, …)
- Eden Treaty wrappers and a self-contained `App` type
- Client library hooks (SWR, TanStack Query, Preact Query, Solid Query, Vue Query, Svelte Query, Angular Query)
- `bun:test` tests and a mock server

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

```
DESCRIPTION
  Generate Elysia code from OpenAPI or TypeSpec

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
watching when a run fails. It cannot be combined with `<input>` / `--output`.

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

```
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

- **What it watches**: `asphodelos.config.ts`, and every `.yaml` / `.json` / `.tsp` in the
  directory of `input` — a `$ref` or a TypeSpec import can reach a sibling file.
- **When it regenerates**: a config save always regenerates. A document save regenerates only when
  the documents' contents changed, or a generated file has gone missing; a save with nothing new in
  it is skipped.
- **When the browser reloads**: only when a generated file actually changed.
- **Cleanup**: an output that the config or the document no longer produces is removed. The app
  entry, `modules/` and the generated tests are never removed, because they hold your code.
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

### Wrapper Functions

Generate one wrapper per operation over a Treaty client you supply.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  eden: {
    output: 'src/eden.ts',
    import: './lib', // module exporting `client` = treaty<App>(...)
    client: 'client',
    docs: true, // JSDoc above each wrapper
  },
})
```

## Client Library Integrations

Supported: SWR, TanStack Query, Preact Query, Solid Query, Vue Query, Svelte Query, Angular Query.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  'tanstack-query': {
    output: './src/tanstack-query',
    import: '../lib',
    split: true,
    client: 'client',
  },
})
```

TanStack-family mutations also get a `<operation>MutationOptions()` factory, and SWR queries a
`useImmutable<Operation>` hook. The generated hooks are compiled and run against the real
libraries in [`test/`](test/README.md).

### Infinite Query (`x-pagination`)

Set `x-pagination: true` on a GET operation to generate infinite query hooks.

```yaml
paths:
  /items:
    get:
      x-pagination: true
```

The paging rules go in a `pagination` argument:

```ts
const items = useListItemsInfinite(undefined, {
  initialPageParam: 0,
  getNextPageParam: (lastPage) => lastPage.nextPage,
  buildInit: (pageParam) => ({ query: { page: String(pageParam) } }),
})
```

Vue Query takes only `buildInit` there, with `initialPageParam` / `getNextPageParam` in the third
argument. SWR takes `buildInit(pageIndex, previousPage)` and stops when it returns `null`.

## Test & Mock Generation

### Test Generation

Generates `bun:test` tests that call `app.handle(...)` on the real app: a success-status test per
operation, plus `401` / `404` tests when the spec declares them. They start red against the empty
handlers; re-running keeps your hand-written tests.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  test: {
    output: 'src/app.test.ts', // or `split: true` for modules/<resource>/index.test.ts
    pathAlias: '@/', // optional: import the app through a tsconfig alias
  },
})
```

### Mock Server Generation

Generates a standalone Elysia server that answers every operation with a
[`@faker-js/faker`](https://fakerjs.dev/) mock of its success response. Secured operations that
declare a `401` answer it when the credential is missing, and path parameters answer a declared
`404` for the same sentinel values the generated tests send.

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

With `split: true`, `output` is a directory (one file per entry + `index.ts` barrel); otherwise it
is a single `.ts` file. `components.output` and the per-type components are mutually exclusive.

A split directory belongs to the generator: every run empties its `.ts` files before refilling it,
so an entry that leaves the document does not leave an orphaned file behind. Subdirectories, other
files and the single-file outputs of other generators are left alone.

```ts
import { defineConfig } from 'asphodelos'

export default defineConfig({
  input: 'openapi.yaml',

  output: 'src/index.ts', // app entry; its directory holds modules/ and components/
  prefix: '/api/v3', // new Elysia({ prefix })
  port: '3000',
  integration: false, // true: no .listen(), a host framework owns the server
  pathAlias: false, // true: `@/` imports between generated files
  readonly: false, // wrap top-level schemas in t.Readonly(...)
  // format: {}, // oxfmt FormatConfig

  // `exportTypes` adds `Static<typeof XSchema>` aliases.
  components: {
    // output: 'src/components.ts', // single-file mode

    schemas: {
      output: 'src/components/schemas',
      split: true,
      import: '../schemas',
      exportTypes: true,
    },
    responses: {
      output: 'src/components/responses',
      split: true,
      import: '../responses',
      exportTypes: true,
    },
    parameters: {
      output: 'src/components/parameters',
      split: true,
      import: '../parameters',
      exportTypes: true,
    },
    requestBodies: {
      output: 'src/components/requestBodies',
      split: true,
      import: '../requestBodies',
      exportTypes: true,
    },
    headers: {
      output: 'src/components/headers',
      split: true,
      import: '../headers',
      exportTypes: true,
    },
    mediaTypes: {
      output: 'src/components/mediaTypes',
      split: true,
      import: '../mediaTypes',
      exportTypes: true,
    },
    examples: {
      output: 'src/components/examples',
      split: true,
      import: '../examples',
    },
    securitySchemes: {
      output: 'src/components/securitySchemes',
      split: true,
      import: '../securitySchemes',
    },
    links: {
      output: 'src/components/links',
      split: true,
      import: '../links',
    },
    callbacks: {
      output: 'src/components/callbacks',
      split: true,
      import: '../callbacks',
    },
    pathItems: {
      output: 'src/components/pathItems',
      split: true,
      import: '../pathItems',
    },
  },

  types: {
    output: 'src/types.ts',
  },

  eden: {
    output: 'src/eden.ts',
    import: './lib',
    client: 'client',
    docs: false,
  },

  test: {
    split: true, // false: a single file at `output`
    pathAlias: '@/',
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
    output: 'src/swr',
    import: '../lib',
    split: true,
    client: 'client',
  },
  'tanstack-query': {
    output: 'src/tanstack-query',
    import: '../lib',
    split: true,
    client: 'client',
  },
  'preact-query': {
    output: 'src/preact-query',
    import: '../lib',
    split: true,
    client: 'client',
  },
  'solid-query': {
    output: 'src/solid-query',
    import: '../lib',
    split: true,
    client: 'client',
  },
  'vue-query': {
    output: 'src/vue-query',
    import: '../lib',
    split: true,
    client: 'client',
  },
  'svelte-query': {
    output: 'src/svelte-query',
    import: '../lib',
    split: true,
    client: 'client',
  },
  'angular-query': {
    output: 'src/angular-query',
    import: '../lib',
    split: true,
    client: 'client',
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
| Combinators | `x-allOf-message`‡, `x-anyOf-message`, `x-oneOf-message`, `x-not-message`, `x-implication-message`                                                                                                                                                                                                          |
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

Lint and tests run from the repo root:

```bash
bun run check          # format check, lint, type check, tests, then the client suite
bun run test           # unit tests
bun run test:clients   # build, then compile and run the generated hooks under test/
```

## License

Distributed under the MIT License. See [LICENSE](https://github.com/nakita628/asphodelos?tab=MIT-1-ov-file) for more information.
