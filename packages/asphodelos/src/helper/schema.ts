import type { TypeboxCtx } from '../generator/typebox/index.js'
import { isReference, isSchemaArray } from '../guard/index.js'
import type { Operation, Parameter, Reference, Responses, Schema } from '../openapi/index.js'
import { VENDOR_EXT_KEYS } from '../openapi/vendor-ext.js'
import { pascalCase } from '../utils/index.js'

function pickVendorExtensions(source: { readonly [k: string]: unknown } | undefined): {
  readonly [K in (typeof VENDOR_EXT_KEYS)[number]]?: string
} {
  if (!source) return {}
  const picked: { [K in (typeof VENDOR_EXT_KEYS)[number]]?: string } = {}
  for (const key of VENDOR_EXT_KEYS) {
    const value = source[key]
    if (typeof value === 'string') picked[key] = value
  }
  return picked
}

export function jsonSchema(
  content:
    | {
        readonly [k: string]: { readonly schema?: Schema; readonly $ref?: string } | undefined
      }
    | undefined,
) {
  return content?.['application/json']?.schema
}

const BODY_MEDIA_PRIORITY = [
  'application/json',
  'multipart/form-data',
  'application/octet-stream',
] as const

function pickBodyMedia(
  content:
    | {
        readonly [k: string]: { readonly schema?: Schema; readonly $ref?: string } | undefined
      }
    | undefined,
) {
  if (!content) return undefined
  for (const m of BODY_MEDIA_PRIORITY) {
    const entry = content[m]
    if (entry?.schema) return { mediaType: m, schema: entry.schema }
  }
  return undefined
}

export function refSchemaName(s: Schema | undefined) {
  if (!s?.$ref) return null
  const m = /^#\/components\/schemas\/([^/]+)$/u.exec(s.$ref)
  return m?.[1] ? decodeURIComponent(m[1]) : null
}

export function bodyInfo(operation: Operation) {
  const body = operation.requestBody
  if (!body || isReference(body)) return {}
  const picked = pickBodyMedia(body.content)
  if (!picked) return {}
  const { mediaType, schema } = picked
  const ref = refSchemaName(schema)
  if (ref) return { ref }
  const media = body.content?.[mediaType]
  const mediaExt = media && !isReference(media) ? pickVendorExtensions(media) : {}
  const bodyExt = pickVendorExtensions(body)
  const schemaExt = pickVendorExtensions(schema)
  const inline: Schema = {
    ...mediaExt,
    ...bodyExt,
    ...schema,
    ...schemaExt,
  }
  if (mediaType === 'application/json') return { inline }
  return { inline, ctx: { mediaType } }
}

export function responseInfo(res: Responses) {
  const schema = jsonSchema(res.content)
  if (!schema) return { void: true }
  const ref = refSchemaName(schema)
  return ref ? { ref } : { inline: schema }
}

export function makeParamsSchema(
  params: readonly (Parameter | Reference)[],
  where: 'path' | 'query' | 'header' | 'cookie',
): { schema: Schema; ctx?: TypeboxCtx } | undefined {
  const filtered = params.filter((p): p is Parameter => !isReference(p) && p.in === where)
  if (filtered.length === 0) return undefined
  const withSchema = filtered.filter((p): p is Parameter & { schema: Schema } => {
    if (!p.schema) {
      if (p.content) {
        console.warn(
          `asphodelos: Parameter '${p.name}' uses 'content' field (OpenAPI 3.1 alternative to 'schema'). This is not yet supported; the parameter will be omitted from the generated route.`,
        )
      }
      return false
    }
    return true
  })
  if (withSchema.length === 0) return undefined
  const properties = Object.fromEntries(withSchema.map((p) => [p.name, p.schema]))
  const required = withSchema.filter((p) => p.required).map((p) => p.name)
  // First parameter to declare a given extension wins; the parameter's own value takes
  // precedence over the one on its schema.
  const hoisted: { [K in (typeof VENDOR_EXT_KEYS)[number]]?: string } = {}
  for (const p of withSchema) {
    const fromParam = pickVendorExtensions(p)
    const fromSchema = pickVendorExtensions(p.schema)
    for (const key of VENDOR_EXT_KEYS) {
      if (hoisted[key] !== undefined) continue
      const value = fromParam[key] ?? fromSchema[key]
      if (value !== undefined) hoisted[key] = value
    }
  }
  const schema: Schema = {
    type: 'object' as const,
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...hoisted,
  }
  if (where === 'cookie') return { schema, ctx: { elysiaKind: 'cookie' } }
  if (where === 'query') return { schema, ctx: { parameterLocation: 'query' } }
  return { schema }
}

