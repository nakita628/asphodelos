import { isMediaWithSchema } from '../../guard/index.js'
import { nonExistentPathValue } from '../../helper/faker.js'
import {
  HTTP_METHODS,
  operationsByResource,
  resolveOperation,
  resolveOperationId,
  resourceName,
} from '../../helper/index.js'
import { pathEntries } from '../../openapi/index.js'
import type { OpenAPI, Schema } from '../../openapi/index.js'
import { toSafeIdentifier } from '../../utils/index.js'
import { collectSchemaRefs, makeMockFunctions, schemaToFaker } from '../faker/index.js'

// Resolve an operation's effective security requirements into concrete auth
// schemes (bearer / basic / apiKey / oauth2) for test header/credential synthesis.
function extractSecurity(
  opSecurity: readonly { readonly [k: string]: readonly string[] }[] | undefined,
  globalSecurity: readonly { readonly [k: string]: readonly string[] }[] | undefined,
  securitySchemes:
    | {
        readonly [k: string]: {
          readonly type?: string
          readonly name?: string
          readonly in?: string
          readonly scheme?: string
          readonly $ref?: string
        }
      }
    | undefined,
) {
  const defs = opSecurity ?? globalSecurity ?? ([] as const)
  return defs.flatMap((secDef) =>
    Object.keys(secDef).flatMap(
      (
        schemeName,
      ): {
        type: 'bearer' | 'apiKey' | 'basic' | 'oauth2'
        name: string
        in?: 'header' | 'query' | 'cookie'
      }[] => {
        const scheme = securitySchemes?.[schemeName]
        if (!scheme || typeof scheme.type !== 'string') return []
        if (scheme.type === 'http' && scheme.scheme === 'bearer') {
          return [{ type: 'bearer', name: 'Authorization' }]
        }
        if (scheme.type === 'http' && scheme.scheme === 'basic') {
          return [{ type: 'basic', name: 'Authorization' }]
        }
        if (scheme.type === 'apiKey') {
          const inLocation =
            scheme.in === 'header' || scheme.in === 'query' || scheme.in === 'cookie'
              ? scheme.in
              : 'header'
          return [{ type: 'apiKey', name: scheme.name || 'X-API-Key', in: inLocation }]
        }
        if (scheme.type === 'oauth2') return [{ type: 'oauth2', name: 'Authorization' }]
        return []
      },
    ),
  )
}

export function extractTestCases(spec: OpenAPI) {
  const components = spec.components
  return pathEntries(spec).flatMap(([path, pathItem]) => {
    if (!pathItem) return [] as const
    return HTTP_METHODS.flatMap((method) => {
      const operation = pathItem[method]
      if (!operation) return [] as const
      const resolved = resolveOperation(operation, components)
      const resolvedParams = resolved.parameters.map((param) => {
        const schema = param.schema ?? { type: 'string' as const }
        return { param, schema, fakerCode: schemaToFaker(schema, param.name) }
      })
      const pathParams = resolvedParams
        .filter((p) => p.param.in === 'path')
        .map((p) => ({ name: p.param.name, fakerCode: p.fakerCode, schema: p.schema }))
      const queryParams = resolvedParams
        .filter((p) => p.param.in === 'query')
        .map((p) => ({
          name: p.param.name,
          fakerCode: p.fakerCode,
          required: p.param.required ?? false,
        }))
      const headerParams = resolvedParams
        .filter((p) => p.param.in === 'header')
        .map((p) => ({
          name: p.param.name,
          fakerCode: p.fakerCode,
          required: p.param.required ?? false,
        }))
      const requestBodyDef = resolved.requestBody
      const jsonMedia =
        requestBodyDef && 'content' in requestBodyDef
          ? requestBodyDef.content?.['application/json']
          : undefined
      const jsonBodySchema =
        jsonMedia && isMediaWithSchema(jsonMedia) ? jsonMedia.schema : undefined
      const requestBody = jsonBodySchema ? { fakerCode: schemaToFaker(jsonBodySchema) } : undefined
      const bodyRefs = jsonBodySchema
        ? collectSchemaRefs(jsonBodySchema, components?.schemas)
        : ([] as const)
      const paramRefs = resolvedParams.flatMap((p) =>
        collectSchemaRefs(p.schema, components?.schemas),
      )
      const usedSchemaRefs = [...new Set([...bodyRefs, ...paramRefs])]
      const responseKeys = Object.keys(operation.responses ?? {})
      const successStatus =
        responseKeys
          .filter((s) => s.startsWith('2'))
          .map((s) => Number.parseInt(s, 10))
          .toSorted((a, b) => a - b)[0] ?? 200
      const errorStatuses = responseKeys
        .filter((s) => (s.startsWith('4') || s.startsWith('5')) && s !== 'default')
        .map((s) => Number.parseInt(s, 10))
        .toSorted((a, b) => a - b)
      const security = extractSecurity(
        operation.security,
        spec.security,
        components?.securitySchemes,
      )
      return [
        {
          operationId: resolveOperationId(operation, method, path),
          method: method.toUpperCase(),
          path,
          summary: operation.summary || '',
          tag: operation.tags?.[0],
          pathParams,
          queryParams,
          headerParams,
          requestBody,
          successStatus,
          errorStatuses,
          security,
          usedSchemaRefs,
        },
      ] as const
    })
  })
}

