import { isMediaWithSchema, isRecord, isReference } from '../../guard/index.js'
import { nonExistentPathValue } from '../../helper/faker.js'
import { HTTP_METHODS, resolveOperation } from '../../helper/index.js'
import { pathEntries } from '../../openapi/index.js'
import type { Components, OpenAPI, Operation, Responses, Schema } from '../../openapi/index.js'
import { collectSchemaRefs, makeMockFunctions, schemaToFaker } from '../faker/index.js'

export type MockOptions = {
  readonly prefix?: string
  readonly port?: string
  /** Prefer an `example` the document declares over a faker-generated body. Defaults to true. */
  readonly useExamples?: boolean
  /** A faker locale code; swaps the import specifier and nothing else. */
  readonly locale?: string
  /** Milliseconds every response waits, a range to pick from, or `false` for none. */
  readonly delay?: number | { readonly min: number; readonly max: number } | false
}

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

/**
 * The example a media type declares, if it declares one.
 *
 * `example` wins over `examples`, and the first `examples` entry wins over the rest — a document
 * that lists several is showing variants of one realistic response, and a mock only serves one.
 * A `$ref` entry resolves against `components.examples`; an entry that only carries
 * `externalValue` has nothing to serve, so it falls through to faker.
 */
function mediaExample(media: unknown, components: Components | undefined): unknown {
  if (!isRecord(media)) return undefined
  if (media.example !== undefined) return media.example
  if (!isRecord(media.examples)) return undefined
  const first = Object.values(media.examples)[0]
  if (!isRecord(first)) return undefined
  const ref = first.$ref
  const resolved: unknown =
    typeof ref === 'string'
      ? components?.examples?.[ref.replace('#/components/examples/', '')]
      : first
  return isRecord(resolved) ? resolved.value : undefined
}

// The expression a handler returns, classified by content type so the caller can pick the right
// Elysia return shape (JSON value / text / empty body).
function responseBody(
  response: Responses | undefined,
  components: Components | undefined,
  useExamples: boolean,
) {
  const content = response?.content
  if (!content) return { kind: 'empty', expr: '' } as const
  const json = content['application/json']
  if (json) {
    const example = useExamples ? mediaExample(json, components) : undefined
    if (example !== undefined) return { kind: 'json', expr: JSON.stringify(example) } as const
    if (isMediaWithSchema(json)) {
      return { kind: 'json', expr: schemaToFaker(json.schema) } as const
    }
  }
  const text = content['text/plain']
  if (text) {
    const example = useExamples ? mediaExample(text, components) : undefined
    if (typeof example === 'string') return { kind: 'text', expr: JSON.stringify(example) } as const
    const expr = isMediaWithSchema(text) ? schemaToFaker(text.schema) : 'faker.lorem.sentence()'
    return { kind: 'text', expr } as const
  }
  return { kind: 'empty', expr: '' } as const
}

/**
 * The expression that reads the credential a security scheme expects, or `undefined` when the
 * scheme is one a mock cannot check for.
 *
 * Only presence is checked: a mock that validated credentials would need a user store, and the
 * point of the 401 branch is that a client can exercise the unauthorized path at all.
 */
function credentialExpr(scheme: {
  readonly type?: string
  readonly name?: string
  readonly in?: string
  readonly scheme?: string
}) {
  if (scheme.type === 'http' || scheme.type === 'oauth2' || scheme.type === 'openIdConnect') {
    return 'c.headers.authorization'
  }
  if (scheme.type !== 'apiKey') return undefined
  const name = scheme.name ?? 'X-API-Key'
  if (scheme.in === 'query') return `c.query[${quoteSingle(name)}]`
  if (scheme.in === 'cookie') return `c.cookie[${quoteSingle(name)}]?.value`
  return `c.headers[${quoteSingle(name.toLowerCase())}]`
}

/**
 * The guard a secured operation answers 401 with, or `''` when there is nothing to guard.
 *
 * Emitted only when the operation declares a 401: without that in the contract a 401 would be a
 * response the client was never told about. Alternatives are OR'd, because OpenAPI's security
 * array is a list of ways to satisfy the requirement.
 */
function authGuard(
  operation: Operation,
  spec: OpenAPI,
  responses: { readonly [k: string]: Responses },
) {
  if (!('401' in responses)) return ''
  const requirements = operation.security ?? spec.security
  if (!requirements || requirements.length === 0) return ''
  const schemes = spec.components?.securitySchemes ?? {}
  const checks = requirements
    .flatMap((requirement) => Object.keys(requirement))
    .map((name) => schemes[name])
    .flatMap((scheme) => {
      if (!scheme || isReference(scheme)) return [] as const
      const expr = credentialExpr(scheme)
      return expr === undefined ? ([] as const) : ([expr] as const)
    })
    .filter((expr, index, all) => all.indexOf(expr) === index)
  if (checks.length === 0) return ''
  return `if (!(${checks.join(' || ')})) return c.status(401)\n    `
}

/**
 * The guard a path parameter answers 404 with, or `''` when there is nothing to guard.
 *
 * Emitted only when the operation declares a 404, for the same reason as the 401: a status the
 * document never mentioned is one the client was never told to expect. The sentinel value is
 * shared with the test generator, so a generated 404 test and the mock agree on which value
 * means "not there".
 */
