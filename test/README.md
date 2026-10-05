# Client suite

The package's own tests compare the generator's output to a string, which proves the code was
written and nothing more. This workspace closes that gap on three axes:

1. **Does the generated code compile against the real libraries?** `bun run typecheck` runs
   `tsc -p cases/<name>` with the actual `@tanstack/*` and `swr` type definitions installed. A
   hook whose generics are wrong compiles fine in isolation and fails here.
2. **Does it run?** `runtime/` mounts the generated hooks against a hand-written host app and
   asserts on real behavior — what the query function resolves with, what a cache invalidation
   reaches, whether a mutation fires before it is triggered.
3. **Do the generics survive?** `types/` pins that a hook's type parameters reach the caller. A
   generic that degrades to `any` still works at runtime, so no runtime test can see it.

It also drives the **packaged** CLI from `dist`, so a packaging or `exports` regression fails
here rather than in someone's project — and the packaged Vite plugin inside a real Vite dev server
(`runtime/vite-plugin.test.ts`): it generates on start, regenerates on a document edit, and reloads
an edited config.

Two self-contained suites, `query-params/` and `path-params/`, send every parameter shape the
generator supports through a real Elysia app built on the generated models: a query string or a
path segment in, the JavaScript type and value that reached the handler out. HTTP carries every
parameter as text, so a schema Elysia cannot read back into its type rejects its own input, and
that is what these catch. Each holds the requests that are accepted, the ones that are rejected,
and compile-time assertions about the generated types.

## Layout

```text
cases/<name>/     one asphodelos.config.ts + tsconfig.json per client library
specs/            the OpenAPI documents the cases generate from
hosts/            the Elysia app and Eden client the generated hooks talk to
runtime/          tests that execute the generated hooks, and the Vite plugin in a dev server
types/            compile-time assertions about the generics
query-params/     a self-contained case: document, config, echo app and tests, in one directory
path-params/      the same for path parameters
client/           the generated Eden Treaty client, under a path alias, driven over HTTP against
                  hosts/users-server.ts in a process of its own
monorepo/         the client in a package of its own: apps/elysia, apps/eden and apps/react reach
                  each other by package name, mapped in the case's tsconfig
scripts/          cases.ts, generate.ts, typecheck.ts, pretest.ts
__generated__/    output; gitignored, refreshed before every run (a root-level case has its own)
```

## Coverage per library

| Library          | Generated & typechecked | Generic assertions | Executed                                 |
| ---------------- | ----------------------- | ------------------ | ---------------------------------------- |
| `swr`            | ✅                      | ✅                 | ✅ React + happy-dom                     |
| `tanstack-query` | ✅                      | ✅                 | ✅ real `QueryClient`, React + happy-dom |
| `preact-query`   | ✅                      | ✅                 | —                                        |
| `vue-query`      | ✅                      | ✅                 | ✅ Vue app context                       |
| `solid-query`    | ✅                      | ✅                 | —                                        |
| `svelte-query`   | ✅                      | ✅                 | —                                        |
| `angular-query`  | ✅                      | ✅                 | —                                        |

The four that are not executed need a framework runtime this suite does not host; they are
compiled against the real library types, which is what catches a wrong generic.

## Running it

```bash
bun run test:clients   # from the repository root: build, typecheck, run
```

`__generated__` is refreshed by a preload (`bunfig.toml`), so a run can never measure output from
an earlier version of the generator. The preload needs the package built — `bun run build` — which
`test:clients` does first.
