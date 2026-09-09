# Type-level regression fixtures

Each file asserts that the generics a generated hook declares — `TError`, the data type, the page
param — actually reach the caller. A hook can compile while silently resolving a generic to `any`
or to the library's default, and no runtime test catches that: the value is still there, only its
type is gone.

These are compiled by `tsc -p cases/<library>` through each case's tsconfig `include`, so a
regression fails `bun run typecheck`.
