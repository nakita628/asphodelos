![img](https://raw.githubusercontent.com/nakita628/asphodelos/refs/heads/main/assets/icon/asphodelos.png)

# Asphodelos

```bash
bun add -D asphodelos
```

Asphodelos targets the [Bun](https://bun.sh/) runtime — the generated app guards `.listen()` with `import.meta.main`, and generated tests use `bun:test`.

## OpenAPI to Elysia Code Generator

**[Asphodelos](https://www.npmjs.com/package/asphodelos)** generates type-safe [Elysia](https://elysiajs.com/) code from [OpenAPI](https://www.openapis.org/) / [TypeSpec](https://typespec.io/) specifications.

- OpenAPI schemas to [TypeBox](https://github.com/sinclairzx81/typebox) schemas (via Elysia's `t`)
- Elysia route definitions with per-route `t.Object` validation
- App entry point + per-resource modules (controller / service / model)
- TypeBox component bundles (schemas, responses, parameters, …)
- Per-operation Eden Treaty wrappers
- Client library hooks (SWR, TanStack Query, Preact Query, Solid Query, Vue Query, Svelte Query, Angular Query)
- Self-contained `App` type for Eden client distribution

## Quick Start

### CLI

```bash
bunx asphodelos path/to/input.{yaml,json,tsp} -o path/to/output.ts
```

One-shot mode: one document in, one app out. It consults no config file, even when one is sitting
in the working directory — `<input>` and `-o` always mean exactly what they say.

`--help` lists every flag, `--version` reports the installed version, and
`--completions <bash|zsh|fish|sh>` prints a shell completion script.

### Configuration File

Create `asphodelos.config.ts`:

```ts
import { defineConfig } from 'asphodelos'

export default defineConfig({
  input: 'openapi.yaml',
})
```

```bash
bunx asphodelos
```

Running `asphodelos` with no arguments runs `./asphodelos.config.ts`; `--config` (or `-c`) runs
one from somewhere else. When `output` is omitted, Asphodelos writes the app entry to
`src/index.ts` by default.

```bash
bunx asphodelos --config config/api.config.ts
```

### Watch Mode

`--watch` (or `-w`) runs a config file and regenerates on every change to the documents it names
or to the config itself, until interrupted. It is a config-file mode, so it cannot be combined
with `<input>` / `--output` — a one-shot has no second pass for a change to trigger.

```bash
bunx asphodelos --watch
```

A round that fails — an unparseable spec mid-edit, a config that does not validate — is reported
and waited out rather than ending the command, so the next save is what recovers it. Editing the
config's `input` moves the watcher to the directory it now names.

### Example

input (`openapi.yaml`):

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

output (the listings below show the formatted result — Asphodelos writes through `oxfmt` before saving):

```
src/
├── index.ts
└── modules/
    └── elysia/
        ├── index.ts
        ├── service.ts
        └── model.ts
```

`src/index.ts`:

```ts
import { Elysia } from 'elysia'
import { elysia } from './modules/elysia'

export const app = new Elysia().use(elysia)

if (import.meta.main) {
  app.listen(3000)
  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)
}
```

`app` is exported (and `.listen()` is guarded by `import.meta.main`) so tests can import the assembled app without starting a server. `src/modules/elysia/index.ts`:

```ts
import { Elysia } from 'elysia'
import { ElysiaModel } from './model'

export const elysia = new Elysia().get('/elysia', () => {}, {
  response: { 200: ElysiaModel.welcomeResponse200 },
  detail: { tags: [], summary: 'Welcome', operationId: 'welcome' },
})
```

The handler body is left empty for you to fill in. When the `response` schema is non-void, TypeScript surfaces an error on the empty body pointing at the exact route that needs an implementation — that error is the intended "implement here" signal.

`src/modules/elysia/model.ts`:

```ts
import { t, type UnwrapSchema } from 'elysia'

export const ElysiaModel = { welcomeResponse200: t.Object({ message: t.String() }) } as const

export type ElysiaModel = { [k in keyof typeof ElysiaModel]: UnwrapSchema<(typeof ElysiaModel)[k]> }
```

`src/modules/elysia/service.ts`:

```ts
export abstract class Elysia {}
```

Use the generated abstract service class (here `Elysia`) to hold business logic, then call it from the controller handler. Component schemas / responses / parameters are emitted under `src/components/` only when the spec declares them.

Install Elysia and start the generated server:

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

## Type-Only Distribution (`types`)

Emit a self-contained `export type App = Elysia<...>` file straight from the OpenAPI spec. Eden client consumers can `import type { App }` from this file and call `treaty<App>(...)` without pulling in the runtime app.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  types: { output: 'src/types.ts' },
})
```

## Eden Treaty Integration

Generate per-operation wrapper functions over a typed [Eden Treaty](https://elysiajs.com/eden/treaty/overview.html) client. The client itself is supplied externally so users own the URL / in-memory / auth setup.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  eden: {
    output: 'src/eden.ts',
    import: './lib', // module exporting `client` = treaty<App>(...)
    client: 'client', // exported variable name (default `client`)
    docs: true, // prepend JSDoc above each wrapper
  },
})
```

## Client Library Integrations

Supported: SWR, TanStack Query, Preact Query, Solid Query, Vue Query, Svelte Query, Angular Query. Each library shares the same config shape.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  'tanstack-query': {
    output: './src/tanstack-query',
    import: '../lib',
    split: true, // one file per operation + index.ts barrel
    client: 'client',
  },
})
```

The generated hooks are compiled against the real client libraries and, for SWR and TanStack
Query, executed against a host app — see [`test/`](test/README.md).

### Infinite Query (`x-pagination`)

Set `x-pagination: true` on a GET operation to generate infinite query hooks (`useSWRInfinite`, `useInfiniteQuery`, …).

```yaml
paths:
  /items:
    get:
      x-pagination: true
