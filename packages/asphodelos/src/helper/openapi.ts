import type { TypeboxCtx } from '../generator/typebox/index.js'
import { isReference, isSecurityArray } from '../guard/index.js'
import type {
  Components,
  OpenAPI,
  Operation,
  Parameter,
  PathItem,
  Reference,
  RequestBody,
  Responses,
  Schema,
} from '../openapi/index.js'
import { pascalCase, resourcePrefix, toSafeIdentifier } from '../utils/index.js'
import { canonicalParamNames, normalizePath, renameOperationParams } from './path-params.js'
import { bodyInfo, makeParamsSchema, responseInfo } from './schema.js'

/**
 * Generates prefix-only query-key getters (`get<Prefix>Key() => ['<prefix>']`)
 * for each unique first path segment, mirroring hono-takibi. Used for
 * per-resource cache invalidation.
 */
export function makePrefixKeyCode(prefix: string): string {
  return `export function get${pascalCase(prefix)}Key() {\n  return ['${prefix}'] as const\n}`
}

export function makePrefixKeyCodes(openAPI: OpenAPI, basePath: string): readonly string[] {
  const prefixes = new Set<string>()
  for (const pathStr of Object.keys(openAPI.paths ?? {})) {
    const seg = resourcePrefix(`${basePath}${pathStr}`)
    if (seg) prefixes.add(seg)
  }
  return [...prefixes].toSorted().map(makePrefixKeyCode)
}

export function tagName(tag: string) {
  const cleaned = tag.replaceAll(/[^a-zA-Z0-9]+/gu, ' ').trim()
  if (!cleaned) return 'default'
  const parts = cleaned.split(/\s+/u)
  return parts
    .map((p, i) =>
      i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
    )
    .join('')
}

export function resourceName(pathStr: string) {
  const first = pathStr.split('/').find((s) => s.length > 0 && !s.startsWith('{'))
  return first ? tagName(first) : 'root'
}

export function makeOperationId(method: string, path: string) {
  const parts = path
    .replaceAll(/\{([^}]+)\}/gu, 'By-$1')
    .split('/')
    .filter(Boolean)
  const camel = parts
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('')
    .replaceAll(/-([a-z])/giu, (_, c: string) => c.toUpperCase())
  return camel ? `${method}${camel.charAt(0).toUpperCase()}${camel.slice(1)}` : method
}

export function resolveOperationId(
  operation: { readonly operationId?: unknown },
  method: string,
  path: string,
) {
  const id = operation.operationId
  return typeof id === 'string' && id.length > 0 ? id : makeOperationId(method, path)
}

function lookup<T>(ref: string, section: string, table: { readonly [k: string]: T } | undefined) {
  const m = new RegExp(`^#/components/${section}/(.+)$`, 'u').exec(ref)
  return m?.[1] && table ? table[decodeURIComponent(m[1])] : undefined
}

function resolveParameter(p: Parameter | Reference, components: Components | undefined) {
  if (isReference(p) && p.$ref) return lookup(p.$ref, 'parameters', components?.parameters)
  return 'name' in p && 'in' in p ? p : undefined
}

function resolveRequestBody(
  b: RequestBody | Reference | undefined,
  components: Components | undefined,
) {
  if (!b) return undefined
  if (isReference(b) && b.$ref) return lookup(b.$ref, 'requestBodies', components?.requestBodies)
  return b
}

function resolveResponse(r: Responses | Reference, components: Components | undefined) {
  if (isReference(r) && r.$ref) return lookup(r.$ref, 'responses', components?.responses) ?? {}
  return r
}

export function resolveOperation(operation: Operation, components: Components | undefined) {
  return {
    ...operation,
    parameters: (operation.parameters ?? [])
      .map((p) => resolveParameter(p, components))
      .filter((p): p is Parameter => p !== undefined),
    requestBody: resolveRequestBody(operation.requestBody, components),
    responses: Object.fromEntries(
      Object.entries(operation.responses ?? {}).map(([status, res]) => [
        status,
        resolveResponse(res, components),
      ]),
    ),
  }
}

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch'] as const

export type Route = {
  method: (typeof HTTP_METHODS)[number]
  path: string
  operationId: string
  summary?: string
  description?: string
  tags: readonly string[]
  paramsRef?: string
  queryRef?: string
  bodyRef?: string
  headersRef?: string
  cookieRef?: string
  responses: readonly { status: string; schema: { kind: 'ref'; name: string } | { kind: 'void' } }[]
  security: readonly { readonly [k: string]: readonly string[] }[]
  callbacks?: { readonly [k: string]: unknown }
}