// Safe single-quoted JS string literal (delimiter included).
function quoteSingle(s: string) {
  return `'${s
    .replaceAll('\\', '\\\\')
    .replaceAll("'", "\\'")
    .replaceAll('\n', '\\n')
    .replaceAll('\r', '\\r')
    .replaceAll('	', '\\t')}'`
}

// Escape \, `, ${ for static text inside a template literal. Caller-added
// ${...} substitution markers (added AFTER this escape) remain active.
function escapeTemplateLiteral(s: string) {
  return s.replaceAll('\\', '\\\\').replaceAll('`', '\\`').replaceAll('${', '\\${')
}

// Resolve a path param's (possibly `$ref`) schema to a 404-probe representation.
function resolveNonExistent(schema: Schema, schemas?: { readonly [k: string]: Schema }) {
  const resolved =
    schema.$ref && schemas
      ? (schemas[schema.$ref.replace('#/components/schemas/', '')] ?? schema)
      : schema
  return nonExistentPathValue(resolved)
}

function makeAuthHeader(sec: {
  type: 'bearer' | 'apiKey' | 'basic' | 'oauth2'
  name: string
  in?: 'header' | 'query' | 'cookie'
}) {
  switch (sec.type) {
    case 'bearer':
    case 'oauth2':
      return "'Authorization':`Bearer ${faker.string.alphanumeric(32)}`"
    case 'basic':
      return "'Authorization':`Basic ${btoa(`${faker.internet.username()}:${faker.internet.password()}`)}`"
    case 'apiKey':
      if (sec.in === 'header') return `${quoteSingle(sec.name)}:faker.string.alphanumeric(32)`
      // RFC 6265 cookie credential; apiKey-in-query is appended to the URL instead.
      if (sec.in === 'cookie') {
        return `'Cookie':\`${escapeTemplateLiteral(sec.name)}=\${faker.string.alphanumeric(32)}\``
      }
      // apiKey-in-query is appended to the URL, so it contributes no header.
      return ''
    default:
      return ''
  }
}

