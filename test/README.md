# Client suite

The package's own tests compare the generator's output to a string, which proves the code was
written and nothing more. This workspace closes that gap on three axes:

1. **Does the generated code compile against the real libraries?** `bun run typecheck` runs
   `tsc -p cases/<name>` with the actual `@tanstack/*` and `swr` type definitions installed. A
   hook whose generics are wrong compiles fine in isolation and fails here.
2. **Does it run?** `runtime/` mounts the generated hooks against a hand-written host app and
   asserts on real behaviour — what the query function resolves with, what a cache invalidation
   reaches, whether a mutation fires before it is triggered.
3. **Do the generics survive?** `types/` pins that a hook's type parameters reach the caller. A
   generic that degrades to `any` still works at runtime, so no runtime test can see it.

It also drives the **packaged** CLI from `dist`, so a packaging or `exports` regression fails
here rather than in someone's project.

## Layout

```
cases/<name>/     one asphodelos.config.ts + tsconfig.json per client library
specs/            the OpenAPI documents the cases generate from
hosts/            the Elysia app and Eden client the generated hooks talk to
runtime/          tests that execute the generated hooks
types/            compile-time assertions about the generics
scripts/          generate.ts, typecheck.ts, pretest.ts
__generated__/    output; gitignored, refreshed before every run
```

## Coverage per library

| Library          | Generated & typechecked | Generic assertions | Executed              |
| ---------------- | ----------------------- | ------------------ | --------------------- |
| `swr`            | ✅                      | ✅                 | ✅ React + happy-dom  |
| `tanstack-query` | ✅                      | ✅                 | ✅ real `QueryClient` |
| `preact-query`   | ✅                      | —                  | —                     |
| `vue-query`      | ✅                      | —                  | —                     |
| `solid-query`    | ✅                      | —                  | —                     |
| `svelte-query`   | ✅                      | —                  | —                     |
| `angular-query`  | ✅                      | —                  | —                     |

The five that are not executed need a framework runtime this suite does not host; they are
compiled against the real library types, which is what catches a wrong generic.

## Running it

```bash
bun run test:clients   # from the repository root: build, typecheck, run
```

`__generated__` is refreshed by a preload (`bunfig.toml`), so a run can never measure output from
an earlier version of the generator. The preload needs the package built — `bun run build` — which
`test:clients` does first.
