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
import {
  canonicalParamNames,
  isElysiaRoutePath,
  isTreatyPath,
  normalizePath,
  renameOperationParams,
} from './path-params.js'
import { bodyInfo, makeParamsSchema, responseInfo } from './schema.js'

/**
 * Generates prefix-only query-key getters (`get<Prefix>Key() => ['<prefix>']`)
 * for each unique first path segment, mirroring hono-takibi. Used for
 * per-resource cache invalidation.
 */
function makePrefixKeyCode(prefix: string): string {
  return `export function get${pascalCase(prefix)}Key() {\n  return ['${prefix}'] as const\n}`
}

// Only the path keys the app routes have hooks, so only theirs name a prefix.
export function makePrefixKeyCodes(openAPI: OpenAPI, basePath: string): readonly string[] {
  const prefixes = new Set<string>()
  const hookPaths = Object.keys(openAPI.paths ?? {}).filter(
    (pathStr) => isElysiaRoutePath(pathStr) && isTreatyPath(pathStr),
  )
  for (const pathStr of hookPaths) {
    const seg = resourcePrefix(`${basePath}${pathStr}`)
    if (seg) prefixes.add(seg)
  }
  return [...prefixes].toSorted().map(makePrefixKeyCode)
}

function tagName(tag: string) {
  const cleaned = tag.replaceAll(/[^a-zA-Z0-9]+/gu, ' ').trim()
  if (!cleaned) return 'default'
  const parts = cleaned.split(/\s+/u)
  return parts
    .map((p, i) =>
      i === 0 ? p.toLowerCase() : p.charAt(0).toUpperCase() + p.slice(1).toLowerCase(),
    )
    .join('')
}

/**
 * Exported for its unit tests; nothing outside this module imports it.
 *
 * @internal
 */
export function resourceName(pathStr: string) {
  const first = pathStr.split('/').find((s) => s.length > 0 && !s.startsWith('{'))
  return first ? tagName(first) : 'root'
}

/**
 * Exported for its unit tests; nothing outside this module imports it.
 *
 * @internal
 */
export function makeOperationId(method: string, path: string) {
  const parts = path
    .replaceAll(/\{([^}]+)\}/gu, 'By-$1')
    .split('/')
    .filter(Boolean)
  const camel = parts
    .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join('')
    .replaceAll(/-([a-z])/giu, (_, letter: string) => letter.toUpperCase())
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

function resolveResponse(response: Responses | Reference, components: Components | undefined) {
  if (isReference(response) && response.$ref) {
    return lookup(response.$ref, 'responses', components?.responses) ?? {}
  }
  return response
}

export function resolveOperation(operation: Operation, components: Components | undefined) {
  return {
    ...operation,
    parameters: (operation.parameters ?? [])
      .map((p) => resolveParameter(p, components))
      .filter((p): p is Parameter => p !== undefined),
    requestBody: resolveRequestBody(operation.requestBody, components),
    responses: Object.fromEntries(
      Object.entries(operation.responses ?? {}).map(([status, response]) => [
        status,
        resolveResponse(response, components),
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

/**
 * Exported for its unit tests; nothing outside this module imports it.
 *
 * @internal
 */
export function makeRoute(
  method: (typeof HTTP_METHODS)[number],
  path: string,
  operation: Operation,
  components?: OpenAPI['components'],
) {
  const operationId = resolveOperationId(operation, method, path)
  const tags = operation.tags ?? []
  const params = makeParamsSchema(operation.parameters ?? [], 'path', components)
  const query = makeParamsSchema(operation.parameters ?? [], 'query', components)
  const headers = makeParamsSchema(operation.parameters ?? [], 'header', components)
  const cookie = makeParamsSchema(operation.parameters ?? [], 'cookie', components)
  const body = bodyInfo(operation, components)
  const synth = (kind: string) => `${toSafeIdentifier(operationId)}${kind}`

  const responsesAndInline = Object.entries(operation.responses ?? {}).map(([status, response]) => {
    const info = responseInfo(response)
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

  const inlineSchemas: { name: string; schema: Schema; context?: TypeboxCtx }[] = [
    ...(params ? [{ name: synth('Params'), schema: params.schema, context: params.context }] : []),
    ...(query ? [{ name: synth('Query'), schema: query.schema, context: query.context }] : []),
    ...(headers
      ? [{ name: synth('Headers'), schema: headers.schema, context: headers.context }]
      : []),
    ...(cookie ? [{ name: synth('Cookie'), schema: cookie.schema, context: cookie.context }] : []),
    ...(body.inline ? [{ name: synth('Body'), schema: body.inline, context: body.context }] : []),
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

/**
 * The operation with the parameters its path item declares for every operation under it.
 *
 * A parameter the operation declares itself, by name and location, replaces the path item's; the
 * rest are inherited, ahead of the operation's own.
 */
function withPathItemParameters(
  operation: Operation,
  inherited: readonly (Parameter | Reference)[],
  components: Components | undefined,
) {
  if (inherited.length === 0) return operation
  const own = operation.parameters ?? []
  const declared = new Set(
    own
      .map((p) => resolveParameter(p, components))
      .filter((p): p is Parameter => p !== undefined)
      .map((p) => `${p.in}:${p.name}`),
  )
  const added = inherited.filter((p) => {
    const parameter = resolveParameter(p, components)
    return parameter !== undefined && !declared.has(`${parameter.in}:${parameter.name}`)
  })
  return { ...operation, parameters: [...added, ...own] }
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
      resolveOperation(
        withPathItemParameters(operation, resolved.parameters ?? [], api.components),
        api.components,
      ),
      renames,
    )
    return [
      [resource, makeRoute(method, normalizedPath, resolvedOperation, api.components)] as const,
    ]
  })
}

export function operationsByResource(api: OpenAPI) {
  const canonical = canonicalParamNames([
    ...Object.keys(api.paths ?? {}).filter(isElysiaRoutePath),
    ...Object.keys(api.webhooks ?? {}).map((event) => `/webhooks/${event}`),
  ])
  const grouped = new Map<
    string,
    { route: Route; inlineSchemas: { name: string; schema: Schema; context?: TypeboxCtx }[] }[]
  >()
  const collect = (
    resource: string,
    item: { route: Route; inlineSchemas: { name: string; schema: Schema; context?: TypeboxCtx }[] },
  ) => {
    const bucket = grouped.get(resource) ?? []
    bucket.push(item)
    grouped.set(resource, bucket)
  }
  for (const [path, pathItem] of Object.entries(api.paths ?? {})) {
    if (!pathItem || !isElysiaRoutePath(path)) continue
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
