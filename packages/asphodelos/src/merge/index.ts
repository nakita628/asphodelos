import type { ImportDeclaration, Statement } from 'oxc-parser'

import { statementKey } from './statement-key.js'
import { parseSource, statementText, textOf } from './syntax.js'
import type { Source } from './syntax.js'

function isImport(statement: Statement): statement is ImportDeclaration {
  return statement.type === 'ImportDeclaration'
}

/** The names an import binds as the generated file would claim them: `a` in `{ a as b }`. */
function importedNames(source: Source, declaration: ImportDeclaration) {
  return (declaration.specifiers ?? []).map((specifier) =>
    specifier.type === 'ImportSpecifier'
      ? textOf(source.code, specifier.imported)
      : specifier.local.name,
  )
}

/**
 * The import block of the merged file: every import of the generated file, then every import only
 * the existing file has, in that order. The existing file's import wins for a module both import,
 * and an existing import whose names the generated file now takes from another module is pruned
 * of those names, or dropped when nothing is left.
 */
function mergeImports(existing: Source, generated: Source) {
  const generatedImports = generated.program.body.filter(isImport)
  const claimedByGenerated = new Set(
    generatedImports.flatMap((declaration) => importedNames(generated, declaration)),
  )
  const importBySpec = new Map<string, string>()
  for (const declaration of generatedImports) {
    importBySpec.set(declaration.source.value, textOf(generated.code, declaration))
  }
  for (const declaration of existing.program.body.filter(isImport)) {
    const spec = declaration.source.value
    const text = textOf(existing.code, declaration)
    if (importBySpec.has(spec)) {
      importBySpec.set(spec, text)
      continue
    }
    const specifiers = declaration.specifiers ?? []
    const named = specifiers.filter((specifier) => specifier.type === 'ImportSpecifier')
    const def = specifiers.find((specifier) => specifier.type === 'ImportDefaultSpecifier')
    const ns = specifiers.find((specifier) => specifier.type === 'ImportNamespaceSpecifier')
    const survivingNamed = named.filter(
      (specifier) => !claimedByGenerated.has(textOf(existing.code, specifier.imported)),
    )
    const defClaimed = def ? claimedByGenerated.has(def.local.name) : false
    const nsClaimed = ns ? claimedByGenerated.has(ns.local.name) : false
    if (survivingNamed.length === named.length && !defClaimed && !nsClaimed) {
      importBySpec.set(spec, text)
      continue
    }
    const clauseParts = [
      def && !defClaimed ? def.local.name : '',
      ns && !nsClaimed ? `* as ${ns.local.name}` : '',
      survivingNamed.length > 0
        ? `{${survivingNamed.map((specifier) => textOf(existing.code, specifier)).join(',')}}`
        : '',
    ].filter(Boolean)
    if (clauseParts.length === 0) continue
    importBySpec.set(spec, `import ${clauseParts.join(',')} from '${spec}'`)
  }
  return [...importBySpec.values()]
}

/** Every top-level statement that is not an import, with its key and its text. */
function keyedStatements(source: Source) {
  return source.program.body.flatMap((statement, index) =>
    isImport(statement)
      ? []
      : [{ key: statementKey(source.code, statement), text: statementText(source, index) }],
  )
}

/**
 * Merges the code the generator produced into what is already on disk, so that regenerating never
 * discards the user's work.
 *
 * Imports are merged into one block (see `mergeImports`). Every other top-level statement is matched by its
 * `statementKey`: a statement in both files is taken from the existing one, a generated statement
 * the existing file lacks is added in the generator's order, and an existing statement the
 * generator no longer emits is kept after them. The exception is an `expr:` statement, a bare call
 * such as the startup `console.log`: it is emitted only when the existing file holds no statement
 * at all, so that deleting it is an edit that lasts.
 *
 * Text is sliced from the source rather than printed from the tree, so the user's comments and
 * formatting come through unchanged. An existing file that does not parse is returned exactly as
 * it is: its tree is empty, and a merge against it would write the generated code over the edit
 * that broke it.
 */
export function mergeSource(existing: string, generated: string) {
  const existingSource = parseSource(existing)
  if (existingSource.errors.length > 0) return existing
  const generatedSource = parseSource(generated)
  const existingStmts = keyedStatements(existingSource)
  const generatedStmts = keyedStatements(generatedSource)
  const existingByKey = new Map<string, string>()
  for (const { key, text } of existingStmts) {
    if (key !== null) existingByKey.set(key, text)
  }
  const usedExistingKeys = new Set<string>()
  const isFirstEmit = existingStmts.length === 0
  const fromGenerated = generatedStmts.flatMap(({ key, text }) => {
    const existingText = key === null ? undefined : existingByKey.get(key)
    if (key !== null && existingText !== undefined) {
      usedExistingKeys.add(key)
      return [existingText]
    }
    if (!isFirstEmit && key?.startsWith('expr:')) return []
    return [text]
  })
  const fromExistingOnly = existingStmts
    .filter(({ key }) => key === null || !usedExistingKeys.has(key))
    .map(({ text }) => text)
  return [
    mergeImports(existingSource, generatedSource).join('\n'),
    '',
    [...fromGenerated, ...fromExistingOnly].join('\n\n'),
    '',
  ].join('\n')
}
