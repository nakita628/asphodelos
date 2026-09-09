import { isReference } from '../../guard/index.js'
import { jsonSchema, refIdent } from '../../helper/schema.js'
import { readonly } from '../../helper/typebox.js'
import type { Components, Header, Media, Parameter, Reference } from '../../openapi/index.js'
import { pascalCase } from '../../utils/index.js'
import { typebox } from '../typebox/index.js'

function makeCode<T>(
  suffix: string,
  extract: (section: {
    readonly [k: string]: T
  }) => readonly (readonly [name: string, expr: string])[],
) {
  return (
    section: { readonly [k: string]: T } | undefined,
    readonlyMode?: boolean,
    exportTypes?: boolean,
    exported = true,
  ) => {
    if (!section) return ''
    const entries = extract(section)
    if (entries.length === 0) return ''
    const exportKw = exported ? 'export ' : ''
    return entries
      .map(([name, expr]) => {
        const ident = `${pascalCase(name)}${suffix}`
        const decl = `${exportKw}const ${ident}=${readonly(expr, readonlyMode)}`
        const typeStripped = pascalCase(name)
        return exportTypes
          ? `${decl}\n\nexport type ${typeStripped}${suffix.replace(/Schema$/, '')}=Static<typeof ${ident}>`
          : decl
      })
      .join('\n\n')
  }
}

export const responsesCode = makeCode<NonNullable<Components['responses']>[string]>(
  'ResponseSchema',
  (s) =>
    Object.entries(s).map(([name, res]) => {
      const schema = jsonSchema(res.content)
      return [name, schema ? typebox(schema) : 't.Void()'] as const
    }),
)

export const parametersCode = makeCode<Parameter>('ParamsSchema', (s) =>
  Object.entries(s).map(([name, p]) => {
    if (!p.schema) {
      if (p.content) {
        console.warn(
          `asphodelos: Component parameter '${name}' uses 'content' field (OpenAPI 3.1 alternative to 'schema'). This is not yet supported; emitting t.Unknown() placeholder.`,
        )
      }
      return [name, 't.Unknown()'] as const
    }
    return [name, typebox(p.schema)] as const
  }),
)

export const requestBodiesCode = makeCode<NonNullable<Components['requestBodies']>[string]>(
  'RequestBodySchema',
  (s) =>
    Object.entries(s).map(([name, body]) => {
      const schema = jsonSchema(body.content)
      return [name, schema ? typebox(schema) : 't.Unknown()'] as const
    }),
)

export const headersCode = makeCode<Header | Reference>('HeaderSchema', (s) =>
  Object.entries(s).map(([name, h]) => {
    if (isReference(h) && h.$ref) return [name, refIdent(h.$ref) ?? 't.Unknown()'] as const
    const schema = 'schema' in h ? h.schema : undefined
    return [name, schema ? typebox(schema) : 't.Unknown()'] as const
  }),
)

export const mediaTypesCode = makeCode<Media | Reference>('MediaTypeSchema', (s) =>
  Object.entries(s).map(([name, mt]) => {
    if (isReference(mt) && mt.$ref) return [name, refIdent(mt.$ref) ?? 't.Unknown()'] as const
    const schema = !isReference(mt) && 'schema' in mt ? mt.schema : undefined
    return [name, schema ? typebox(schema) : 't.Unknown()'] as const
  }),
)
