import { afterAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import plugin from './custom.js'

/**
 * The convention plugin decides what `oxlint` accepts across `src`, so a false positive blocks
 * correct code and a false negative lets the convention rot silently. Every rule below is given
 * both: source it must accept, and source it must reject.
 *
 * The cases run `oxlint` itself over a throwaway file rather than driving the visitors directly.
 * oxlint's own `RuleTester` needs a Node runtime with raw transfer support and does not run under
 * `bun test`, and going through the binary has a second payoff: it checks that the rule is
 * reachable through a config at all, not merely that its visitor returns a report.
 *
 * Each case gets its own config with exactly one rule enabled, so a report can only have come
 * from the rule under test.
 */
const PLUGIN = path.resolve(import.meta.dir, 'custom.js')
// The package's own bin, not the workspace root's: `oxlint` is a devDependency here.
const OXLINT = path.resolve(import.meta.dir, '../node_modules/.bin/oxlint')

const workdirs: string[] = []

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

/** Lints `code` as `filename` with only `rule` enabled, and answers with what oxlint reported. */
function lint(rule: string, code: string, filename = 'src/core/thing.ts') {
  const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-lint-'))
  workdirs.push(dir)
  writeFileSync(
    path.join(dir, '.oxlintrc.json'),
    JSON.stringify({
      plugins: [],
      categories: {},
      jsPlugins: [PLUGIN],
      rules: { [`custom/${rule}`]: 'error' },
    }),
  )
  const file = path.join(dir, filename)
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, code)

  const run = spawnSync(OXLINT, ['-c', '.oxlintrc.json', '.'], {
    cwd: dir,
    encoding: 'utf-8',
  })
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`
  return {
    output,
    reports: (output.match(new RegExp(`custom\\(${rule}\\)`, 'g')) ?? []).length,
  }
}

/** Every case oxlint must leave alone, and every case it must flag. */
function check(
  rule: string,
  cases: {
    readonly valid: readonly (string | readonly [string, string])[]
    readonly invalid: readonly (string | readonly [string, string])[]
  },
) {
  const split = (entry: string | readonly [string, string]) =>
    typeof entry === 'string' ? ([entry, undefined] as const) : ([entry[0], entry[1]] as const)

  describe(rule, () => {
    for (const [index, entry] of cases.valid.entries()) {
      const [code, filename] = split(entry)
      it(`accepts #${index + 1}: ${code.split('\n')[0]?.slice(0, 60)}`, () => {
        const run = filename === undefined ? lint(rule, code) : lint(rule, code, filename)
        expect(run.reports).toBe(0)
      })
    }
    for (const [index, entry] of cases.invalid.entries()) {
      const [code, filename] = split(entry)
      it(`rejects #${index + 1}: ${code.split('\n')[0]?.slice(0, 60)}`, () => {
        const run = filename === undefined ? lint(rule, code) : lint(rule, code, filename)
        expect(run.reports).toBeGreaterThan(0)
      })
    }
  })
}

const SPEC = 'src/core/thing.test.ts'

describe('the plugin exposes every rule the config enables', () => {
  it('registers all eight rules under the `custom` namespace', () => {
    expect(plugin.meta.name).toBe('custom')
    expect(Object.keys(plugin.rules).toSorted()).toStrictEqual([
      'effect-gen-return',
      'effect-promise-import',
      'function-declaration',
      'no-effect-flatmap',
      'no-effect-fn',
      'no-effect-run',
      'predicate-is-name',
      'type-pascal-case',
    ])
  })
})

check('effect-gen-return', {
  valid: [
    `export function read(input) {
  return Effect.gen(function* () {
    return yield* something(input)
  })
}`,
    // A trailing `.pipe(...)` for scoping or recovery is part of the shape.
    `function read(input) {
  return Effect.gen(function* () {
    return yield* something(input)
  }).pipe(Effect.provideService(Options, {}))
}`,
    `function read(input) {
  return Effect.gen(function* () {
    return yield* something(input)
  }).pipe(Effect.mapError(toError), Effect.orElseSucceed(() => null))
}`,
    // Test files arrange imperatively; the structural rule describes `src`.
    [
      `const program = Effect.gen(function* () {
  return yield* something()
})`,
      SPEC,
    ],
  ],
  invalid: [
    `const program = Effect.gen(function* () {
  return yield* something()
})`,
    // An arrow owner is rejected too: the declaration is what names the program.
    `const read = (input) =>
  Effect.gen(function* () {
    return yield* something(input)
  })`,
    // Passing it straight to a combinator hides the program's name entirely.
    `Effect.runPromise(
  Effect.gen(function* () {
    return yield* something()
  }),
)`,
    // A named generator adds a second name for the same thing.
    `function read() {
  return Effect.gen(function* named() {
    return yield* something()
  })
}`,
  ],
})