```

The flag cannot say where paging starts, how to read the next cursor, or which parameter carries
it, so the TanStack-family hooks take those as a `pagination` argument. TanStack Query, Preact
Query, Solid Query, Svelte Query and Angular Query all emit a `listItemsInfiniteQueryOptions`
factory (built on `infiniteQueryOptions`) alongside hooks with the same signature:

```ts
const items = useListItemsInfinite(
  undefined, // the request options, as for `useListItems`
  {
    initialPageParam: 0, // binds TPageParam — `data.pageParams` is `number[]`
    getNextPageParam: (lastPage) => lastPage.nextPage,
    buildInit: (pageParam) => ({ query: { page: String(pageParam) } }), // pageParam → request
  },
  { staleTime: 60_000 }, // optional extra options (Solid: a thunk returning them)
)
items.data?.pages // InfiniteData — one entry per fetched page
```

A hook's extra options are the library's own options type minus what the hook supplies itself —
`queryKey` and `queryFn`, plus the page-param functions for infinite hooks — so
`useListUsers(undefined, { enabled: false })` needs no key of its own.

Vue Query types `initialPageParam` as `MaybeRefDeep<TPageParam>`, which a generic page param can
never satisfy, so it has no factory: `pagination` carries only `buildInit`, and `initialPageParam`
/ `getNextPageParam` go in the (required) third argument. SWR's `useListItemsInfinite` takes
`buildInit(pageIndex, previousPage)` and stops when it returns `null`.

### Mutation options and immutable SWR hooks

Every TanStack-family mutation also gets a `createUserMutationOptions()` factory built on
`mutationOptions` — reusable for `queryClient.setMutationDefaults` — which the `useCreateUser`
hook spreads. Every SWR query also gets a `useImmutable<Operation>` hook on `useSWRImmutable`:
same key and fetcher, fetched once and never revalidated.

## Test Generation

Generate [`bun:test`](https://elysiajs.com/patterns/unit-test) tests straight from the spec. The app entry is emitted as `export const app = new Elysia(...)...` with `.listen()` guarded by `import.meta.main`, so tests **import the real assembled app** and call `app.handle(new Request(...))` against its actual routing — importing the app never starts a server. Each operation gets a happy-path test asserting the spec's success status (`expect(res.status).toBe(200)`), plus a `401` test when it is secured and a `404` test when the spec declares a `404`. Request bodies and parameters are mocked with [`@faker-js/faker`](https://fakerjs.dev/).

Handlers are emitted as empty stubs, so the generated tests are the **contract your implementation must satisfy** — they start red and you fill in the handlers to make them pass (TDD red → green). Re-running preserves your hand-written `describe` blocks and handler logic; only the generated tests are refreshed. Only `bun:test` is generated — run with `bun test`.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  test: {
    output: 'src/app.test.ts', // name it *.test.ts so `bun test` discovers it
  },
})
```