export function makeRoute(
  method: (typeof HTTP_METHODS)[number],
  path: string,
  operation: Operation,
) {
  const operationId = resolveOperationId(operation, method, path)
  const tags = operation.tags ?? []
  const params = makeParamsSchema(operation.parameters ?? [], 'path')
  const query = makeParamsSchema(operation.parameters ?? [], 'query')
  const headers = makeParamsSchema(operation.parameters ?? [], 'header')
  const cookie = makeParamsSchema(operation.parameters ?? [], 'cookie')
  const body = bodyInfo(operation)
  const synth = (kind: string) => `${toSafeIdentifier(operationId)}${kind}`

  const responsesAndInline = Object.entries(operation.responses ?? {}).map(([status, res]) => {
    const info = responseInfo(res)
    if (info.ref) return { entry: { status, schema: { kind: 'ref' as const, name: info.ref } } }
    if (info.inline) {
      const name = synth(`Response${status}`)
      return {
        entry: { status, schema: { kind: 'ref' as const, name } },
        inline: { name, schema: info.inline },
      }
    }
    return { entry: { status, schema: { kind: 'void' as const } } }
  })

  const inlineSchemas: { name: string; schema: Schema; ctx?: TypeboxCtx }[] = [
    ...(params ? [{ name: synth('Params'), schema: params.schema, ctx: params.ctx }] : []),
    ...(query ? [{ name: synth('Query'), schema: query.schema, ctx: query.ctx }] : []),
    ...(headers ? [{ name: synth('Headers'), schema: headers.schema, ctx: headers.ctx }] : []),
    ...(cookie ? [{ name: synth('Cookie'), schema: cookie.schema, ctx: cookie.ctx }] : []),
    ...(body.inline ? [{ name: synth('Body'), schema: body.inline, ctx: body.ctx }] : []),
    ...responsesAndInline.flatMap((item) => ('inline' in item && item.inline ? [item.inline] : [])),
  ]

  const security = isSecurityArray(operation.security) ? operation.security : []

  const route: Route = {
    method,
    path,
    operationId,
    summary: operation.summary,
    description: operation.description,
    tags,
    paramsRef: params ? synth('Params') : undefined,
    queryRef: query ? synth('Query') : undefined,
    headersRef: headers ? synth('Headers') : undefined,
    cookieRef: cookie ? synth('Cookie') : undefined,
    bodyRef: body.ref ?? (body.inline ? synth('Body') : undefined),
    responses: responsesAndInline.map((item) => item.entry),
    security,
    callbacks:
      operation.callbacks && Object.keys(operation.callbacks).length > 0
        ? operation.callbacks
        : undefined,
  }
  return { route, inlineSchemas }
}

function resolvePathItem(pathItem: PathItem, api: OpenAPI) {
  if (!pathItem.$ref) return pathItem
  const m = /^#\/components\/pathItems\/(.+)$/u.exec(pathItem.$ref)
  const target = m?.[1] ? api.components?.pathItems?.[decodeURIComponent(m[1])] : undefined
  return target ?? pathItem
}

function walk(
  path: string,
  resource: string,
  pathItem: PathItem,
  api: OpenAPI,
  canonical: ReadonlyMap<string, string>,
) {
  const resolved = resolvePathItem(pathItem, api)
  const { path: normalizedPath, renames } = normalizePath(path, canonical)
  return HTTP_METHODS.flatMap((method) => {
    const operation = resolved[method]
    if (!operation) return []
    const resolvedOperation = renameOperationParams(
      resolveOperation(operation, api.components),
      renames,
    )
    return [[resource, makeRoute(method, normalizedPath, resolvedOperation)] as const]
  })
}

export function operationsByResource(api: OpenAPI) {
  const canonical = canonicalParamNames([
    ...Object.keys(api.paths),
    ...Object.keys(api.webhooks ?? {}).map((event) => `/webhooks/${event}`),
  ])
  const grouped = new Map<
    string,
    { route: Route; inlineSchemas: { name: string; schema: Schema; ctx?: TypeboxCtx }[] }[]
  >()
  const collect = (
    resource: string,
    item: { route: Route; inlineSchemas: { name: string; schema: Schema; ctx?: TypeboxCtx }[] },
  ) => {
    const bucket = grouped.get(resource) ?? []
    bucket.push(item)
    grouped.set(resource, bucket)
  }
  for (const [path, pathItem] of Object.entries(api.paths)) {
    if (!pathItem) continue
    for (const [resource, route] of walk(path, resourceName(path), pathItem, api, canonical)) {
      collect(resource, route)
    }
  }
  for (const [event, pathItem] of Object.entries(api.webhooks ?? {})) {
    if (!pathItem) continue
    for (const [resource, route] of walk(
      `/webhooks/${event}`,
      'webhooks',
      pathItem,
      api,
      canonical,
    )) {
      collect(resource, route)
    }
  }
  return grouped
}
