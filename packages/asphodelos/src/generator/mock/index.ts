import { isMediaWithSchema, isRecord, isReference } from '../../guard/index.js'
import { nonExistentPathValue } from '../../helper/faker.js'
import { HTTP_METHODS, resolveOperation } from '../../helper/index.js'
import type { Components, OpenAPI, Operation, Responses, Schema } from '../../openapi/index.js'
import { collectSchemaRefs, makeMockFunctions, schemaToFaker } from '../faker/index.js'
import type { FakerOptions } from '../faker/index.js'

export type MockOptions = {
  readonly prefix?: string
  readonly port?: string
  /**
   * `true` (default) answers with a response's media-level `example`/`examples`; `'all'` also
   * uses the scalar `example`/`examples` of every schema and property; `false` always generates.
   */
  readonly useExamples?: boolean | 'all'
  /** A faker locale code; swaps the import specifier and nothing else. */
  readonly locale?: string
  /** Milliseconds every response waits, a range to pick from, or `false` for none. */
  readonly delay?: number | { readonly min: number; readonly max: number } | false
  /** Bounds on generated array lengths; a spec `minItems`/`maxItems` wins. */
  readonly arrayMin?: number
  readonly arrayMax?: number
  /**
   * Re-seeds faker (and pins its reference date to `SEED_REF_DATE`) at the start of every
   * handler, so each route answers the same body every time.
   */
  readonly seed?: number | readonly number[]
}

// `faker.date.*` is relative to the current time, so a seeded mock also pins the reference date;
// otherwise every date (and a JWT's `iat`) would drift.
const SEED_REF_DATE = '2025-01-01T00:00:00.000Z'

// A `1XX`…`5XX` range key, upper-cased; every other key as written.
function normalizeKey(key: string) {
  return /^[1-5]xx$/iu.test(key) ? key.toUpperCase() : key
}

// Picks the success response a mock handler should emulate: the lowest explicit
// 2xx, then a `2XX` wildcard / `default` (served as 200), then the first declared
// response as a last resort. Status is a number so it can be passed to Elysia's
// `status()` helper as a literal; `key` is the response's key in the document.
function pickSuccessResponse(responses: { readonly [k: string]: Responses }) {
  const keys = Object.keys(responses)
  const [status] = keys
    .filter((k) => /^2\d\d$/u.test(k))
    .map((k) => Number.parseInt(k, 10))
    .toSorted((a, b) => a - b)
  if (status !== undefined) {
    return { key: String(status), status, response: responses[String(status)] } as const
  }
  const wildcard = ['2XX', '2xx', 'default'].find((k) => k in responses)
  if (wildcard) {
    return { key: normalizeKey(wildcard), status: 200, response: responses[wildcard] } as const
  }
  const first = keys[0]
  if (first === undefined) return { key: '200', status: 200, response: undefined } as const
  const parsed = Number.parseInt(first, 10)
  return {
    key: normalizeKey(first),
    status: Number.isNaN(parsed) ? 200 : parsed,
    response: responses[first],
  } as const
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
  return exampleEntryValue(Object.values(media.examples)[0], components)
}

// An `examples` entry's value, a `$ref` resolved against `components.examples`. An entry that
// only carries `externalValue` has nothing to serve.
function exampleEntryValue(entry: unknown, components: Components | undefined): unknown {
  if (!isRecord(entry)) return undefined
  const ref = entry.$ref
  const resolved: unknown =
    typeof ref === 'string'
      ? components?.examples?.[ref.replace('#/components/examples/', '')]
      : entry
  return isRecord(resolved) ? resolved.value : undefined
}

// The `examples` entries a `Prefer: example=<name>` can select, in document order.
function namedExamples(media: unknown, components: Components | undefined) {
  if (!isRecord(media) || !isRecord(media.examples)) return [] as const
  return Object.entries(media.examples).flatMap(([name, entry]) => {
    const value = exampleEntryValue(entry, components)
    return value === undefined ? ([] as const) : ([[name, value]] as const)
  })
}

