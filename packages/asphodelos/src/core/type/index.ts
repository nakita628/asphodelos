import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import { isMediaWithSchema, isSchemaArray, isStringRef } from '../../guard/index.js'
import { HTTP_METHODS } from '../../helper/index.js'
import { collectSchemaRefs } from '../../helper/schema.js'
import type {
  Media,
  OpenAPI,
  Operation,
  Parameter,
  Reference,
  RequestBody,
  Responses,
  Schema,
} from '../../openapi/index.js'
import { pascalCase } from '../../utils/index.js'

function primitiveTypeToTs(t: string) {
  if (t === 'string') return 'string'
  if (t === 'number' || t === 'integer') return 'number'
  if (t === 'boolean') return 'boolean'
  if (t === 'null') return 'null'
  return 'unknown'
}

function tsName(name: string) {
  if (/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)) return name
  return pascalCase(name)
}

function literalToTs(v: unknown) {
  if (v === null) return 'null'
  if (typeof v === 'string') return JSON.stringify(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return JSON.stringify(v)
}

function isNullable(s: Schema) {
  if (s.nullable === true) return true
  if (Array.isArray(s.type)) return s.type.some((t) => t === 'null')
  return false
}

function primaryType(s: Schema) {
  if (typeof s.type === 'string') return s.type
  if (Array.isArray(s.type)) return s.type.find((t) => t !== 'null')
  return undefined
}

export function schemaToTs(schema: Schema | undefined): string {
  if (!schema) return 'unknown'
  if (schema.$ref) {
    const raw = schema.$ref.split('/').pop()
    return raw ? tsName(decodeURIComponent(raw)) : 'unknown'
  }
  const wrap = (inner: string) => (isNullable(schema) ? `(${inner} | null)` : inner)
  if ('const' in schema && schema.const !== undefined) return wrap(literalToTs(schema.const))
  if (schema.enum && schema.enum.length > 0) {
    return wrap(schema.enum.map(literalToTs).join(' | '))
  }
  if (schema.oneOf) return wrap(schema.oneOf.map(schemaToTs).join(' | ') || 'unknown')
  if (schema.anyOf) return wrap(schema.anyOf.map(schemaToTs).join(' | ') || 'unknown')
  if (schema.allOf) return wrap(schema.allOf.map(schemaToTs).join(' & ') || 'unknown')
  if (Array.isArray(schema.type)) {
    const nonNull = schema.type.filter((type) => type !== 'null')
    const isObj = schema.properties !== undefined || schema.additionalProperties !== undefined
    const isArr = nonNull.includes('array')
    if (nonNull.length > 1 && !isObj && !isArr) {
      return wrap(nonNull.map(primitiveTypeToTs).join(' | '))
    }
  }
  const primary = primaryType(schema)
  if (primary === 'array') {
    if (Array.isArray(schema.prefixItems) && schema.prefixItems.length > 0) {
      return wrap(`[${schema.prefixItems.map(schemaToTs).join(', ')}]`)
    }
    const items = isSchemaArray(schema.items) ? schema.items[0] : schema.items
    return wrap(`${schemaToTs(items)}[]`)
  }
  if (primary === 'object' || schema.properties || schema.additionalProperties !== undefined) {
    const props = schema.properties ?? {}
    const required = new Set(schema.required)
    const entries = Object.entries(props).map(([key, value]) => {
      const opt = required.has(key) ? '' : '?'
      return `${JSON.stringify(key)}${opt}: ${schemaToTs(value)}`
    })
    const additional = schema.additionalProperties
    const propsTs = entries.length === 0 ? '' : `{ ${entries.join('; ')} }`
    if (additional && typeof additional === 'object') {
      const valueTs = schemaToTs(additional)
      const recordTs = `Record<string, ${valueTs}>`
      return wrap(propsTs === '' ? recordTs : `${propsTs} & ${recordTs}`)
    }
    if (additional === true) {
      const recordTs = 'Record<string, unknown>'
      return wrap(propsTs === '' ? recordTs : `${propsTs} & ${recordTs}`)
    }
    return wrap(propsTs === '' ? '{}' : propsTs)
  }
  if (primary === 'null') return 'null'
  if (primary !== undefined) return wrap(primitiveTypeToTs(primary))
  return wrap('unknown')
}

function pathToKeys(pathStr: string) {
  return pathStr
    .split('/')
    .filter((s) => s.length > 0)
    .map((seg) => (seg.startsWith('{') && seg.endsWith('}') ? `:${seg.slice(1, -1)}` : seg))
}

function responseContentTs(resp: Responses, components: OpenAPI['components']) {
  if (isStringRef(resp) && resp.$ref) {
    const name = resp.$ref.split('/').pop()
    const resolved = name ? components?.responses?.[decodeURIComponent(name)] : undefined
    if (!resolved) return 'unknown'
    return responseContentTs(resolved, components)
  }
  const json = resp.content?.['application/json']
  if (!json) return 'unknown'
  return schemaToTs(json.schema)
}

function isMedia(entry: Media | Reference | undefined): entry is Media {
  return entry !== undefined && !isStringRef(entry)
}

function requestBodyTs(
  body: RequestBody | Reference | undefined,
  components: OpenAPI['components'],
) {
  if (!body) return 'unknown'
  if (isStringRef(body) && body.$ref) {
    const name = body.$ref.split('/').pop()
    const resolved = name ? components?.requestBodies?.[decodeURIComponent(name)] : undefined
    if (!resolved) return 'unknown'
    return requestBodyTs(resolved, components)
  }
  const content = 'content' in body ? body.content : undefined
  if (!content) return 'unknown'
  const PRIORITY = [
    'application/json',
    'multipart/form-data',
    'application/x-www-form-urlencoded',
    'application/octet-stream',
  ] as const
  for (const mediaType of PRIORITY) {
    const entry = content[mediaType]
    if (!isMedia(entry)) continue
    if (!entry.schema) continue
    if (mediaType === 'application/octet-stream') {
      const schema = entry.schema
      if (!schema.$ref && (schema.format === 'binary' || schema.type === 'string')) {
        return 'Blob | File | ArrayBuffer'
      }
      return schemaToTs(schema)
    }
    return schemaToTs(entry.schema)
  }
  for (const [, entry] of Object.entries(content)) {
    if (!isMedia(entry) || !entry.schema) continue
    return schemaToTs(entry.schema)
  }
  return 'unknown'
}

function resolveParameter(p: Parameter | Reference, components: OpenAPI['components']) {
  if (isStringRef(p) && p.$ref) {
    const name = p.$ref.split('/').pop()
    if (!name) return undefined
    return components?.parameters?.[decodeURIComponent(name)]
  }
  return 'name' in p && 'in' in p ? p : undefined
}

function paramsTs(
  params: readonly (Parameter | Reference)[],
  where: Parameter['in'],
  components: OpenAPI['components'],
) {
  const resolved = params
    .map((p) => resolveParameter(p, components))
    .filter((p): p is Parameter => p?.in === where)
  if (resolved.length === 0) return '{}'
  const entries = resolved.map((p) => {
    const opt = p.required ? '' : '?'
    return `${JSON.stringify(p.name)}${opt}: ${schemaToTs(p.schema)}`
  })
  return `{ ${entries.join('; ')} }`
}

const VALIDATION_ERROR_TS = `{ type: "validation"; on: string; summary?: string; message?: string; found?: unknown; property?: string; expected?: string }`

function makeResponseTs(operation: Operation, components: OpenAPI['components']) {
  const declared = Object.entries(operation.responses ?? {}).filter(
    ([status]) => status !== 'default',
  )
  const entries = declared.map(([status, resp]) => {
    const ts = responseContentTs(resp, components)
    return `${status}: ${ts}`
  })
  if (!declared.some(([status]) => status === '422')) {
    entries.push(`422: ${VALIDATION_ERROR_TS}`)
  }
  return `{ ${entries.join('; ')} }`
}

function makeOperationTs(operation: Operation, components: OpenAPI['components']) {
  const params = operation.parameters ?? []
  const body = requestBodyTs(operation.requestBody, components)
  const pathParams = paramsTs(params, 'path', components)
  const queryParams = paramsTs(params, 'query', components)
  const headerParams = paramsTs(params, 'header', components)
  const headers = headerParams === '{}' ? 'unknown' : headerParams
  const response = makeResponseTs(operation, components)
  return `{ body: ${body}; params: ${pathParams}; query: ${queryParams === '{}' ? 'unknown' : queryParams}; headers: ${headers}; response: ${response} }`
}

function nestRoute(keys: readonly string[], method: string, opTs: string) {
  const leaf = `{ ${method}: ${opTs} }`
  return keys.reduceRight((acc, key) => `{ ${JSON.stringify(key)}: ${acc} }`, leaf)
}

function makeRoutes(openAPI: OpenAPI, prefix?: string) {
  const out: string[] = []
  const prefixKeys: readonly string[] = prefix && prefix !== '/' ? pathToKeys(prefix) : []
  for (const [pathStr, pathItem] of Object.entries(openAPI.paths)) {
    if (!pathItem) continue
    const keys = [...prefixKeys, ...pathToKeys(pathStr)]
    for (const method of HTTP_METHODS) {
      const operation = pathItem[method]
      if (!operation) continue
      out.push(nestRoute(keys, method, makeOperationTs(operation, openAPI.components)))
    }
  }
  return out
}

function collectRefs(openAPI: OpenAPI) {
  const seen = new Set<string>()
  const queue: string[] = []
  const components = openAPI.components
  const enqueue = (s: Schema | undefined) => {
    if (!s) return
    for (const name of collectSchemaRefs(s)) {
      if (!seen.has(name)) {
        seen.add(name)
        queue.push(name)
      }
    }
  }
  const walkContentMap = (content: {
    readonly [k: string]: { readonly schema?: Schema } | Reference
  }) => {
    for (const media of Object.values(content)) {
      if (isMediaWithSchema(media)) enqueue(media.schema)
    }
  }
  const walkRequestBody = (rb: RequestBody | Reference | undefined) => {
    if (!rb) return
    if (isStringRef(rb) && rb.$ref) {
      const name = rb.$ref.split('/').pop()
      const resolved = name ? components?.requestBodies?.[decodeURIComponent(name)] : undefined
      if (resolved?.content) walkContentMap(resolved.content)
      return
    }
    if ('content' in rb && rb.content) walkContentMap(rb.content)
  }
  const walkResponse = (resp: Responses) => {
    if (isStringRef(resp) && resp.$ref) {
      const name = resp.$ref.split('/').pop()
      const resolved = name ? components?.responses?.[decodeURIComponent(name)] : undefined
      if (resolved?.content) walkContentMap(resolved.content)
      return
    }
    if (resp.content) walkContentMap(resp.content)
  }
  for (const [, pathItem] of Object.entries(openAPI.paths)) {
    if (!pathItem) continue
    for (const method of HTTP_METHODS) {
      const op = pathItem[method]
      if (!op) continue
      walkRequestBody(op.requestBody)
      for (const p of op.parameters ?? []) {
        if (isStringRef(p) && p.$ref) {
          const pname = p.$ref.split('/').pop()
          const resolved = pname ? components?.parameters?.[decodeURIComponent(pname)] : undefined
          if (resolved) enqueue(resolved.schema)
        } else if ('schema' in p) {
          enqueue(p.schema)
        }
      }
      for (const resp of Object.values(op.responses ?? {})) {
        if (resp) walkResponse(resp)
      }
    }
  }
  while (queue.length > 0) {
    const name = queue.shift()
    if (!name) continue
    enqueue(components?.schemas?.[name])
  }
  return [...seen]
}

export function makeAppType(openAPI: OpenAPI, prefix?: string) {
  const refNames = collectRefs(openAPI)
  const refAliases = refNames.map((name) => {
    const schema = openAPI.components?.schemas?.[name]
    return `type ${tsName(name)} = ${schemaToTs(schema)}`
  })
  const routes = makeRoutes(openAPI, prefix)
  const routesTs = routes.length === 0 ? '{}' : routes.join(' & ')
  const SINGLETON = `{ decorator: {}; store: {}; derive: {}; resolve: {} }`
  const EPHEMERAL = `{ typebox: {}; error: {} }`
  const VOLATILE = `{ schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }`
  const TAIL = `{ derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }`
  const appType = `export type App = Elysia<"", ${SINGLETON}, ${EPHEMERAL}, ${VOLATILE}, ${routesTs}, ${TAIL}, ${TAIL}>`
  return { refAliases, appType, routes }
}

export function types(openAPI: OpenAPI, output: string, prefix?: string) {
  return Effect.gen(function* () {
    const { refAliases, appType } = makeAppType(openAPI, prefix)
    const code = [`import type { Elysia } from "elysia"`, refAliases.join('\n'), appType]
      .filter((s) => s.length > 0)
      .join('\n\n')
    yield* emit(`${code}\n`, path.dirname(output), output)
    return `Generated app type written to ${output}`
  })
}
