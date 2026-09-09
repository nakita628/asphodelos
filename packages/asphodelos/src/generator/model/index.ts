import { collectSchemaRefs } from '../../helper/schema.js'
import { readonly } from '../../helper/typebox.js'
import type { Schema } from '../../openapi/index.js'
import { pascalCase } from '../../utils/index.js'
import { typebox } from '../typebox/index.js'
import type { TypeboxCtx } from '../typebox/index.js'

export function modelFile(
  tag: string,
  schemas: readonly { name: string; schema: Schema; ctx?: TypeboxCtx }[],
  componentNames: ReadonlySet<string> = new Set(),
  schemasImportPath = '../../components',
  readonlyMode?: boolean,
) {
  const className = `${pascalCase(tag)}Model`
  const referenced = new Set<string>()
  for (const { schema } of schemas) {
    for (const r of collectSchemaRefs(schema)) {
      if (componentNames.has(r)) referenced.add(r)
    }
  }
  const importedIdents = [...referenced].toSorted().map((n) => `${pascalCase(n)}Schema`)
  const componentImport =
    importedIdents.length > 0
      ? `import {${importedIdents.join(',')}} from '${schemasImportPath}'\n`
      : ''
  const entries = schemas
    .map(({ name, schema, ctx }) => `${name}:${readonly(typebox(schema, ctx), readonlyMode)}`)
    .join(',')
  if (entries === '') {
    return `${componentImport}
export const ${className}={} as const

export type ${className}=typeof ${className}
`
  }
  return `import {t,type UnwrapSchema} from 'elysia'
${componentImport}
export const ${className}={${entries}} as const

export type ${className}={[k in keyof typeof ${className}]:UnwrapSchema<(typeof ${className})[k]>}
`
}