// The JSON media of a response: `application/json` first, then any `+json` suffix
// (`application/problem+json`, `application/vnd.api+json`) — error responses are commonly
// declared as problem+json, and would otherwise mock to an empty body.
function jsonMediaType(content: Responses['content']) {
  const types = Object.keys(content ?? {})
  return types.includes('application/json')
    ? 'application/json'
    : types.find((type) => /^application\/(?:[\w.-]+\+)?json(?:;|$)/u.test(type))
}

type ResponseBody =
  | { readonly kind: 'empty'; readonly expr: '' }
  | { readonly kind: 'json'; readonly expr: string; readonly mediaType: string }
  | { readonly kind: 'text'; readonly expr: string }

// The expression a handler returns, classified by content type so the caller can pick the right
// Elysia return shape (JSON value / text / empty body). `example` is the authored value to serve
// instead of faker (`undefined` for none).
function responseBody(
  response: Responses | undefined,
  example: unknown,
  fakerOptions: FakerOptions,
): ResponseBody {
  const content = response?.content
  if (!content) return { kind: 'empty', expr: '' }
  const jsonType = jsonMediaType(content)
  const json = jsonType ? content[jsonType] : undefined
  if (jsonType && json) {
    if (example !== undefined) {
      return { kind: 'json', expr: JSON.stringify(example), mediaType: jsonType }
    }
    if (isMediaWithSchema(json)) {
      const expr = schemaToFaker(json.schema, undefined, fakerOptions)
      return { kind: 'json', expr, mediaType: jsonType }
    }
  }
  const text = content['text/plain']
  if (text) {
    if (typeof example === 'string') return { kind: 'text', expr: JSON.stringify(example) }
    const expr = isMediaWithSchema(text)
      ? schemaToFaker(text.schema, undefined, fakerOptions)
      : 'faker.lorem.sentence()'
    return { kind: 'text', expr }
  }
  return { kind: 'empty', expr: '' }
}

// The authored example a response answers with by default: its JSON media's, else (for a text
// response) its text media's.
function defaultExample(
  response: Responses | undefined,
  components: Components | undefined,
  useExamples: boolean,
): unknown {
  const content = response?.content
  if (!useExamples || !content) return undefined
  const jsonType = jsonMediaType(content)
  return jsonType
    ? mediaExample(content[jsonType], components)
    : mediaExample(content['text/plain'], components)
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
        `if (prefer.key === undefined && c.params[${quoteSingle(parameter.name)}] === ${value}) return c.status(404)`,
      ] as const
    })
  return guards.length === 0 ? '' : `${guards.join('\n    ')}\n    `
}

/**
 * The return statement for one answer. 200 returns the value directly (Elysia defaults to 200);
 * other statuses use the `status(code, body)` helper so the code reaches the wire. A `+json`
 * media type other than `application/json` is set on the response so it survives serialization.
 */
function returnStatement(status: string, body: ResponseBody) {
  if (body.kind === 'empty') return `return c.status(${status})`
  const header =
    body.kind === 'json' && body.mediaType !== 'application/json'
      ? `c.set.headers['content-type'] = ${quoteSingle(body.mediaType)}\n    `
      : ''
  if (status === '200') {
    return `${header}return ${body.kind === 'json' ? `(${body.expr})` : body.expr}`
  }
  return `${header}return c.status(${status}, ${body.expr})`
}

/**
 * The handler: guards first, in this order — a request without credentials never reaches the 404
 * check, which matches what a real server tells an unauthenticated client about what exists —
 * then the `Prefer` selection, then the declared success response.
 */
function makeHandler(parts: {
  readonly seed: string
  readonly auth: string
  readonly prefer: string
  readonly notFound: string
  readonly success: string
}) {
  return `(c) => {\n    ${parts.seed}${parts.auth}${parts.prefer}${parts.notFound}${parts.success}\n  }`
}

/**
 * Module-level helpers for Prism-compatible response selection, emitted once per mock file. The
 * names carry no `mock` prefix, so they can never collide with a component factory
 * (`mock<Name>`).
 */
