import { isMediaWithSchema } from '../../guard/index.js'
import { HTTP_METHODS, resolveOperation } from '../../helper/index.js'
import { pathEntries } from '../../openapi/index.js'
import type { OpenAPI, Responses } from '../../openapi/index.js'
import { collectSchemaRefs, makeMockFunctions, schemaToFaker } from '../faker/index.js'

// Picks the success response a mock handler should emulate: the lowest explicit
// 2xx, then a `2XX` wildcard / `default` (served as 200), then the first declared
// response as a last resort. Status is a number so it can be passed to Elysia's
// `status()` helper as a literal.
function pickSuccessResponse(responses: { readonly [k: string]: Responses }) {
  const keys = Object.keys(responses)
  const [status] = keys
    .filter((k) => /^2\d\d$/.test(k))
    .map((k) => Number.parseInt(k, 10))
    .toSorted((a, b) => a - b)
  if (status !== undefined) {
    return { status, response: responses[String(status)] } as const
  }
  const wildcard = responses['2XX'] ?? responses['2xx'] ?? responses.default
  if (wildcard) return { status: 200, response: wildcard } as const
  const first = keys[0]
  if (first === undefined) return { status: 200, response: undefined } as const
  const parsed = Number.parseInt(first, 10)
  return { status: Number.isNaN(parsed) ? 200 : parsed, response: responses[first] } as const
}

// The faker expression a handler returns, classified by content type so the
// caller can pick the right Elysia return shape (JSON value / text / empty body).
function responseBody(response: Responses | undefined) {
  const content = response?.content
  if (!content) return { kind: 'empty', expr: '' } as const
  const json = content['application/json']
  if (json && isMediaWithSchema(json)) {
    return { kind: 'json', expr: schemaToFaker(json.schema) } as const
  }
  const text = content['text/plain']
  if (text) {
    const expr = isMediaWithSchema(text) ? schemaToFaker(text.schema) : 'faker.lorem.sentence()'
    return { kind: 'text', expr } as const
  }
  return { kind: 'empty', expr: '' } as const
}

// 200 returns the value directly (Elysia defaults to 200); other statuses use the
// `status(code, body)` helper so the declared success code reaches the wire.
function makeHandler(status: number, body: ReturnType<typeof responseBody>) {
  if (body.kind === 'empty') return `({ status }) => status(${status})`
  if (status === 200) {
    const value = body.kind === 'json' ? `(${body.expr})` : body.expr
    return `() => ${value}`
  }
  return `({ status }) => status(${status}, ${body.expr})`
}

// Safe single-quoted JS string literal (delimiter included) so a hostile path or
// prefix cannot break out of the literal.
function quoteSingle(s: string) {
  return `'${s
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('	', '\\t')}'`
}

// OpenAPI `/users/{userId}` → Elysia `/users/:userId`.
function routePath(path: string) {
  return quoteSingle(path.replaceAll(/\{([^}]+)\}/g, ':$1'))
}

/**
 * One self-contained Elysia file that stands up a mock server: a faker factory per
 * referenced component schema, then every operation wired to a handler that returns
 * a mock of its declared success response. `import.meta.main` guards `listen()` so
 * importing the module (e.g. from a test) starts no server.
 */
export function makeMock(
  spec: OpenAPI,
  options: { readonly prefix?: string; readonly port?: string } = {},
) {
  const { prefix, port = '3000' } = options
  const components = spec.components
  const routes = pathEntries(spec).flatMap(([path, pathItem]) => {
    if (!pathItem) return [] as const
    return HTTP_METHODS.flatMap((method) => {
      const operation = pathItem[method]
      if (!operation) return [] as const
      const resolved = resolveOperation(operation, components)
      const { status, response } = pickSuccessResponse(resolved.responses)
      const body = responseBody(response)
      const refs =
        body.kind === 'json' &&
        response?.content?.['application/json'] &&
        isMediaWithSchema(response.content['application/json'])
          ? collectSchemaRefs(response.content['application/json'].schema, components?.schemas)
          : ([] as const)
      return [
        {
          method,
          path,
          code: `.${method}(${routePath(path)}, ${makeHandler(status, body)})`,
          refs,
        },
      ] as const
    })
  })
  const usedSchemaNames = new Set(routes.flatMap((r) => r.refs))
  const mockFunctions = makeMockFunctions(spec, usedSchemaNames)
  const ctorArgs = prefix ? `{ prefix: ${quoteSingle(prefix)} }` : ''
  const routeChain = routes.map((r) => `  ${r.code}`).join('\n')
  const listenBlock =
    '\n\nif (import.meta.main) {\n' +
    `  app.listen(${port})\n` +
    '  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)\n' +
    '}'
  const appCode = `export const app = new Elysia(${ctorArgs})\n${routeChain}${listenBlock}`
  const body = mockFunctions ? `${mockFunctions}\n\n${appCode}` : appCode
  const fakerImport = body.includes('faker.') ? "\nimport { faker } from '@faker-js/faker'" : ''
  return `import { Elysia } from 'elysia'${fakerImport}\n\n${body}\n`
}
