import { describe, expect, it } from 'bun:test'

import { Effect } from 'effect'
import type { FormatConfig } from 'oxfmt'

import { runGenerator, runGeneratorError } from '../testing/index.js'
import { fmt, FormatOptions } from './index.js'

/** Formats with an explicit option set, the way a config file's `format` block does. */
const fmtWith = (options: FormatConfig, input: string) =>
  runGenerator(fmt(input).pipe(Effect.provideService(FormatOptions, options)))

describe('fmt', () => {
  it.concurrent('returns formatted code', async () => {
    const result = await runGenerator(fmt("const takibi = 'asphodelos';"))
    expect(result).toStrictEqual("const takibi = 'asphodelos'\n")
  })

  it.concurrent('fails with the parser message for invalid code', async () => {
    const result = await runGeneratorError(fmt('const = ;'))
    expect(result._tag).toBe('FormatError')
    expect(result.message).toStrictEqual('Unexpected token')
  })
})

describe('FormatOptions', () => {
  it.concurrent('uses the defaults when nothing is provided', async () => {
    const result = await runGenerator(fmt("const x = 'hello';"))
    expect(result).toStrictEqual("const x = 'hello'\n")
  })

  const cases: readonly (readonly [string, FormatConfig, string, string])[] = [
    [
      'semi: true adds semicolons',
      { semi: true, singleQuote: true },
      "const x = 'hello'",
      "const x = 'hello';\n",
    ],
    [
      'singleQuote: false uses double quotes',
      { singleQuote: false, semi: false },
      "const x = 'hello'",
      'const x = "hello"\n',
    ],
    [
      'semi + singleQuote combined',
      { semi: true, singleQuote: false },
      "const x = 'hello'",
      'const x = "hello";\n',
    ],
    [
      'tabWidth: 4 indents with four spaces',
      { tabWidth: 4, singleQuote: true, semi: false },
      'function f() {\nreturn 1\n}',
      'function f() {\n    return 1\n}\n',
    ],
    [
      'useTabs: true indents with tabs',
      { useTabs: true, singleQuote: true, semi: false },
      'function f() {\nreturn 1\n}',
      'function f() {\n\treturn 1\n}\n',
    ],
    [
      'trailingComma: none drops the trailing comma',
      { trailingComma: 'none', singleQuote: true, semi: false },
      'const obj = {\n  a: 1,\n  b: 2,\n}',
      'const obj = {\n  a: 1,\n  b: 2\n}\n',
    ],
    [
      'arrowParens: avoid omits parens on a single param',
      { arrowParens: 'avoid', singleQuote: true, semi: false },
      'const f = (x) => x + 1',
      'const f = x => x + 1\n',
    ],
    [
      'arrowParens: always keeps them',
      { arrowParens: 'always', singleQuote: true, semi: false },
      'const f = x => x + 1',
      'const f = (x) => x + 1\n',
    ],
    [
      'bracketSpacing: false tightens object literals',
      { bracketSpacing: false, singleQuote: true, semi: false },
      'const obj = { a: 1 }',
      'const obj = {a: 1}\n',
    ],
  ]

  it.concurrent.each(cases)('%s', async (_name, options, input, expected) => {
    expect(await fmtWith(options, input)).toStrictEqual(expected)
  })

  it.concurrent('printWidth: 40 wraps a long line', async () => {
    const result = await fmtWith(
      { printWidth: 40, singleQuote: true, semi: false },
      'const result = { alpha: 1, beta: 2, gamma: 3 }',
    )
    expect(result.trim().split('\n').length).toBeGreaterThan(1)
  })

  it.concurrent('one run cannot leak its options into another', async () => {
    // The Reference is per-program, so this is what keeps two configs in one process apart.
    expect(await fmtWith({ semi: true }, "const x = 'hello'")).toStrictEqual("const x = 'hello';\n")
    expect(await runGenerator(fmt("const x = 'hello'"))).toStrictEqual("const x = 'hello'\n")
  })
})