// Generates the happy-path test (asserts the spec's success status), plus a 401
// test when the operation is secured and a 404 test when it has a path param and
// the spec declares a 404 — mirroring hono-takibi's generator. Handlers are empty
// stubs, so these are the contract the implementation must satisfy (TDD red→green).
function makeTestCase(
  tc: ReturnType<typeof extractTestCases>[number],
  prefix = '',
  schemas?: { readonly [k: string]: Schema },
) {
  const prefixPart = prefix && prefix !== '/' ? prefix : ''
  const fullPath = `${prefixPart}${tc.path}`
  // Escape template-literal metacharacters BEFORE injecting `${name}` markers
  // to prevent codegen injection from malicious path keys.
  const escapedFullPath = escapeTemplateLiteral(fullPath)
  // The wire name (`param.name`) addresses the URL/header; the JS binding it is
  // read from is `toSafeIdentifier(param.name)` so a hostile parameter name can
  // never reach an identifier position in the generated code.
  const testPath = tc.pathParams.reduce(
    (path, param) => path.replace(`{${param.name}}`, `\${${toSafeIdentifier(param.name)}}`),
    escapedFullPath,
  )
  const pathSetup = tc.pathParams.map(
    (param) => `const ${toSafeIdentifier(param.name)}=${param.fakerCode}`,
  )
  const querySetup = tc.queryParams.map(
    (param) => `const ${toSafeIdentifier(param.name)}=${param.fakerCode}`,
  )
  const queryParts = tc.queryParams.map(
    (param) =>
      `${escapeTemplateLiteral(param.name)}=\${encodeURIComponent(String(${toSafeIdentifier(param.name)}))}`,
  )
  const queryString = queryParts.length > 0 ? `?${queryParts.join('&')}` : ''
  // apiKey-in-query credentials go on the URL; bare `queryString` is reused for
  // the unauthorized-flow test which omits the credential.
  const authQueryParts = tc.security
    .filter((sec) => sec.type === 'apiKey' && sec.in === 'query')
    .map((sec) => `${escapeTemplateLiteral(sec.name)}=\${faker.string.alphanumeric(32)}`)
  const authQueryString =
    authQueryParts.length > 0
      ? queryString
        ? `&${authQueryParts.join('&')}`
        : `?${authQueryParts.join('&')}`
      : ''
  const requiredHeaderParams = tc.headerParams.filter((p) => p.required)
  const headerSetup = requiredHeaderParams.map(
    (param) => `const ${toSafeIdentifier(param.name)}=${param.fakerCode}`,
  )
  const headerEntries = requiredHeaderParams.map(
    (param) => `${quoteSingle(param.name)}:String(${toSafeIdentifier(param.name)})`,
  )
  const authHeaders = tc.security.map(makeAuthHeader).filter(Boolean)
  const { bodySetup, bodyOption, contentTypeHeader } = tc.requestBody
    ? {
        bodySetup: `const body=${tc.requestBody.fakerCode}`,
        bodyOption: ',body:JSON.stringify(body)',
        contentTypeHeader: "'Content-Type':'application/json'",
      }
    : { bodySetup: '', bodyOption: '', contentTypeHeader: '' }
  const headers = [...headerEntries, ...(contentTypeHeader ? [contentTypeHeader] : [])]
  const allHeaders = [...headers, ...authHeaders]
  const headersOption = allHeaders.length > 0 ? `,headers:{${allHeaders.join(',')}}` : ''
  const headersWithoutAuth = headers.length > 0 ? `,headers:{${headers.join(',')}}` : ''
  const summaryPart = tc.summary ? ` - ${tc.summary}` : ''
  const setupCode = [...pathSetup, ...querySetup, ...headerSetup, bodySetup]
    .filter(Boolean)
    .join('\n')
  const describeTitle = quoteSingle(`${tc.method} ${fullPath}`)
  const methodLiteral = quoteSingle(tc.method)
  const mainTest = `describe(${describeTitle},()=>{it(${quoteSingle(`should return ${tc.successStatus}${summaryPart}`)},async()=>{${setupCode}\nconst res=await app.handle(new Request(\`http://localhost${testPath}${queryString}${authQueryString}\`,{method:${methodLiteral}${headersOption}${bodyOption}}))\nexpect(res.status).toBe(${tc.successStatus})})`
  const unauthorizedTest =
    tc.security.length > 0
      ? `\nit('should return 401 without auth',async()=>{${setupCode}\nconst res=await app.handle(new Request(\`http://localhost${testPath}${queryString}\`,{method:${methodLiteral}${headersWithoutAuth}${bodyOption}}))\nexpect(res.status).toBe(401)})`
      : ''
  const notFoundTest =
    tc.pathParams.length > 0 && tc.errorStatuses.includes(404)
      ? (() => {
          const probes = tc.pathParams.map((param) => ({
            param,
            probe: resolveNonExistent(param.schema, schemas),
          }))
          // If any path param admits no valid-yet-non-existent value, the 404
          // case can only be reached by tripping the host's 422 — omit it.
          if (probes.some(({ probe }) => probe === undefined)) return ''
          const probeSetup = probes.flatMap(({ param, probe }) =>
            probe?.kind === 'expr' ? [`const ${toSafeIdentifier(param.name)}=${probe.code}`] : [],
          )
          const notFoundPath = probes.reduce((path, { param, probe }) => {
            const value =
              probe?.kind === 'expr' ? `\${${toSafeIdentifier(param.name)}}` : (probe?.value ?? '')
            return path.replace(`{${param.name}}`, value)
          }, escapedFullPath)
          const notFoundSetupCode = [...probeSetup, ...querySetup, ...headerSetup, bodySetup]
            .filter(Boolean)
            .join('\n')
          return `\nit('should return 404 for non-existent resource',async()=>{${notFoundSetupCode}\nconst res=await app.handle(new Request(\`http://localhost${notFoundPath}${queryString}\`,{method:${methodLiteral}${headersOption}${bodyOption}}))\nexpect(res.status).toBe(404)})`
        })()
      : ''
  return `${mainTest}${unauthorizedTest}${notFoundTest}})\n`
}

