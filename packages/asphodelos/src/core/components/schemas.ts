import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import { GenerateError } from '../../error/index.js'
import { schemasCode } from '../../generator/components/index.js'
import { makeImports } from '../../helper/index.js'
import { collectSchemaRefs, sccSchemas } from '../../helper/schema.js'
import type { Components, Schema } from '../../openapi/index.js'
import { pascalCase, uncapitalize } from '../../utils/index.js'

function fileNameOf(group: readonly { name: string; schema: Schema }[]) {
  return uncapitalize(group.map((g) => g.name).toSorted()[0] ?? 'schema')
}

function splitSchemaFiles(
  section: { readonly [k: string]: Schema },
  readonly?: boolean,
  exportTypes?: boolean,
) {
  const groups = sccSchemas(Object.entries(section).map(([name, schema]) => ({ name, schema })))
  const nameToFile = new Map(groups.flatMap((g) => g.map((s) => [s.name, fileNameOf(g)] as const)))
  return groups.map((group) => {
    const fileName = fileNameOf(group)
    const subSection = Object.fromEntries(group.map((g) => [g.name, g.schema]))
    const body = schemasCode(subSection, readonly, exportTypes)
    if (body === '') return { fileName, code: '' }
    const memberNames = new Set(group.map((g) => g.name))
    const bySibling = new Map<string, Set<string>>()
    for (const { schema } of group) {
      for (const refName of collectSchemaRefs(schema)) {
        const sibling = nameToFile.get(refName)
        if (!sibling || sibling === fileName || memberNames.has(refName)) continue
        const bucket = bySibling.get(sibling) ?? new Set()
        bucket.add(`${pascalCase(refName)}Schema`)
        bySibling.set(sibling, bucket)
      }
    }
    const siblingImports = [...bySibling.entries()]
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(
        ([sibling, idents]) => `import {${[...idents].toSorted().join(',')}} from './${sibling}'`,
      )
      .join('\n')
    return { fileName, code: siblingImports ? `${siblingImports}\n\n${body}` : body }
  })
}

export function schemas(
  section: Components['schemas'],
  output: string,
  split: boolean,
  exportTypes: boolean,
  components?: {
    readonly [k: string]: {
      readonly output: string
      readonly split?: boolean
      readonly import?: string
    }
  },
  readonly?: boolean,
) {
  return Effect.gen(function* () {
    if (!section) return yield* new GenerateError({ message: 'No schemas found' })
    const schemaNames = Object.keys(section)
    if (schemaNames.length === 0) return 'No schemas found'
    const abs = path.resolve(process.cwd(), output)
    if (split) {
      const exclude = new Set(['schemas'])
      const outDir = path.join(path.dirname(abs), path.basename(abs, '.ts'))
      const files = splitSchemaFiles(section, readonly, exportTypes)
      const barrelLines = files.map((f) => `export * from './${f.fileName}'`).toSorted()
      yield* Effect.all(
        [
          ...files.map((f) => {
            const filePath = path.join(outDir, `${f.fileName}.ts`)
            const code =
              f.code === '' ? '' : makeImports(f.code, filePath, components, true, exclude)
            return emit(code, path.dirname(filePath), filePath)
          }),
          emit(`${barrelLines.join('\n')}\n`, outDir, path.join(outDir, 'index.ts')),
        ],
        { concurrency: 'unbounded' },
      )
      return `Generated schemas code written to ${outDir}/*.ts (index.ts included)`
    }
    const code = schemasCode(section, readonly, exportTypes)
    if (code === '') return 'No schemas found'
    yield* emit(makeImports(code, abs, components, false), path.dirname(abs), abs)
    return `Generated schemas code written to ${output}`
  })
}
