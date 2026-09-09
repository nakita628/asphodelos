import { describe, expect, it } from 'bun:test'

import { Project } from 'ts-morph'

import { statementKey } from './statement-key.js'

function firstStatement(src: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  const file = project.createSourceFile('t.ts', src)
  const stmt = file.getStatements()[0]
  if (!stmt) throw new Error('no statement')
  return stmt
}

describe('statementKey', () => {
  it('returns class:<name> for named class declarations', () => {
    expect(statementKey(firstStatement('class Foo {}'))).toBe('class:Foo')
  })

  it('returns fn:<name> for named function declarations', () => {
    expect(statementKey(firstStatement('function bar() {}'))).toBe('fn:bar')
  })

  it('returns var:<first-name> for variable statements', () => {
    expect(statementKey(firstStatement('const app = 1'))).toBe('var:app')
  })

  it('returns type:<name> for type aliases', () => {
    expect(statementKey(firstStatement('type App = number'))).toBe('type:App')
  })

  it('returns interface:<name> for interface declarations', () => {
    expect(statementKey(firstStatement('interface Config {}'))).toBe('interface:Config')
  })

  it("returns describe:<title> for describe('title', ...) calls", () => {
    expect(statementKey(firstStatement("describe('xyz', () => {})"))).toBe('describe:xyz')
  })

  it('returns expr:<callee>(<argSig>) for arbitrary call expressions', () => {
    expect(statementKey(firstStatement("console.log('a')"))).toBe("expr:console.log('a')")
  })

  it('differentiates same-callee statements by literal argument value', () => {
    const a = statementKey(firstStatement("console.log('a')"))
    const b = statementKey(firstStatement("console.log('b')"))
    expect(a).not.toBe(b)
  })

  it('keys if-statements by their condition text (stable across regen)', () => {
    expect(statementKey(firstStatement('if (import.meta.main) { app.listen(3000) }'))).toBe(
      'if:import.meta.main',
    )
  })

  it('returns null for for/return blocks (unkeyed)', () => {
    expect(statementKey(firstStatement('for (const x of y) { f(x) }'))).toBe(null)
  })

  it('returns null for anonymous class declarations', () => {
    expect(statementKey(firstStatement('export default class {}'))).toBe(null)
  })

  it('returns null for non-call ExpressionStatements', () => {
    expect(statementKey(firstStatement('1 + 2'))).toBe(null)
  })

  it('preserves PropertyAccessExpression callees (console.log) verbatim in the key', () => {
    expect(statementKey(firstStatement('console.log()'))).toBe('expr:console.log()')
  })

  it("normalizes a trailing semicolon so `console.log('a');` and `console.log('a')` share one key", () => {
    expect(statementKey(firstStatement("console.log('a');"))).toBe(
      statementKey(firstStatement("console.log('a')")),
    )
  })

  it('preserves semicolons inside template literal arguments (regex only strips trailing ;)', () => {
    expect(statementKey(firstStatement('console.log(`a;b`)'))).toBe('expr:console.log(`a;b`)')
  })
})
