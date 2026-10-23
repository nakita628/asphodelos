import type { Statement } from 'oxc-parser'

import { declarationOf, textOf } from './syntax.js'

/**
 * The key a top-level statement is merged by, or `null` for one that is never matched across the
 * two files and is kept from wherever it came.
 *
 * The prefix encodes the merge semantics: a `class:`, `fn:`, `var:`, `type:`, `interface:`, `if:`
 * or `describe:` statement in both files is taken from the existing file, so the user's edits
 * win; an `expr:` statement — a bare call such as `console.log(…)` — is emitted on the first run
 * and then belongs to the user, so one the user deleted stays deleted.
 */
export function statementKey(code: string, statement: Statement): string | null {
  const node = declarationOf(statement)
  if (node.type === 'ClassDeclaration') return node.id ? `class:${node.id.name}` : null
  if (node.type === 'FunctionDeclaration') return node.id ? `fn:${node.id.name}` : null
  if (node.type === 'VariableDeclaration') {
    const first = node.declarations[0]
    if (!first) return null
    // A binding pattern — `const { a } = …` — is keyed by its own text.
    return `var:${first.id.type === 'Identifier' ? first.id.name : textOf(code, first.id)}`
  }
  if (node.type === 'TSTypeAliasDeclaration') return `type:${node.id.name}`
  if (node.type === 'TSInterfaceDeclaration') return `interface:${node.id.name}`
  if (node.type === 'IfStatement') return `if:${textOf(code, node.test).trim()}`
  if (node.type !== 'ExpressionStatement') return null
  const expression = node.expression
  if (expression.type !== 'CallExpression') return null
  const { callee } = expression
  const [first] = expression.arguments
  if (
    callee.type === 'Identifier' &&
    callee.name === 'describe' &&
    first?.type === 'Literal' &&
    typeof first.value === 'string'
  ) {
    return `describe:${first.value}`
  }
  const argSig = expression.arguments
    .map((argument) => textOf(code, argument).trim().replace(/;$/u, ''))
    .join(',')
  return `expr:${textOf(code, callee).trim()}(${argSig})`
}