export function collectSchemaRefs(schema: Schema, acc = new Set<string>()) {
  if (schema.properties) {
    for (const v of Object.values(schema.properties)) {
      collectSchemaRefs(v, acc)
    }
  }
  if (schema.items) {
    const items = schema.items
    if (isSchemaArray(items)) {
      for (const i of items) {
        collectSchemaRefs(i, acc)
      }
    } else collectSchemaRefs(items, acc)
  }
  if (schema.prefixItems) {
    for (const i of schema.prefixItems) {
      collectSchemaRefs(i, acc)
    }
  }
  if (schema.additionalProperties && typeof schema.additionalProperties === 'object') {
    collectSchemaRefs(schema.additionalProperties, acc)
  }
  if (schema.$ref) {
    const m = /^#\/components\/schemas\/([^/]+)$/u.exec(schema.$ref)
    if (m?.[1]) acc.add(decodeURIComponent(m[1]))
  }
  if (schema.oneOf) {
    for (const s of schema.oneOf) {
      collectSchemaRefs(s, acc)
    }
  }
  if (schema.allOf) {
    for (const s of schema.allOf) {
      collectSchemaRefs(s, acc)
    }
  }
  if (schema.anyOf) {
    for (const s of schema.anyOf) {
      collectSchemaRefs(s, acc)
    }
  }
  if (schema.not) collectSchemaRefs(schema.not, acc)
  if (schema.patternProperties) {
    for (const v of Object.values(schema.patternProperties)) {
      collectSchemaRefs(v, acc)
    }
  }
  if (schema.propertyNames) collectSchemaRefs(schema.propertyNames, acc)
  if (schema.dependentSchemas) {
    for (const v of Object.values(schema.dependentSchemas)) {
      collectSchemaRefs(v, acc)
    }
  }
  if (schema.contains) collectSchemaRefs(schema.contains, acc)
  return acc
}

export function topoSortSchemas<T extends { name: string; schema: Schema }>(
  schemas: readonly T[],
): T[] {
  const byName = new Map(schemas.map((s) => [s.name, s] as const))
  const visited = new Set<string>()
  const result: T[] = []
  const visit = (name: string, stack: Set<string>) => {
    if (visited.has(name) || stack.has(name)) return
    const def = byName.get(name)
    if (!def) return
    stack.add(name)
    for (const dep of collectSchemaRefs(def.schema)) {
      visit(dep, stack)
    }
    stack.delete(name)
    visited.add(name)
    result.push(def)
  }
  for (const { name } of schemas) {
    visit(name, new Set())
  }
  return result
}

