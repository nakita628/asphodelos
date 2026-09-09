import { Node } from 'ts-morph'
import type { Statement } from 'ts-morph'

export function statementKey(stmt: Statement) {
  if (Node.isClassDeclaration(stmt)) {
    const name = stmt.getName()
    return name ? `class:${name}` : null
  }
  if (Node.isFunctionDeclaration(stmt)) {
    const name = stmt.getName()
    return name ? `fn:${name}` : null
  }
  if (Node.isVariableStatement(stmt)) {
    const first = stmt.getDeclarations()[0]
    return first ? `var:${first.getName()}` : null
  }
  if (Node.isTypeAliasDeclaration(stmt)) {
    const name = stmt.getName()
    return name ? `type:${name}` : null
  }
  if (Node.isInterfaceDeclaration(stmt)) {
    const name = stmt.getName()
    return name ? `interface:${name}` : null
  }
  if (Node.isIfStatement(stmt)) {
    return `if:${stmt.getExpression().getText().trim()}`
  }
  if (Node.isExpressionStatement(stmt)) {
    const expr = stmt.getExpression()
    if (Node.isCallExpression(expr)) {
      const callee = expr.getExpression()
      if (Node.isIdentifier(callee) && callee.getText() === 'describe') {
        const first = expr.getArguments()[0]
        if (first && Node.isStringLiteral(first)) return `describe:${first.getLiteralText()}`
      }
      const argSig = expr
        .getArguments()
        .map((a) => a.getText().trim().replace(/;$/, ''))
        .join(',')
      return `expr:${callee.getText().trim()}(${argSig})`
    }
  }
  return null
}