This writes a single `src/app.test.ts` that imports the app:

```ts
import { describe, it, expect } from 'bun:test'
import { app } from './index'

describe('Shop API', () => {
  describe('users', () => {
    describe('GET /users', () => {
      it('should return 200', async () => {
        const res = await app.handle(new Request(`http://localhost/users`, { method: 'GET' }))
        expect(res.status).toBe(200)
      })
    })
  })
})
```

### Splitting test files (`split: true`)

Set `split: true` to **co-locate** a test next to each module — `src/modules/<resource>/index.test.ts`. There is no `output`; the location is derived from the generated modules. Each file imports the shared `app` and asserts only its own resource's routes (no barrel — `bun test` discovers `*.test.ts` directly):

```ts
export default defineConfig({
  input: 'openapi.yaml',
  test: {
    split: true, // no `output` — tests live beside each module
  },
})
```

```
src/
├── index.ts                  // export const app = new Elysia()...
└── modules/
    ├── users/
    │   ├── index.ts
    │   └── index.test.ts      // ← generated: import { app } from '../../index'
    └── posts/
        ├── index.ts
        └── index.test.ts
```

```ts
// src/modules/users/index.test.ts
import { describe, it, expect } from 'bun:test'
import { app } from '../../index'

describe('Shop API', () => {
  describe('users', () => {
    describe('GET /users', () => {
      it('should return 200', async () => {
        const res = await app.handle(new Request(`http://localhost/users`, { method: 'GET' }))
        expect(res.status).toBe(200)
      })
    })
  })
})
```

### Import resolution (`pathAlias`)

`pathAlias` rewrites the app import — the default is a relative path to the app entry (`./index` for a single file, `../../index` for co-located split), so generated tests work out of the box. Set it to import through a TypeScript path alias instead (requires a matching `paths` entry in your `tsconfig.json`):

```ts
export default defineConfig({
  input: 'openapi.yaml',
  test: {
    split: true,
    pathAlias: '@/', // import becomes `@/index`
  },
})
```

## Mock Server

Generate a single, self-contained Elysia mock server from the spec — every operation returns a [`@faker-js/faker`](https://fakerjs.dev/)-generated mock of its success response (install faker alongside it). `.listen()` is guarded by `import.meta.main`, so importing it starts no server.

```ts
export default defineConfig({
  input: 'openapi.yaml',
  mock: { output: 'src/mock.ts' },
})
```

The unhappy paths the spec promises are wired up too, so a client can exercise them:

- an operation that is secured **and** declares a `401` answers `401` when the credential is absent (`http` / `oauth2` schemes look at `Authorization`; `apiKey` at its header, query or cookie). Only presence is checked — a mock has no user store.
- a path parameter answers `404` for a sentinel value when the operation declares a `404`. The sentinel is the one the test generator sends, so generated tests and the mock agree on which value means "not there": `-1` for a number, the nil UUID for `format: uuid`, `__non_existent__` otherwise.

Credentials are checked before existence, so an anonymous request never learns what is there.

### Options

| Option                  | Default    | Purpose                                                                                                                                                                                                |
| ----------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `output`                | —          | File the mock server is written to. Required.                                                                                                                                                          |
| `useExamples`           | `true`     | Serve the `example` / `examples` the spec declares instead of a faker value. `$ref` into `components.examples` is resolved; an `examples` entry that only carries `externalValue` falls back to faker. |
| `locale`                | —          | Faker locale code — swaps the import to `@faker-js/faker/locale/<locale>` and nothing else.                                                                                                            |
| `delay`                 | —          | Milliseconds every response waits (`0`–`60000`), `{ min, max }` to pick from a range, or `false`. Applied as middleware, so handlers are byte-identical without it.                                    |
| `arrayMin` / `arrayMax` | `1` / `10` | Array length when the schema declares no `minItems` / `maxItems`.                                                                                                                                      |

`prefix` and `port` come from the top-level config — they describe the server the mock stands in
for, not the mock itself.

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

## Full Config Reference

> `split: true` — `output` is a **directory** (one file per entry + `index.ts` barrel; `test` is the exception — it takes no `output` and co-locates `*.test.ts` beside each controller).
> `split: false` (default) — `output` is a **single `.ts` file**.

```ts
// asphodelos.config.ts
import { defineConfig } from 'asphodelos'