export function sccSchemas(
  schemas: readonly { name: string; schema: Schema }[],
): readonly (readonly { name: string; schema: Schema }[])[] {
  const byName = new Map(schemas.map((s) => [s.name, s] as const))
  const refsOf = (name: string): string[] => {
    const def = byName.get(name)
    if (!def) return []
    return [...collectSchemaRefs(def.schema)].filter((ref) => byName.has(ref))
  }
  const index = new Map<string, number>()
  const lowlink = new Map<string, number>()
  const onStack = new Set<string>()
  const stack: string[] = []
  const groups: { name: string; schema: Schema }[][] = []
  const counter = { value: 0 }
  const strongconnect = (v: string) => {
    index.set(v, counter.value)
    lowlink.set(v, counter.value)
    counter.value += 1
    stack.push(v)
    onStack.add(v)
    for (const w of refsOf(v)) {
      if (!index.has(w)) {
        strongconnect(w)
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, lowlink.get(w) ?? 0))
      } else if (onStack.has(w)) {
        lowlink.set(v, Math.min(lowlink.get(v) ?? 0, index.get(w) ?? 0))
      }
    }
    if ((lowlink.get(v) ?? 0) === (index.get(v) ?? 0)) {
      const group: { name: string; schema: Schema }[] = []
      while (true) {
        const w = stack.pop()
        if (w === undefined) break
        onStack.delete(w)
        const def = byName.get(w)
        if (def) group.push(def)
        if (w === v) break
      }
      groups.push(group)
    }
  }
  for (const { name } of schemas) {
    if (!index.has(name)) strongconnect(name)
  }
  return groups
}

const REF_SUFFIX: { readonly [k: string]: string } = {
  schemas: 'Schema',
  parameters: 'ParamsSchema',
  headers: 'HeaderSchema',
  securitySchemes: 'SecurityScheme',
  requestBodies: 'RequestBodySchema',
  responses: 'ResponseSchema',
  examples: 'Example',
  links: 'Link',
  callbacks: 'Callback',
  pathItems: 'PathItem',
  mediaTypes: 'MediaTypeSchema',
}

const REF_PATTERN = new RegExp(`^#/components/(${Object.keys(REF_SUFFIX).join('|')})/(.+)$`, 'u')

export function refIdent(ref: string): string | undefined {
  const m = REF_PATTERN.exec(ref)
  if (!m?.[1] || !m[2]) return undefined
  const suffix = REF_SUFFIX[m[1]]
  if (!suffix) return undefined
  return `${pascalCase(decodeURIComponent(m[2]))}${suffix}`
}

export function stringifyRefs(value: unknown): string {
  if (value === null) return 'null'
  if (value === undefined) return 'undefined'
  if (typeof value === 'string') return JSON.stringify(value)
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return `[${value.map(stringifyRefs).join(',')}]`
  if (typeof value === 'object') {
    if (isReference(value) && value.$ref) {
      const ident = refIdent(value.$ref)
      if (ident) return ident
    }
    const entries = Object.entries(value).map(
      ([k, v]) => `${JSON.stringify(k)}:${stringifyRefs(v)}`,
    )
    return `{${entries.join(',')}}`
  }
  return JSON.stringify(value)
}

export function moduleInlineSchemas<T extends { name: string; schema: Schema }>(
  inline: readonly T[],
): T[] {
  return topoSortSchemas(inline)
}

export function moduleComponentRefs(
  routes: readonly {
    readonly bodyRef?: string
    readonly responses: readonly { schema: { kind: 'ref'; name: string } | { kind: 'void' } }[]
  }[],
  inline: readonly { name: string; schema: Schema }[],
  componentNames: ReadonlySet<string>,
  componentSchemas: { readonly [k: string]: Schema } = {},
) {
  const direct = new Set<string>()
  for (const r of routes) {
    if (r.bodyRef && componentNames.has(r.bodyRef)) direct.add(r.bodyRef)
    for (const res of r.responses) {
      if (res.schema.kind === 'ref' && componentNames.has(res.schema.name)) {
        direct.add(res.schema.name)
      }
    }
  }
  for (const { schema } of inline) {
    for (const n of collectSchemaRefs(schema)) {
      if (componentNames.has(n)) direct.add(n)
    }
  }
  const closure = new Set(direct)
  const queue = [...direct]
  while (queue.length > 0) {
    const name = queue.shift()
    if (name === undefined) break
    const def = componentSchemas[name]
    if (!def) continue
    for (const dep of collectSchemaRefs(def)) {
      if (componentNames.has(dep) && !closure.has(dep)) {
        closure.add(dep)
        queue.push(dep)
      }
    }
  }
  return closure
}
