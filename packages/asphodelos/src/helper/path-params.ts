import { isReference } from '../guard/index.js'
import type { Operation } from '../openapi/index.js'

function isIdentifier(name: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(name)
}

function paramToken(segment: string) {
  return /^\{(.+)\}$/u.exec(segment)?.[1] ?? null
}

// Eden treaty keys its path-tree type on the literal param name, so two routes
// that share a path position but spell its dynamic segment differently (e.g.
// `/audiences/{id}` vs `/audiences/{audience_id}/contacts`) collapse `app.audiences(...)`
// to a union whose branches expose disjoint children — `.contacts` then fails to
// resolve. Pick one canonical name per position so the server registers a single
// node. Only positions where every spelling is a valid identifier are normalized:
// a name carrying a non-identifier char (Twilio's `Sid.json`) encodes a static URL
// suffix glued onto the param, and rewriting it would alter the route's URL.
export function canonicalParamNames(paths: readonly string[]): ReadonlyMap<string, string> {
  const namesByPosition = new Map<string, Set<string>>()
  for (const path of paths) {
    const norm: string[] = []
    for (const segment of path.split('/').filter(Boolean)) {
      const token = paramToken(segment)
      if (token === null) {
        norm.push(segment)
        continue
      }
      const key = [...norm, '{}'].join('/')
      const names = namesByPosition.get(key) ?? new Set<string>()
      names.add(token)
      namesByPosition.set(key, names)
      norm.push('{}')
    }
  }
  const canonical = new Map<string, string>()
  for (const [key, names] of namesByPosition) {
    if (names.size < 2) continue
    const spellings = [...names]
    if (!spellings.every(isIdentifier)) continue
    // Prefer the most specific spelling (longest); break ties lexicographically.
    const representative = spellings.reduce((a, b) =>
      b.length > a.length || (b.length === a.length && b < a) ? b : a,
    )
    canonical.set(key, representative)
  }
  return canonical
}

// Rewrites a path's dynamic segments to their canonical names and reports the
// per-path `oldName -> canonicalName` map so the operation's path parameters can
// follow. OpenAPI guarantees param names are unique within a path, so the rename
// map is unambiguous.
export function normalizePath(path: string, canonical: ReadonlyMap<string, string>) {
  const norm: string[] = []
  const renames = new Map<string, string>()
  const segments = path.split('/').filter(Boolean)
  const out = segments.map((segment) => {
    const token = paramToken(segment)
    if (token === null) {
      norm.push(segment)
      return segment
    }
    const key = [...norm, '{}'].join('/')
    norm.push('{}')
    const representative = canonical.get(key)
    if (representative && representative !== token) {
      renames.set(token, representative)
      return `{${representative}}`
    }
    return segment
  })
  return { path: `/${out.join('/')}`, renames }
}

export function renameOperationParams(operation: Operation, renames: ReadonlyMap<string, string>) {
  if (renames.size === 0 || !operation.parameters) return operation
  const parameters = operation.parameters.map((p) =>
    !isReference(p) && p.in === 'path' && renames.has(p.name)
      ? { ...p, name: renames.get(p.name) ?? p.name }
      : p,
  )
  return { ...operation, parameters }
}

/**
 * A path key as the app registers it with Elysia: `/users/{userId}` is `/users/:userId`. Elysia
 * reads a parameter from its `:` to the end of the segment, so `/{Sid}.json` is the parameter
 * `Sid.json`; the Eden chain is read off this spelling too, so a hook calls what the app routes.
 */
export function elysiaPath(pathKey: string) {
  return pathKey.replaceAll(/\{([^}]+)\}/gu, ':$1')
}

const warnedKeys = new Set<string>()

function routeProblem(pathKey: string) {
  if (/\{[^/{}]+\}\?/u.test(pathKey)) {
    return 'has a query string after a path parameter, which Elysia reads as an optional parameter'
  }
  if (/\{[^/{}]+\}[^/?]/u.test(pathKey)) {
    return 'has static text after a path parameter in its segment, which Elysia reads as part of the parameter name'
  }
  return null
}

/**
 * Whether a path key can become an Elysia route path.
 *
 * A key with a query string right after a `{param}` segment, such as `/jobs/{id}?beta=true`, cannot:
 * Elysia reads `:id?` as an optional parameter, so the route tree Eden types would lose the routes
 * beside it (`/jobs/{id}/cancel`). Nor can a key with static text after a `{param}` in its segment,
 * such as `/Accounts/{Sid}.json`: Elysia reads `:Sid.json` as the parameter `Sid.json`, so the
 * params model rejects every request, and a route that names the same position with another
 * parameter (`/Accounts/{AccountSid}/Calls.json`) keeps the app from starting. Such a key is left
 * out of the app, its types, the mock, the Eden wrappers and the hooks, with a warning once per key.
 */
export function isElysiaRoutePath(pathKey: string) {
  const reason = routeProblem(pathKey)
  if (reason === null) return true
  if (!warnedKeys.has(pathKey)) {
    warnedKeys.add(pathKey)
    console.warn(
      `[asphodelos] path '${pathKey}' ${reason}; it is left out of the app, its types, the mock, the Eden wrappers and the hooks`,
    )
  }
  return false
}
