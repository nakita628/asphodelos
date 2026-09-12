# AGENTS.md

Instructions for coding agents working on this repository, which is operated by agents alone.
The full rules live in [`.cursor/rules/`](.cursor/rules) and are also read automatically by
Cursor:

| Rule               | Applies to                                 | Covers                                                          |
| ------------------ | ------------------------------------------ | --------------------------------------------------------------- |
| `project.mdc`      | always                                     | repository map, commands, invariants, definition of done, Git   |
| `typescript.mdc`   | `**/*.ts`, `**/*.tsx`                      | the code conventions the oxlint configuration enforces          |
| `effect.mdc`       | `packages/asphodelos/src/**`               | the Effect program shape, errors and services                   |
| `architecture.mdc` | `packages/asphodelos/src/**`               | layering, responsibilities, user code in the output, public API |
| `testing.mdc`      | `**/*.test.ts`, `**/*.test.tsx`, `test/**` | `bun:test` conventions and the client suite                     |
| `docs.mdc`         | `**/*.md`                                  | markdownlint, textlint and cspell                               |
| `ci-config.mdc`    | workflows, manifests, lint configs         | action pinning, editing the lint config, dependencies, release  |
| `playbooks.mdc`    | on request                                 | step-by-step recipes for the recurring tasks                    |

## The short version

```bash
bun install --frozen-lockfile
bun run fix     # formatting, oxlint, markdownlint, textlint autofixes
bun run check   # format check, all linters, type check, unit tests, client suite
```

`bun run check` must pass before a change is finished — it is exactly what CI runs. Never relax
a linter to get a change through, never delete or overwrite the code users keep in the `elysia`
and `test` output, and write everything committed in English.
