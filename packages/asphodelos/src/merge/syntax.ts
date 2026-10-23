import { parseSync } from 'oxc-parser'
import type { Comment, Declaration, Program, Span, Statement } from 'oxc-parser'

/**
 * A parsed module, read for positions, names and kinds only: every piece of text that is kept or
 * moved is sliced from `code` by a node's span, so that what is written back is the source as the
 * user wrote it, comments and formatting included.
 *
 * `errors` is what stopped the parser. A module that does not parse comes back with an empty tree
 * — the parser recovers nothing past a syntax error — in which every statement looks missing, so a
 * caller that reads a file a hand edit may have broken asks for the errors and leaves such a file
 * alone.
 */
export type Source = {
  readonly code: string
  readonly program: Program
  readonly comments: readonly Comment[]
  readonly errors: readonly string[]
}

export function parseSource(code: string): Source {
  const { program, comments, errors } = parseSync('module.ts', code, {
    lang: 'ts',
    sourceType: 'module',
  })
  return { code, program, comments, errors: errors.map((error) => error.message) }
}

export function textOf(code: string, node: Span) {
  return code.slice(node.start, node.end)
}

/**
 * A top-level statement with its `export` taken off: `export const x = …` is the variable
 * declaration, `export default class X {}` the class. Any other statement is itself.
 */
export function declarationOf(statement: Statement): Declaration | Statement {
  if (statement.type === 'ExportNamedDeclaration' && statement.declaration !== null) {
    return statement.declaration
  }
  if (
    statement.type === 'ExportDefaultDeclaration' &&
    (statement.declaration.type === 'FunctionDeclaration' ||
      statement.declaration.type === 'ClassDeclaration')
  ) {
    return statement.declaration
  }
  return statement
}

/**
 * The text of the statement at `index`, with the comments written above it.
 *
 * A comment belongs to the statement below it when it sits on a line of its own between the end
 * of the previous top-level node and the statement; a comment that trails the previous node on
 * its own line stays with that node and is not repeated here.
 */
export function statementText(source: Source, index: number) {
  const { code, comments, program } = source
  const statement = program.body[index]
  if (!statement) return ''
  const previousEnd = index === 0 ? 0 : (program.body[index - 1]?.end ?? 0)
  const leading = comments.find(
    (comment) =>
      comment.start >= previousEnd &&
      comment.end <= statement.start &&
      (previousEnd === 0 || code.slice(previousEnd, comment.start).includes('\n')),
  )
  return code.slice(leading ? leading.start : statement.start, statement.end)
}