function notFoundGuard(
  operation: Operation,
  components: Components | undefined,
  responses: { readonly [k: string]: Responses },
) {
  if (!('404' in responses)) return ''
  const guards = (operation.parameters ?? [])
    .map((parameter) =>
      // `Parameter` carries an optional `$ref` of its own, so a reference is a parameter whose
      // `$ref` is set rather than a separate shape.
      parameter.$ref
        ? components?.parameters?.[parameter.$ref.replace('#/components/parameters/', '')]
        : parameter,
    )
    .flatMap((parameter) => {
      if (!parameter || !('in' in parameter) || parameter.in !== 'path') return [] as const
      const schema: Schema | undefined = parameter.schema
      if (!schema) return [] as const
      const sentinel = nonExistentPathValue(schema)
      if (!sentinel) return [] as const
      const value =
        sentinel.kind === 'literal' ? quoteSingle(sentinel.value) : `String(${sentinel.code})`
      return [
        `if (c.params[${quoteSingle(parameter.name)}] === ${value}) return c.status(404)`,
      ] as const
    })
  return guards.length === 0 ? '' : `${guards.join('\n    ')}\n    `
}

/**
 * 200 returns the value directly (Elysia defaults to 200); other statuses use the
 * `status(code, body)` helper so the declared success code reaches the wire.
 *
 * Guards come first, and in this order: a request without credentials never reaches the 404
 * check, which matches what a real server tells an unauthenticated client about what exists.
 */
function makeHandler(
  status: number,
  body: ReturnType<typeof responseBody>,
  guards: { readonly auth: string; readonly notFound: string },
) {
  const prelude = `${guards.auth}${guards.notFound}`
  // Without a guard the handler is a single expression, and destructuring `status` off the
  // context reads better than the whole context does.
  if (prelude === '') {
    if (body.kind === 'empty') return `({ status }) => status(${status})`
    if (status === 200) return `() => ${body.kind === 'json' ? `(${body.expr})` : body.expr}`
    return `({ status }) => status(${status}, ${body.expr})`
  }
  const returned =
    body.kind === 'empty'
      ? `c.status(${status})`
      : status === 200
        ? body.kind === 'json'
          ? `(${body.expr})`
          : body.expr
        : `c.status(${status}, ${body.expr})`
  return `(c) => {\n    ${prelude}return ${returned}\n  }`
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
 * The middleware every response passes through when `delay` is configured.
 *
 * Cross-cutting rather than woven into each handler, so the handlers stay exactly what they would
 * be without it and the output is byte-identical when no delay is asked for.
 */
function delayMiddleware(delay: MockOptions['delay']) {
  if (delay === undefined || delay === false) return ''
  const ms =
    typeof delay === 'number'
      ? String(delay)
      : `faker.number.int({ min: ${String(delay.min)}, max: ${String(delay.max)} })`
  return `\n  .onBeforeHandle(() => new Promise((resolve) => setTimeout(resolve, ${ms})))`
}

/**
 * One self-contained Elysia file that stands up a mock server: a faker factory per referenced
 * component schema, then every operation wired to a handler that returns a mock of its declared
 * success response. `import.meta.main` guards `listen()` so importing the module (e.g. from a
 * test) starts no server.
 *
 * A secured operation that declares a 401 checks for the credential first, and a path parameter
 * with a recognisable "missing" value answers 404 — so a client can drive the unhappy paths the
 * document promises, not just the happy one.
 */
export function makeMock(spec: OpenAPI, options: MockOptions = {}) {
  const { prefix, port = '3000', useExamples = true, locale, delay } = options
  const components = spec.components
  const routes = pathEntries(spec).flatMap(([path, pathItem]) => {
    if (!pathItem) return [] as const
    return HTTP_METHODS.flatMap((method) => {
      const operation = pathItem[method]
      if (!operation) return [] as const
      const resolved = resolveOperation(operation, components)
      const { status, response } = pickSuccessResponse(resolved.responses)
      const body = responseBody(response, components, useExamples)
      const guards = {
        auth: authGuard(resolved, spec, resolved.responses),
        notFound: notFoundGuard(resolved, components, resolved.responses),
      }
      const json = response?.content?.['application/json']
      const refs =
        body.kind === 'json' && json && isMediaWithSchema(json)
          ? collectSchemaRefs(json.schema, components?.schemas)
          : ([] as const)
      return [
        {
          method,
          path,
          code: `.${method}(${routePath(path)}, ${makeHandler(status, body, guards)})`,
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
  const appCode = `export const app = new Elysia(${ctorArgs})${delayMiddleware(delay)}\n${routeChain}${listenBlock}`
  const body = mockFunctions ? `${mockFunctions}\n\n${appCode}` : appCode
  // The locale changes only the import specifier, so every handler body stays byte-identical.
  const fakerModule = locale === undefined ? '@faker-js/faker' : `@faker-js/faker/locale/${locale}`
  const fakerImport = body.includes('faker.') ? `\nimport { faker } from '${fakerModule}'` : ''
  return `import { Elysia } from 'elysia'${fakerImport}\n\n${body}\n`
}