const PREFER_HELPERS = `// Reads Prism's \`Prefer: code=<status>, example=<name>\` header (or the \`__code\` /
// \`__example\` query) and resolves it against the responses the operation declares: the exact
// status, then its \`NXX\` range, then \`default\`. Without a code the example is looked up in
// the success response. Anything the operation does not declare answers 500 problem+json, as
// Prism does.
function resolvePrefer(
  header: string | undefined,
  query: { readonly [k: string]: string | undefined },
  responses: { readonly [key: string]: readonly string[] },
  success: string,
) {
  let code = query.__code
  let example = query.__example
  for (const [, name = '', quoted, bare] of (header ?? '').matchAll(
    /([A-Za-z]+)\\s*=\\s*(?:"([^"]*)"|([^\\s,;]*))/gu,
  )) {
    if (name.toLowerCase() === 'code') code ??= quoted ?? bare
    if (name.toLowerCase() === 'example') example ??= quoted ?? bare
  }
  if (code === undefined && example === undefined) return {}
  if (code !== undefined && !/^[2-5]\\d\\d$/u.test(code)) {
    return { problem: preferProblem(\`Prefer code=\${code} is not a status code between 200 and 599.\`) }
  }
  const key =
    code === undefined
      ? success
      : [code, \`\${code.slice(0, 1)}XX\`, 'default'].find((k) => Object.hasOwn(responses, k))
  if (key === undefined) {
    return { problem: preferProblem(\`No \${code} response is declared for this operation.\`) }
  }
  if (example !== undefined && !responses[key]?.includes(example)) {
    return {
      problem: preferProblem(
        \`No example named "\${example}" is declared for the \${key} response.\`,
      ),
    }
  }
  return { key, status: code === undefined ? undefined : Number(code), example }
}

function preferProblem(detail: string) {
  return new Response(
    JSON.stringify({ type: 'about:blank', title: 'Mock response unavailable', status: 500, detail }),
    { status: 500, headers: { 'content-type': 'application/problem+json' } },
  )
}`

// Re-indents a multi-line statement one level deeper, for a branch body.
function indent(statement: string) {
  return statement.replaceAll('\n    ', '\n      ')
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
  return quoteSingle(path.replaceAll(/\{([^}]+)\}/gu, ':$1'))
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
 * with a recognizable "missing" value answers 404 — so a client can drive the unhappy paths the
 * document promises, not just the happy one.
 */