export default defineConfig({
  // OpenAPI spec file (.yaml, .json, or .tsp)
  input: 'openapi.yaml',

  // App entry path — directory becomes the base for modules/ and components/
  // (default: 'src/index.ts')
  output: 'src/index.ts',

  // Server-side prefix (mirrors `new Elysia({ prefix })`)
  prefix: '/api/v3',

  // oxfmt FormatConfig for generated code output
  // format: {},

  // .listen(...) port (default '3000'); ignored when integration: true
  port: '3000',

  // Skip .listen(...) so a host framework owns the HTTP server
  integration: false,

  // Use the tsconfig `@/` alias for cross-file imports
  pathAlias: false,

  // Wrap top-level emitted schemas in t.Readonly(...)
  readonly: false,

  // Components (OpenAPI Components Object). `output` (single-file aggregate) and
  // the per-type fields below are mutually exclusive — pick one mode. `split: true`
  // makes a per-type `output` a directory (one file per entry + an index.ts
  // barrel); omit it (default `false`) for a single bundled `.ts` file. `import`
  // overrides the auto-derived specifier. `exportTypes: true` adds
  // `export type X = Static<typeof XSchema>` aliases on schemas / responses /
  // parameters / requestBodies / headers / mediaTypes.
  //
  // Single-file mode:
  // components: { output: 'src/components.ts' },
  components: {
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

  // Self-contained `App` type for Eden client distribution
  types: {
    output: 'src/types.ts',
  },

  // Eden Treaty per-operation wrapper functions
  eden: {
    output: 'src/eden.ts',
    import: './lib',
    client: 'client',
    docs: true,
  },

  // bun:test routing smoke tests against the exported `app` (imported, not re-built).
  // split: false (default) — single bundled file at `output` (name it *.test.ts).
  // split: true — co-located `modules/<resource>/index.test.ts` per module; no `output`.
  // `pathAlias` (e.g. '@/') rewrites the app import; omitted, a relative path is used.
  test: {
    split: true,
    pathAlias: '@/',
  },

  // Single-file Elysia mock server: every operation returns a faker mock.
  mock: {
    output: 'src/mock.ts',
  },

  // Client library integrations — each accepts the same shape.
  // `import` is required; `client` defaults to 'client'.
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

## Custom Validation Error Messages

Use `x-*` vendor extensions to customize Elysia / TypeBox error messages. Each extension follows the `x-<jsonSchemaKeyword>-message` naming convention and survives the OpenAPI round-trip.

```yaml
name:
  type: string
  minLength: 3
  maxLength: 20
  x-error-message: 'name must be a string'
  x-minLength-message: 'name must be at least 3 characters'
  x-maxLength-message: 'name must be at most 20 characters'
```

### Extension Reference

`Reachable?` legend:

- ✓ — 422 dispatch and OpenAPI round-trip both verified by `src/core/runtime.test.ts`
- ⚠ round-trip only — keyword survives on the emitted schema options but Elysia 1.4 cannot route a 422 to it
- ⚠ best-effort — branch emitted, but a sibling child error is dispatched first under typical inputs

#### Common (any schema type)

| Extension            | Applies to                                             | Reachable?        |
| -------------------- | ------------------------------------------------------ | ----------------- |
| `x-error-message`    | Schema constructor (type mismatch / generic fallback)  | ✓                 |
| `x-required-message` | `required[]` (missing required field on parent object) | ⚠ round-trip only |
| `x-const-message`    | `const` (literal mismatch)                             | ✓                 |
| `x-enum-message`     | `enum` (value not in list)                             | ✓                 |

#### Numeric (`number` / `integer`)

| Extension                    | Applies to         |
| ---------------------------- | ------------------ |
| `x-minimum-message`          | `minimum`          |
| `x-maximum-message`          | `maximum`          |
| `x-exclusiveMinimum-message` | `exclusiveMinimum` |
| `x-exclusiveMaximum-message` | `exclusiveMaximum` |
| `x-multipleOf-message`       | `multipleOf`       |

#### String

| Extension             | Applies to                                 |
| --------------------- | ------------------------------------------ |
| `x-minLength-message` | `minLength`                                |
| `x-maxLength-message` | `maxLength`                                |
| `x-pattern-message`   | `pattern` / `RegExp`                       |
| `x-length-message`    | Exact length (`minLength` === `maxLength`) |

#### Array

| Extension               | Applies to    |
| ----------------------- | ------------- |
| `x-minItems-message`    | `minItems`    |
| `x-maxItems-message`    | `maxItems`    |
| `x-uniqueItems-message` | `uniqueItems` |
| `x-contains-message`    | `contains`    |
| `x-minContains-message` | `minContains` |
| `x-maxContains-message` | `maxContains` |
| `x-prefixItems-message` | `prefixItems` |
| `x-items-message`       | `items`       |

#### Object

| Extension                         | Applies to                      | Reachable?        |
| --------------------------------- | ------------------------------- | ----------------- |
| `x-minProperties-message`         | `minProperties`                 | ✓                 |
| `x-maxProperties-message`         | `maxProperties`                 | ✓                 |
| `x-additionalProperties-message`  | `additionalProperties: false`   | ⚠ round-trip only |
| `x-propertyNames-message`         | `propertyNames` pattern check   | ✓                 |
| `x-patternProperties-message`     | `patternProperties`             | ⚠ round-trip only |
| `x-dependentRequired-message`     | `dependentRequired`             | ✓                 |
| `x-dependentSchemas-message`      | `dependentSchemas`              | ✓                 |
| `x-properties-message`            | `properties` (typeless schemas) | ⚠ round-trip only |
| `x-unevaluatedProperties-message` | `unevaluatedProperties`         | ⚠ round-trip only |
| `x-unevaluatedItems-message`      | `unevaluatedItems`              | ⚠ round-trip only |

#### Combinators / Conditional

| Extension               | Applies to                                                                                                       | Reachable?        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------- |
| `x-allOf-message`       | `allOf` (Intersect)                                                                                              | ⚠ best-effort     |
| `x-anyOf-message`       | `anyOf` (Union)                                                                                                  | ✓                 |
| `x-oneOf-message`       | `oneOf` (Union)                                                                                                  | ✓                 |
| `x-not-message`         | `not`                                                                                                            | ✓                 |
| `x-implication-message` | Implication pattern (`A → B`) encoded as `anyOf:[{not:A},{required:B}]`; takes precedence over `x-anyOf-message` | ✓                 |
| `x-if-message`          | `if` (shared fallback for `then` / `else`)                                                                       | ⚠ round-trip only |
| `x-then-message`        | `then`                                                                                                           | ⚠ round-trip only |
| `x-else-message`        | `else`                                                                                                           | ⚠ round-trip only |

## Behavior Extensions

### String Transforms

Wrap a `type: 'string'` schema in `t.Transform(...)` to normalize input.

> **Order matters: validation runs first, then the transform.** These compile to
> `t.Transform(<base>).Decode(fn)`, and TypeBox validates the incoming value against `<base>`
> before handing it to `Decode`. So `x-trim` with `minLength: 3` accepts `"  a  "` — six
> characters at validation time, trimmed to one afterwards — and `x-toLowerCase` with
> `pattern: ^[a-z]+$` rejects `"ABC"` rather than lower-casing it first. Write the constraints
> to match the value as it arrives on the wire, not as it looks after normalization. Pinned by
> `src/core/runtime.test.ts`.

| Extension                       | Generated            | Value                                   |
| ------------------------------- | -------------------- | --------------------------------------- |
| `x-trim`                        | `v.trim()`           | `true`                                  |
| `x-toLowerCase` / `x-lowercase` | `v.toLowerCase()`    | `true`                                  |
| `x-toUpperCase` / `x-uppercase` | `v.toUpperCase()`    | `true`                                  |
| `x-normalize`                   | `v.normalize('NFC')` | `'NFC'` / `'NFD'` / `'NFKC'` / `'NFKD'` |

```yaml
slug:
  type: string
  x-trim: true
  x-toLowerCase: true
```

### String Content Checks

Folded into the emitted `pattern`.

```yaml
url:
  type: string
  x-startsWith: 'https://'
  x-endsWith: '.com'
path:
  type: string
  x-includes: '/api/'
```

### Email Pattern Override

Override the emitted `pattern` for a `format: email` string with a custom regex.

| Extension      | Applies to                                          |
| -------------- | --------------------------------------------------- |
| `x-emailRegex` | Replaces the emitted `pattern` when `format: email` |

```yaml
contact:
  type: string
  format: email
  x-emailRegex: '^[a-z]+@example\.com$'
```

### Immutability

```yaml
config:
  type: object
  properties:
    name:
      type: string
  x-readonly: true
```

```ts
t.Readonly(t.Object({ name: t.String() }))
```

### Branded Types

Use `x-brand` on a primitive (string / number / integer / boolean) to emit a nominal-typed alias via `t.Unsafe`.

```yaml
components:
  schemas:
    UserId:
      type: string
      x-brand: UserId
```

```ts
const UserIdSchema = t.Unsafe<string & { readonly __brand: 'UserId' }>(t.String())
```

### Raw Transforms (`x-transform`)

`x-transform` carries a complete TypeBox `t.Transform(...)` expression that
**replaces** the emitted schema; `Decode` runs on requests, `Encode` on
responses.

```yaml
components:
  schemas:
    UpdatedAt:
      type: string
      format: date-time
      x-transform: >-
        t.Transform(t.String()).Decode((v) => new Date(v)).Encode((v) => v.toISOString())
```

```ts
const UpdatedAtSchema = t
  .Transform(t.String())
  .Decode((v) => new Date(v))
  .Encode((v) => v.toISOString())
```

> **⚠️ Security — author-trusted, verbatim code injection.** `x-transform` is emitted **verbatim**, without validation or sandboxing. Anything in it runs as code when the **generated module is imported** (not at generation time), so a hostile spec can achieve arbitrary code execution in your build / tests / CI. **Only generate from OpenAPI/TypeSpec specs you author or fully trust.**

TypeBox collapses Zod's `preprocess` / `transform` / `pipe` / `codec` into the single `t.Transform(T).Decode(fn).Encode(fn)` builder, so this one key covers every direction.

**Composition.** `x-transform` replaces the base schema; the usual modifiers then compose around it exactly as for any other base — `nullable` adds `t.Union([…, t.Null()])`, `x-brand` adds `t.Unsafe<…>(…)`, `x-readonly` adds `t.Readonly(…)`. When `x-transform` sits on an `allOf` / `oneOf` / `anyOf` / `not` schema it replaces that combinator too. Note that `t.Union` (nullable) and `t.Unsafe` (`x-brand`) widen a `TTransform`'s decoded type, so if you need the decoded type preserved, express null / brand **inside** the transform itself rather than via `nullable` / `x-brand` on the same schema.

**Runtime caveats (Elysia / TypeBox).**

- **`Decode` runs on requests, `Encode` on responses.** A response transform only fires when the operation declares a response schema; without one, Elysia skips `Encode`.
- **query / path / header transforms should keep a `string` base.** Elysia coerces those wire values before `Decode`; a non-string base can hand the `Decode` callback an unexpected type. Do the parsing inside `Decode`.
- **Eden Treaty types are the decoded type, but the wire is the encoded value.** A `Date` transform makes the client type say `Date` while the JSON on the wire is a string — Eden does not re-decode on the client. Keep `Encode` a real inverse so the contract stays honest.

### Type-Only Metadata

These keys are accepted and round-tripped through OpenAPI, but emit no code of their own. Wire the matching custom format or pattern through your host application's TypeBox `Format` registry.

`x-uuidVersion`, `x-urlHostname`, `x-urlProtocol`, `x-urlNormalize`, `x-isoPrecision`, `x-isoOffset`, `x-isoLocal`, `x-macDelimiter`, `x-jwtAlg`, `x-hashAlg`, `x-hashEnc`

## Coercion Formats

Two `format` values route to Elysia's string-coercion factories. These are JSON Schema standard `format` values (OpenAPI 3.2 §4.7.4 allows implementation-defined values), **not** vendor extensions — a consumer that does not understand them treats them as opaque metadata.

| `format`         | Generates           | Notes                                                    |
| ---------------- | ------------------- | -------------------------------------------------------- |
| `numeric`        | `t.Numeric()`       | string → number runtime coercion (query / params / body) |
| `boolean-string` | `t.BooleanString()` | string → boolean runtime coercion                        |

### Coercion context matrix

Elysia coerces strings to typed values in every validated context (query / path / header / cookie **and** `application/json` body). The integer emitter additionally injects `maximum: Number.MAX_SAFE_INTEGER` on `t.Integer()` to block silent precision loss past 2^53-1. Pinned by `src/core/runtime.test.ts`.

| Context                 | Schema in OpenAPI                          | Generated TypeBox   | Coercion source                                                       |
| ----------------------- | ------------------------------------------ | ------------------- | --------------------------------------------------------------------- |
| `in: query`             | `type: integer`                            | `t.Integer()`       | Elysia runtime (automatic)                                            |
| `in: path`              | `type: number`                             | `t.Number()`        | Elysia runtime (automatic)                                            |
| `in: header`            | `type: integer`                            | `t.Integer()`       | Elysia runtime (automatic)                                            |
| `in: cookie`            | `type: integer`                            | `t.Integer()`       | Elysia runtime (automatic)                                            |
| `application/json` body | `type: integer`                            | `t.Integer()`       | Elysia runtime (automatic — accepts both `42` and `"42"`)             |
| `application/json` body | `type: integer` + `format: numeric`        | `t.Numeric()`       | TypeBox `Numeric` (accepts `"42"`) — equivalent in body context today |
| `application/json` body | `type: boolean` + `format: boolean-string` | `t.BooleanString()` | TypeBox `BooleanString` (accepts `"true"`)                            |

**Do not** add `format: numeric` / `format: boolean-string` to query / path / header / cookie parameters — it is a no-op at best and a double-wrap risk in future Elysia versions. Use these formats **only** to make the string-coercion intent explicit in the contract.

## Rejected Extensions

Considered and rejected. Please do not reopen without new normative data (an Elysia upstream policy change, a TypeBox API change, or a specification revision).

| Proposal                                 | Reason for rejection                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `x-refine`                               | Code-string extension, permanently rejected. Unlike `x-transform`, `.refine` has no serializable single-expression form and no security gate that makes it worth the injection surface. |
| `x-decode` / `x-encode`                  | A split builder chain is not JSON-serializable. Superseded by [`x-transform`](#raw-transforms-x-transform), which carries the whole `t.Transform(...)` chain in one scalar.             |
| `x-prefault`                             | Use the JSON Schema standard `default`.                                                                                                                                                 |
| `x-superRefine`                          | TypeBox has no `ctx.addIssue()` equivalent.                                                                                                                                             |
| `x-cookie-secrets`                       | Secrets must not be written into a public contract.                                                                                                                                     |
| `x-unionEnum` / `x-composite` / `x-form` | Express these via OpenAPI `enum` / `allOf` / `requestBody.content` directly.                                                                                                            |

## Contributing

Issues and PRs welcome. Please:

- Open an issue at [GitHub Issues](https://github.com/nakita628/asphodelos/issues)
- Submit a pull request with your improvements

## License

Distributed under the MIT License. See [LICENSE](https://github.com/nakita628/asphodelos?tab=MIT-1-ov-file) for more information.
