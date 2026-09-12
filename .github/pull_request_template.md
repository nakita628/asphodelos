<!--
Title: an imperative sentence in the shape of the commit history, with no `feat:` / `fix:`
prefix and no trailing period. Write it for the person reading the release notes, not for the diff.

  Generate the client cases before typechecking them
  Leave mutationKey and mutationFn out of the mutation hooks' options

The title is the page's top-level heading, so the body starts at `##`.
-->

<!-- markdownlint-disable MD041 -->

## Why

<!-- The bug, the missing capability or the request behind this change. Link the issue: `Closes #123`. -->

## What

<!-- What changed, as someone running the CLI or reading the generated code sees it. One to three sentences. -->

## Where

<!-- Scope: which generator (the Elysia app and modules, TypeBox components, types, Eden, client hooks, test, mock), the OpenAPI / TypeSpec parser, the CLI, the config, the Vite plugin. Name what is deliberately left out. -->

## Who

<!-- Who notices: every user, users of one generator or one client library, contributors only. Breaking for anyone? -->

## When

<!-- Release impact: `none` | `next release` | `version bumped to x.y.z`. -->

## How

<!--
The approach in a sentence, then the evidence. For a generator change, the spec and the
output it now writes — `test/__generated__` is not committed, so paste the lines that changed.
Tick only what you ran; paste the output of anything that failed.
-->

<!-- textlint-disable no-todo -- the boxes are the checklist to tick, not parked work -->

- [ ] `bun run check`
- [ ] `packages/asphodelos/README.md` updated, when the config, the CLI, the Vite plugin or the generated output changed