function makeTagDescribes(
  testCases: ReturnType<typeof extractTestCases>,
  spec: OpenAPI,
  prefix: string | undefined,
) {
  const byTag = testCases.reduce((acc, tc) => {
    const tag = tc.tag || 'default'
    return acc.set(tag, [...(acc.get(tag) ?? []), tc])
  }, new Map<string, ReturnType<typeof extractTestCases>>())
  return [...byTag.entries()]
    .map(([tag, cases]) => {
      const tagInfo = spec.tags?.find((t) => t.name === tag)
      const tagDescription = tagInfo?.description || tag
      const testCasesCode = cases
        .map((tc) => makeTestCase(tc, prefix, spec.components?.schemas))
        .join('')
      return `describe(${quoteSingle(tagDescription)},()=>{${testCasesCode}})\n`
    })
    .join('')
}

// Import the assembled `app` (exported by generator/app, `.listen()` guarded by
// import.meta.main so importing starts no server) and exercise its real routing
// with `app.handle(...)`. `appImport` is the specifier to the app entry;
// `resourceFilter` narrows the cases to one resource for co-located split files.
function makeAppTestFile(
  spec: OpenAPI,
  appImport: string,
  prefix: string | undefined,
  resourceFilter?: ReadonlySet<string>,
) {
  const testCases = resourceFilter
    ? extractTestCases(spec).filter((tc) => resourceFilter.has(resourceName(tc.path)))
    : extractTestCases(spec)
  const apiTitle = spec.info?.title || 'API'
  const usedSchemaNames = new Set(testCases.flatMap((tc) => tc.usedSchemaRefs))
  const mockFunctions = makeMockFunctions(spec, usedSchemaNames)
  const tagDescribes = makeTagDescribes(testCases, spec, prefix)
  const mockSection = mockFunctions ? `${mockFunctions}\n\n` : ''
  const body = `${mockSection}describe(${quoteSingle(apiTitle)},()=>{${tagDescribes}})\n`
  const needsFaker = body.includes('faker.')
  const fakerImport = needsFaker ? `\nimport{faker}from'@faker-js/faker'` : ''
  const imports = `import{describe,it,expect}from'bun:test'${fakerImport}\nimport{app}from'${appImport}'\n`
  return `${imports}\n${body}`
}

export function makeTestFile(spec: OpenAPI, appImport = '..', prefix?: string) {
  return makeAppTestFile(spec, appImport, prefix)
}

// Co-located split: one test file next to each module (modules/<resource>/index.test.ts),
// each importing the shared assembled `app` and asserting only its own resource's
// routes. `appImport` is the specifier from a module dir to the app entry. No barrel.
export function makeColocatedTestEntries(
  spec: OpenAPI,
  appImport = '../../index',
  prefix?: string,
) {
  const resources = [...operationsByResource(spec).keys()]
  const resourcesWithCases = new Set(extractTestCases(spec).map((tc) => resourceName(tc.path)))
  return resources
    .filter((name) => resourcesWithCases.has(name))
    .map(
      (name) =>
        ({ name, code: makeAppTestFile(spec, appImport, prefix, new Set([name])) }) as const,
    )
}
