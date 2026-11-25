import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import { GenerateError } from '../../error/index.js'
import { schemasCode, uniqueSchemas } from '../../generator/components/index.js'
import { makeImports, schemaRefKinds } from '../../helper/index.js'
import { collectSchemaRefs, sccSchemas } from '../../helper/schema.js'
import type { Components, Schema } from '../../openapi/index.js'
import { pascalCase, uncapitalize } from '../../utils/index.js'

// The rename every generator's document goes through before its jobs are made.
export { uniqueSchemaKeys } from '../../generator/components/index.js'

function baseFileNameOf(group: readonly { name: string; schema: Schema }[]) {
  return uncapitalize(group.map((member) => member.name).toSorted()[0] ?? 'schema')
}

function freeFileName(base: string, i: number, taken: ReadonlySet<string>): string {
  const candidate = `${base}${i}`
  return taken.has(candidate.toLowerCase()) ? freeFileName(base, i + 1, taken) : candidate
}

// Each group's file name. `index` is the barrel's, on a case-insensitive file system too, so a
// group named like it (`Index`, `index`) takes the first `index<n>` no other file has.
function fileNamesOf(groups: readonly (readonly { name: string; schema: Schema }[])[]) {
  const bases = groups.map(baseFileNameOf)
  const taken = new Set(['index', ...bases.map((base) => base.toLowerCase())])
  return bases.map((base) => {
    if (base.toLowerCase() !== 'index') return base
    const free = freeFileName(base, 2, taken)
    taken.add(free.toLowerCase())
    return free
  })
}

function splitSchemaFiles(
  section: { readonly [k: string]: Schema },
  readonly?: boolean,
  exportTypes?: boolean,
) {
  // Keys that differ only in case are told apart before the split, over the whole document: each
  // file then exports a const no other file does, and is named after a key no other file is.
  const groups = sccSchemas(
    Object.entries(uniqueSchemas(section)).map(([name, schema]) => ({ name, schema })),
  )
  const fileNames = fileNamesOf(groups)
  const nameToFile = new Map(
    groups.flatMap((group, i) => group.map((s) => [s.name, fileNames[i] ?? ''] as const)),
  )
  return groups.map((group, i) => {
    const fileName = fileNames[i] ?? ''
    const subSection = Object.fromEntries(group.map((member) => [member.name, member.schema]))
    const body = schemasCode(subSection, readonly, exportTypes)
    if (body === '') return { fileName, code: '', refKinds: new Map<string, string>() }
    const memberNames = new Set(group.map((member) => member.name))
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
    return {
      fileName,
      code: siblingImports ? `${siblingImports}\n\n${body}` : body,
      refKinds: schemaRefKinds(group.map((member) => member.schema)),
    }
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
      const barrelLines = files.map((file) => `export * from './${file.fileName}'`).toSorted()
      yield* Effect.all(
        [
          ...files.map((file) => {
            const filePath = path.join(outDir, `${file.fileName}.ts`)
            const code =
              file.code === ''
                ? ''
                : makeImports(file.code, filePath, components, true, file.refKinds, exclude)
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
    yield* emit(
      makeImports(code, abs, components, false, schemaRefKinds(Object.values(section))),
      path.dirname(abs),
      abs,
    )
    return `Generated schemas code written to ${output}`
  })
}
