import { describe, expect, it } from 'bun:test'

import { parseSync } from 'oxc-parser'

import { statementKey } from './statement-key.js'

function keyOf(src: string) {
  const { program } = parseSync('t.ts', src, { lang: 'ts', sourceType: 'module' })
  const stmt = program.body[0]
  if (!stmt) throw new Error('no statement')
  return statementKey(src, stmt)
}

describe('statementKey', () => {
  it('returns class:<name> for named class declarations', () => {
    expect(keyOf('class Foo {}')).toBe('class:Foo')
  })

  it('returns fn:<name> for named function declarations', () => {
    expect(keyOf('function bar() {}')).toBe('fn:bar')
  })

  it('returns var:<first-name> for variable statements', () => {
    expect(keyOf('const app = 1')).toBe('var:app')
  })

  it('returns type:<name> for type aliases', () => {
    expect(keyOf('type App = number')).toBe('type:App')
  })

  it('returns interface:<name> for interface declarations', () => {
    expect(keyOf('interface Config {}')).toBe('interface:Config')
  })

  it("returns describe:<title> for describe('title', ...) calls", () => {
    expect(keyOf("describe('xyz', () => {})")).toBe('describe:xyz')
  })

  it('returns expr:<callee>(<argSig>) for arbitrary call expressions', () => {
    expect(keyOf("console.log('a')")).toBe("expr:console.log('a')")
  })

  it('differentiates same-callee statements by literal argument value', () => {
    const a = keyOf("console.log('a')")
    const b = keyOf("console.log('b')")
    expect(a).not.toBe(b)
  })

  it('keys if-statements by their condition text (stable across regeneration)', () => {
    expect(keyOf('if (import.meta.main) { app.listen(3000) }')).toBe('if:import.meta.main')
  })

  it('returns null for for/return blocks (no key)', () => {
    expect(keyOf('for (const x of y) { f(x) }')).toBe(null)
  })

  it('returns fn:<name> for a default-exported named function', () => {
    expect(keyOf('export default function main() {}')).toBe('fn:main')
  })

  it('keys an exported declaration like an unexported one', () => {
    expect(keyOf('export const app = 1')).toBe(keyOf('const app = 1'))
  })

  it('returns null for a default export that is an expression', () => {
    expect(keyOf('export default app')).toBe(null)
  })

  it('returns null for anonymous class declarations', () => {
    expect(keyOf('export default class {}')).toBe(null)
  })

  it('returns null for non-call ExpressionStatements', () => {
    expect(keyOf('1 + 2')).toBe(null)
  })

  it('preserves a called PropertyAccessExpression (console.log) verbatim in the key', () => {
    expect(keyOf('console.log()')).toBe('expr:console.log()')
  })

  it("normalizes a trailing semicolon so `console.log('a');` and `console.log('a')` share one key", () => {
    expect(keyOf("console.log('a');")).toBe(keyOf("console.log('a')"))
  })

  it('preserves semicolons inside template literal arguments (regex only strips trailing ;)', () => {
    expect(keyOf('console.log(`a;b`)')).toBe('expr:console.log(`a;b`)')
  })
})
