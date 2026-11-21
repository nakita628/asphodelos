import { isReference } from '../../guard/index.js'
import { jsonSchema, refIdent, schemaRefKinds, stringifiedRefKinds } from '../../helper/schema.js'
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
          ? `${decl}\n\nexport type ${typeStripped}${suffix.replace(/Schema$/u, '')}=Static<typeof ${ident}>`
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

/** What `responsesCode` renders a `$ref` as: the schemas of the JSON content. */
export function responsesRefKinds(section: Components['responses']) {
  return schemaRefKinds(Object.values(section ?? {}).map((res) => jsonSchema(res.content)))
}

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

/** What `parametersCode` renders a `$ref` as: the schemas of the parameters. */
export function parametersRefKinds(section: { readonly [k: string]: Parameter } | undefined) {
  return schemaRefKinds(Object.values(section ?? {}).map((p) => p.schema))
}

export const requestBodiesCode = makeCode<NonNullable<Components['requestBodies']>[string]>(
  'RequestBodySchema',
  (s) =>
    Object.entries(s).map(([name, body]) => {
      const schema = jsonSchema(body.content)
      return [name, schema ? typebox(schema) : 't.Unknown()'] as const
    }),
)

/** What `requestBodiesCode` renders a `$ref` as: the schemas of the JSON content. */
export function requestBodiesRefKinds(section: Components['requestBodies']) {
  return schemaRefKinds(Object.values(section ?? {}).map((body) => jsonSchema(body.content)))
}

export const headersCode = makeCode<Header | Reference>('HeaderSchema', (s) =>
  Object.entries(s).map(([name, h]) => {
    if (isReference(h) && h.$ref) return [name, refIdent(h.$ref) ?? 't.Unknown()'] as const
    const schema = 'schema' in h ? h.schema : undefined
    return [name, schema ? typebox(schema) : 't.Unknown()'] as const
  }),
)

/**
 * What `headersCode` renders a `$ref` as: a header that is a `$ref`, or the schema of one that is
 * not.
 */
export function headersRefKinds(section: { readonly [k: string]: Header | Reference } | undefined) {
  const entries = Object.values(section ?? {})
  return new Map([
    ...schemaRefKinds(
      entries.map((h) =>
        isReference(h) && h.$ref ? undefined : 'schema' in h ? h.schema : undefined,
      ),
    ),
    ...stringifiedRefKinds(entries.filter((h) => isReference(h) && h.$ref)),
  ])
}

export const mediaTypesCode = makeCode<Media | Reference>('MediaTypeSchema', (s) =>
  Object.entries(s).map(([name, mt]) => {
    if (isReference(mt) && mt.$ref) return [name, refIdent(mt.$ref) ?? 't.Unknown()'] as const
    const schema = !isReference(mt) && 'schema' in mt ? mt.schema : undefined
    return [name, schema ? typebox(schema) : 't.Unknown()'] as const
  }),
)

/**
 * What `mediaTypesCode` renders a `$ref` as: a media type that is a `$ref`, or the schema of one
 * that is not.
 */
export function mediaTypesRefKinds(
  section: { readonly [k: string]: Media | Reference } | undefined,
) {
  const entries = Object.values(section ?? {})
  return new Map([
    ...schemaRefKinds(
      entries.map((mt) => (!isReference(mt) && 'schema' in mt ? mt.schema : undefined)),
    ),
    ...stringifiedRefKinds(entries.filter((mt) => isReference(mt) && mt.$ref)),
  ])
}