export function makeMock(spec: OpenAPI, options: MockOptions = {}) {
  const {
    prefix,
    port = '3000',
    useExamples = true,
    locale,
    delay,
    arrayMin,
    arrayMax,
    seed,
  } = options
  const fakerOptions: FakerOptions = {
    ...(arrayMin !== undefined ? { arrayMin } : {}),
    ...(arrayMax !== undefined ? { arrayMax } : {}),
    ...(useExamples === 'all' ? { useExamples: true } : {}),
  }
  const components = spec.components
  const routes = Object.entries(spec.paths).flatMap(([path, pathItem]) => {
    if (!pathItem) return [] as const
    return HTTP_METHODS.flatMap((method) => {
      const operation = pathItem[method]
      if (!operation) return [] as const
      const resolved = resolveOperation(operation, components)
      const success = pickSuccessResponse(resolved.responses)
      const responses = Object.entries(resolved.responses).map(([rawKey, declared]) => {
        // `resolveOperation` has already followed a `$ref` (an unresolvable one is `{}`).
        const response: Responses = declared
        const content = response.content
        const jsonType = jsonMediaType(content)
        return {
          key: normalizeKey(rawKey),
          response,
          example: defaultExample(response, components, useExamples !== false),
          named: jsonType ? namedExamples(content?.[jsonType], components) : ([] as const),
          jsonSchema: jsonType ? content?.[jsonType] : undefined,
        }
      })
      const refs = responses.flatMap(({ jsonSchema }) =>
        jsonSchema && isMediaWithSchema(jsonSchema)
          ? collectSchemaRefs(jsonSchema.schema, components?.schemas)
          : ([] as const),
      )
      // `Prefer: code=…, example=…` picks any declared response or named example (Prism's
      // convention), so error states can be exercised on demand. A `4XX` / `default` response
      // answers with the requested status. The success response's default body stays the final
      // return.
      const preferTable = Object.fromEntries(
        responses.map((r) => [r.key, r.named.map(([name]) => name)]),
      )
      const render = (r: (typeof responses)[number], example: unknown) => {
        const status = /^\d{3}$/u.test(r.key)
          ? r.key
          : `prefer.status ?? ${/^[1-5]XX$/u.test(r.key) ? `${r.key.slice(0, 1)}00` : '200'}`
        return indent(returnStatement(status, responseBody(r.response, example, fakerOptions)))
      }
      // Every named-example branch comes before the plain per-response branches, so a request
      // naming an example is never caught by its response's default answer. An entry that is
      // already the default answer (the first one) needs no branch.
      const namedBranches = responses.flatMap((r) =>
        r.named
          .filter(([, value]) => value !== r.example)
          .map(
            ([name, value]) =>
              `if (prefer.key === ${quoteSingle(r.key)} && prefer.example === ${quoteSingle(name)}) {\n      ${render(r, value)}\n    }\n    `,
          ),
      )
      const responseBranches = responses
        .filter((r) => !(r.key === success.key && /^\d{3}$/u.test(r.key)))
        .map(
          (r) =>
            `if (prefer.key === ${quoteSingle(r.key)}) {\n      ${render(r, r.example)}\n    }\n    `,
        )
      const branches = [namedBranches, responseBranches].flat()
      const prefer = `const prefer = resolvePrefer(c.headers.prefer, c.query, ${JSON.stringify(preferTable)}, ${quoteSingle(success.key)})\n    if (prefer.problem) return prefer.problem\n    ${branches.join('')}`
      const successBody = responseBody(
        success.response,
        defaultExample(success.response, components, useExamples !== false),
        fakerOptions,
      )
      const auth = authGuard(resolved, spec, resolved.responses)
      const notFound = notFoundGuard(resolved, components, resolved.responses)
      const successReturn = returnStatement(String(success.status), successBody)
      // Seeding inside the handler (not once at module load) makes a route's body independent of
      // which requests ran before it, and the handler body runs synchronously after the seed.
      const usesFaker = /\bfaker\.|\bmock[A-Za-z0-9_$]*\(/u.test(
        `${branches.join('')}${notFound}${successReturn}`,
      )
      const seedCall =
        seed !== undefined && usesFaker
          ? `faker.seed(${JSON.stringify(seed)})\n    faker.setDefaultRefDate('${SEED_REF_DATE}')\n    `
          : ''
      const handler = makeHandler({
        seed: seedCall,
        auth,
        prefer,
        notFound,
        success: successReturn,
      })
      return [{ method, path, code: `.${method}(${routePath(path)}, ${handler})`, refs }] as const
    })
  })
  const usedSchemaNames = new Set(routes.flatMap((r) => r.refs))
  const mockFunctions = makeMockFunctions(spec, usedSchemaNames, fakerOptions)
  const ctorArgs = prefix ? `{ prefix: ${quoteSingle(prefix)} }` : ''
  const routeChain = routes.map((r) => `  ${r.code}`).join('\n')
  const listenBlock =
    '\n\nif (import.meta.main) {\n' +
    `  app.listen(${port})\n` +
    '  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)\n' +
    '}'
  const appCode = `export const app = new Elysia(${ctorArgs})${delayMiddleware(delay)}\n${routeChain}${listenBlock}`
  const helpers = routes.length > 0 ? `${PREFER_HELPERS}\n\n` : ''
  const body = mockFunctions ? `${mockFunctions}\n\n${helpers}${appCode}` : `${helpers}${appCode}`
  // The locale changes only the import specifier, so every handler body stays byte-identical.
  const fakerModule = locale === undefined ? '@faker-js/faker' : `@faker-js/faker/locale/${locale}`
  const fakerImport = body.includes('faker.') ? `\nimport { faker } from '${fakerModule}'` : ''
  return `import { Elysia } from 'elysia'${fakerImport}\n\n${body}\n`
}
