import { Node, Project } from 'ts-morph'
import type { Statement, ImportDeclaration } from 'ts-morph'

import { statementKey } from './statement-key.js'

function stmtText(s: Statement): string {
  if (Node.isJSDocable(s)) {
    const docs = s
      .getJsDocs()
      .map((d) => d.getText())
      .join('\n')
    if (docs.length > 0) return `${docs}\n${s.getText()}`
  }
  return s.getText()
}

function collectNames(imp: ImportDeclaration) {
  const names: string[] = []
  const def = imp.getDefaultImport()
  if (def) names.push(def.getText())
  const ns = imp.getNamespaceImport()
  if (ns) names.push(ns.getText())
  for (const b of imp.getNamedImports()) {
    names.push(b.getNameNode().getText())
  }
  return names
}

// Key prefix encodes merge semantics; see src/merge/README.md.
export function mergeSource(existing: string, generated: string) {
  const project = new Project({ useInMemoryFileSystem: true })
  const existingFile = project.createSourceFile('existing.ts', existing)
  const generatedFile = project.createSourceFile('generated.ts', generated)
  const claimedByGenerated = new Set<string>()
  for (const imp of generatedFile.getImportDeclarations()) {
    for (const n of collectNames(imp)) {
      claimedByGenerated.add(n)
    }
  }
  const importBySpec = new Map<string, string>()
  for (const imp of generatedFile.getImportDeclarations()) {
    importBySpec.set(imp.getModuleSpecifierValue(), imp.getText())
  }
  for (const imp of existingFile.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue()
    if (importBySpec.has(spec)) {
      importBySpec.set(spec, imp.getText())
      continue
    }
    const named = imp.getNamedImports()
    const def = imp.getDefaultImport()
    const ns = imp.getNamespaceImport()
    const survivingNamed = named.filter((b) => !claimedByGenerated.has(b.getNameNode().getText()))
    const defClaimed = def ? claimedByGenerated.has(def.getText()) : false
    const nsClaimed = ns ? claimedByGenerated.has(ns.getText()) : false
    const noPruning = survivingNamed.length === named.length && !defClaimed && !nsClaimed
    if (noPruning) {
      importBySpec.set(spec, imp.getText())
      continue
    }
    const defKept = def && !defClaimed ? def.getText() : ''
    const nsKept = ns && !nsClaimed ? `* as ${ns.getText()}` : ''
    const namedKept =
      survivingNamed.length > 0 ? `{${survivingNamed.map((b) => b.getText()).join(',')}}` : ''
    const clauseParts = [defKept, nsKept, namedKept].filter(Boolean)
    if (clauseParts.length === 0) continue
    importBySpec.set(spec, `import ${clauseParts.join(',')} from '${spec}'`)
  }
  const existingStmts = existingFile.getStatements().filter((s) => !Node.isImportDeclaration(s))
  const generatedStmts = generatedFile.getStatements().filter((s) => !Node.isImportDeclaration(s))
  const existingByKey = new Map<string, Statement>()
  for (const s of existingStmts) {
    const k = statementKey(s)
    if (k) existingByKey.set(k, s)
  }
  const usedExistingKeys = new Set<string>()
  const isFirstEmit = existingStmts.length === 0
  const fromGenerated = generatedStmts.flatMap((s) => {
    const k = statementKey(s)
    if (k && existingByKey.has(k)) {
      usedExistingKeys.add(k)
      const existingStmt = existingByKey.get(k)
      return [existingStmt ? stmtText(existingStmt) : stmtText(s)]
    }
    if (!isFirstEmit && k?.startsWith('expr:')) return []
    return [stmtText(s)]
  })
  const fromExistingOnly = existingStmts
    .filter((s) => {
      const k = statementKey(s)
      return k ? !usedExistingKeys.has(k) : true
    })
    .map(stmtText)
  return [
    [...importBySpec.values()].join('\n'),
    '',
    [...fromGenerated, ...fromExistingOnly].join('\n\n'),
    '',
  ].join('\n')
}