check('no-effect-fn', {
  valid: [
    `function read(input) {
  return Effect.gen(function* () {
    return yield* something(input)
  })
}`,
    'export const fn = Other.fn(() => 1)',
  ],
  invalid: [
    'export const read = Effect.fn(function* () {})',
    'export const read = Effect.fnUntraced(function* () {})',
    // Unlike the structural rules, this one applies to tests as well.
    ['export const read = Effect.fn(function* () {})', SPEC],
  ],
})

check('no-effect-flatmap', {
  // Only the two sequencing combinators are banned; the rest stay available.
  valid: [
    'export const a = Effect.map(effect, toValue)',
    'export const a = Effect.mapError(effect, toError)',
    'export const a = Effect.tap(effect, log)',
    'export const a = Effect.catchIf(effect, isNotFound, recover)',
    'export const a = promise.flatMap(next)',
  ],
  invalid: [
    'export const a = Effect.flatMap(effect, next)',
    'export const a = Effect.andThen(effect, next)',
    ['export const a = Effect.flatMap(effect, next)', SPEC],
  ],
})

check('no-effect-run', {
  valid: [
    `function read() {
  return Effect.succeed(1)
}`,
    // The runner is not an `Effect.*` member here, so the rule does not match it.
    'NodeRuntime.runMain(program)',
    // The rule itself skips test files; the two boundary directories are exempted by the
    // project config instead, which the `overrides` case at the bottom checks.
    ['Effect.runPromise(program)', SPEC],
  ],
  invalid: [
    'Effect.runPromise(program)',
    'Effect.runSync(program)',
    'Effect.runPromiseExit(program)',
    'Effect.runFork(program)',
  ],
})

check('effect-promise-import', {
  valid: [
    // A dynamic import of a bundled sibling cannot reject for a reason the program could answer.
    "export const mod = Effect.promise(() => import('./sibling.js'))",
    "export const mods = Effect.promise(() => Promise.all([import('./a.js'), import('./b.js')]))",
    'export const value = Effect.tryPromise({ try: () => fetchIt(), catch: toError })',
    ['export const value = Effect.promise(() => fetchIt())', SPEC],
  ],
  invalid: [
    'export const value = Effect.promise(() => fetchIt())',
    'export const value = Effect.promise(async () => await fetchIt())',
    // `Promise.all` only earns the exemption when every element is a dynamic import.
    "export const value = Effect.promise(() => Promise.all([import('./a.js'), fetchIt()]))",
  ],
})

check('function-declaration', {
  valid: [
    `export function read(input) {
  return input
}`,
    // A const carrying a contextual type annotation is the sanctioned exception.
    'const handler: Handler = (input) => input',
    'export const value = 1',
    ['export const read = (input) => input', SPEC],
  ],
  invalid: [
    'export const read = (input) => input',
    `export const read = function (input) {
  return input
}`,
  ],
})

check('type-pascal-case', {
  valid: ['export type Config = { a: string }', 'export type OpenAPI = unknown'],
  invalid: [
    'export type config = { a: string }',
    'export type openAPI = unknown',
    // Unlike the structural rules, this one has no test-file exemption.
    ['export type cfg = 1', SPEC],
  ],
})

check('predicate-is-name', {
  valid: [
    `export function isRecord(v) {
  return typeof v === 'object'
}`,
    `export function hasSchema(v) {
  return 'schema' in v
}`,
    `export function canWrite(v) {
  return v !== null
}`,
    // Not a predicate: the return is not a boolean expression.
    `export function nameOf(v) {
  return v.name
}`,
    [
      `export function checkThing(v) {
  return typeof v === 'string'
}`,
      SPEC,
    ],
  ],
  invalid: [
    `export function checkThing(v) {
  return typeof v === 'string'
}`,
    `export function recordLike(v) {
  return v !== null && v !== undefined
}`,
  ],
})

/**
 * `no-effect-run` is enforced everywhere by the rule and relaxed only where an Effect meets a
 * world that is not one. That relaxation is a path override in `oxlint.config.ts`, not something
 * the rule knows about, so it is checked against the real project config.
 */
describe('oxlint.config.ts — the boundary exemption', () => {
  const PKG = path.resolve(import.meta.dir, '..')

  function lintInPackage(relative: string, code: string) {
    const file = path.join(PKG, relative)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, code)
    try {
      const run = spawnSync(OXLINT, [relative], { cwd: PKG, encoding: 'utf-8' })
      return `${run.stdout ?? ''}${run.stderr ?? ''}`
    } finally {
      rmSync(file, { force: true })
    }
  }

  it('runs an Effect only inside the vite plugin and the test helpers', () => {
    const banned = lintInPackage('src/core/tmp-runner-probe.ts', 'Effect.runPromise(program)\n')
    expect(banned).toContain('custom(no-effect-run)')

    for (const boundary of [
      'src/vite-plugin/tmp-runner-probe.ts',
      'src/testing/tmp-runner-probe.ts',
    ]) {
      expect(lintInPackage(boundary, 'Effect.runPromise(program)\n')).not.toContain(
        'custom(no-effect-run)',
      )
    }
  })
})
