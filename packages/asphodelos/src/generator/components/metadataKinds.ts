import { isReference } from '../../guard/index.js'
import { refIdent, stringifyRefs } from '../../helper/schema.js'
import type { Components } from '../../openapi/index.js'
import { pascalCase } from '../../utils/index.js'

function makeMetadataCode<T>(suffix: string) {
  return (section: { readonly [k: string]: T } | undefined, exported = true) => {
    if (!section) return ''
    const entries = Object.entries(section)
    if (entries.length === 0) return ''
    const exportKw = exported ? 'export ' : ''
    return entries
      .map(([name, v]) => {
        const ident = `${pascalCase(name)}${suffix}`
        if (isReference(v) && v.$ref) {
          return `${exportKw}const ${ident}=${refIdent(v.$ref) ?? `${stringifyRefs(v)} as const`}`
        }
        return `${exportKw}const ${ident}=${stringifyRefs(v)} as const`
      })
      .join('\n\n')
  }
}

export const examplesCode = makeMetadataCode<NonNullable<Components['examples']>[string]>('Example')
export const securitySchemesCode =
  makeMetadataCode<NonNullable<Components['securitySchemes']>[string]>('SecurityScheme')
export const linksCode = makeMetadataCode<NonNullable<Components['links']>[string]>('Link')
export const callbacksCode =
  makeMetadataCode<NonNullable<Components['callbacks']>[string]>('Callback')
export const pathItemsCode =
  makeMetadataCode<NonNullable<Components['pathItems']>[string]>('PathItem')
