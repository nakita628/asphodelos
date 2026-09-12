import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { TSchema } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import type { Elysia } from 'elysia'

import type { OpenAPI } from '../../openapi/index.js'
import { runGenerator } from '../../testing/index.js'
import { schemas } from '../components/index.js'
import { mock } from './index.js'

/**
 * The mock server is a deliverable a client runs, so the assertions here are requests.
 *
 * A string-equality test on the emitted source proves the handler was written; it cannot say
 * whether Elysia routes to it, whether the faker body satisfies the shape the document promised,
 * or whether the 401 and 404 branches are reachable at all. Each case generates the mock into a
 * throwaway directory, imports it and drives real requests through it.
 *
 * The directory sits inside the package so the generated `import { Elysia } from 'elysia'` and
 * `import { faker }` resolve. `tmp-*` is gitignored and excluded from lint and format.
 */
const PKG_ROOT = path.resolve(import.meta.dir, '../../..')

const workdirs: string[] = []

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

/** Generates a mock server and mounts it, the way `bun run mock.ts` would. */
async function mountMock(spec: OpenAPI, options: Parameters<typeof mock>[2] = {}) {
  const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-mock-'))
  workdirs.push(dir)
  const output = path.join(dir, 'mock.ts')
  await runGenerator(mock(spec, output, options))
  const mod = (await import(output)) as { readonly app: Elysia }
  return {
    output,
    request: (url: string, init?: RequestInit) =>
      mod.app.handle(new Request(`http://localhost${url}`, init)),
  }
}

const USER_SCHEMA = {
  type: 'object',
  required: ['id', 'name'],
  properties: { id: { type: 'string' }, name: { type: 'string' } },
}

const SECURED_SPEC = {
  openapi: '3.1.0',
  info: { title: 'Mock API', version: '1.0.0' },
  security: [{ apiKey: [] }],
  paths: {
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
          },
          '401': { description: 'Unauthorized' },
          '404': { description: 'Not Found' },
        },
      },
    },
    '/public': {
      get: {
        operationId: 'public',
        security: [],
        responses: {
          '200': { description: 'OK', content: { 'application/json': { schema: USER_SCHEMA } } },
        },
      },
    },
  },
  components: {
    securitySchemes: { apiKey: { type: 'apiKey', name: 'X-API-Key', in: 'header' } },
    schemas: { User: USER_SCHEMA },
  },
} as unknown as OpenAPI

describe('generated mock server — success responses', () => {
  it('answers the declared success status with a body that fits the schema', async () => {
    const server = await mountMock(SECURED_SPEC)
    const res = await server.request('/public')

    expect(res.status).toBe(200)
    const body = (await res.json()) as { id?: unknown; name?: unknown }
    expect(typeof body.id).toBe('string')
    expect(typeof body.name).toBe('string')
  })

  it('serves the declared success status rather than 200 when the document says so', async () => {
    const server = await mountMock({
      openapi: '3.1.0',
      info: { title: 'M', version: '1.0.0' },
      paths: {
        '/things': {
          post: {
            operationId: 'createThing',
            responses: {
              '201': {
                description: 'Created',
                content: { 'application/json': { schema: USER_SCHEMA } },
              },
            },
          },
        },
      },
    } as unknown as OpenAPI)

    expect((await server.request('/things', { method: 'POST' })).status).toBe(201)
  })

  it('answers an empty-bodied response with its status and nothing else', async () => {
    const server = await mountMock({
      openapi: '3.1.0',
      info: { title: 'M', version: '1.0.0' },
      paths: {
        '/things/{id}': {
          delete: {
            operationId: 'deleteThing',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '204': { description: 'No Content' } },
          },
        },
      },
    } as unknown as OpenAPI)

    const res = await server.request('/things/abc', { method: 'DELETE' })
    expect(res.status).toBe(204)
    expect(await res.text()).toBe('')
  })
})

describe('generated mock server — the unhappy paths the document promises', () => {
  it('answers 401 when a secured operation gets no credential, and 200 when it does', async () => {
    const server = await mountMock(SECURED_SPEC)
    const id = '11111111-2222-3333-4444-555555555555'

    expect((await server.request(`/users/${id}`)).status).toBe(401)
    expect(
      (await server.request(`/users/${id}`, { headers: { 'X-API-Key': 'anything' } })).status,
    ).toBe(200)
  })

  it('leaves an operation that opts out of security unguarded', async () => {
    const server = await mountMock(SECURED_SPEC)
    expect((await server.request('/public')).status).toBe(200)
  })

  it('answers 404 for the sentinel the test generator also uses', async () => {
    const server = await mountMock(SECURED_SPEC)
    const res = await server.request('/users/00000000-0000-0000-0000-000000000000', {
      headers: { 'X-API-Key': 'anything' },
    })
    expect(res.status).toBe(404)
  })

  it('checks credentials before existence, so an anonymous request never learns what is there', async () => {
    const server = await mountMock(SECURED_SPEC)
    const res = await server.request('/users/00000000-0000-0000-0000-000000000000')
    expect(res.status).toBe(401)
  })

  it('emits no 401 branch when the operation does not declare one', async () => {
    const server = await mountMock({
      ...SECURED_SPEC,
      paths: {
        '/users/{id}': {
          get: {
            operationId: 'getUser',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: USER_SCHEMA } },
              },
            },
          },
        },
      },
    } as unknown as OpenAPI)

    // Secured globally, but a 401 the document never declared would be a response the client was
    // never told about.
    expect((await server.request('/users/abc')).status).toBe(200)
  })
})

describe('generated mock server — examples', () => {
  const EXAMPLE_SPEC = {
    openapi: '3.1.0',
    info: { title: 'M', version: '1.0.0' },
    paths: {
      '/single': {
        get: {
          operationId: 'single',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': { schema: USER_SCHEMA, example: { id: 'x1', name: 'Ada' } },
              },
            },
          },
        },
      },
      '/plural': {
        get: {
          operationId: 'plural',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: USER_SCHEMA,
                  examples: { first: { value: { id: 'p1', name: 'Grace' } } },
                },
              },
            },
          },
        },
      },
      '/referenced': {
        get: {
          operationId: 'referenced',
          responses: {
            '200': {
              description: 'OK',
              content: {
                'application/json': {
                  schema: USER_SCHEMA,
                  examples: { shared: { $ref: '#/components/examples/Shared' } },
                },
              },
            },
          },
        },
      },
    },
    components: { examples: { Shared: { value: { id: 'r1', name: 'Alan' } } } },
  } as unknown as OpenAPI

  it('serves the declared example verbatim, from example, examples and a $ref alike', async () => {
    const server = await mountMock(EXAMPLE_SPEC)

    expect(await (await server.request('/single')).json()).toStrictEqual({ id: 'x1', name: 'Ada' })
    expect(await (await server.request('/plural')).json()).toStrictEqual({
      id: 'p1',
      name: 'Grace',
    })
    expect(await (await server.request('/referenced')).json()).toStrictEqual({
      id: 'r1',
      name: 'Alan',
    })
  })

  it('falls back to faker when useExamples is off', async () => {
    const server = await mountMock(EXAMPLE_SPEC, { useExamples: false })
    const body = (await (await server.request('/single')).json()) as { id?: unknown }
    expect(body.id).not.toBe('x1')
    expect(typeof body.id).toBe('string')
  })
})

describe('generated mock server — options', () => {
  it('delays every response by the configured amount', async () => {
    const server = await mountMock(SECURED_SPEC, { delay: 120 })
    const started = Date.now()
    expect((await server.request('/public')).status).toBe(200)
    expect(Date.now() - started).toBeGreaterThanOrEqual(100)
  })

  it('imports the locale build of faker when one is configured', async () => {
    const server = await mountMock(SECURED_SPEC, { locale: 'ja' })
    const source = await readFile(server.output, 'utf-8')
    expect(source).toContain("from '@faker-js/faker/locale/ja'")
  })

  it('mounts the configured prefix, so nothing answers without it', async () => {
    const server = await mountMock(SECURED_SPEC, { prefix: '/api/v1' })
    expect((await server.request('/api/v1/public')).status).toBe(200)
    expect((await server.request('/public')).status).toBe(404)
  })
})

// ── Schema conformance, seed and Prefer ──────────────────────────────────────────────────────
//
// The mock's bodies are checked against the TypeBox models asphodelos generates for the same
// document (the models the real Elysia app validates with), sampled repeatedly with the real
// faker, so a value the model rejects fails here rather than in a client.

const EDGE_SPEC = {
  openapi: '3.1.0',
  info: { title: 'Edge', version: '1.0.0' },
  paths: {
    '/profiles/{id}': {
      get: {
        operationId: 'getProfile',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'OK',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/User-Profile' } },
            },
          },
        },
      },
    },
    '/formats': {
      get: {
        operationId: 'getFormats',
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Formats' } } },
          },
        },
      },
    },
    '/orders/{orderId}': {
      get: {
        operationId: 'getOrder',
        parameters: [{ name: 'orderId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': {
            description: 'The order',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/Order' },
                examples: {
                  shipped: { $ref: '#/components/examples/ShippedOrder' },
                  pending: { value: { id: 'o-2', state: 'pending' } },
                },
              },
            },
          },
          '404': {
            description: 'No such order',
            content: {
              'application/problem+json': {
                schema: { $ref: '#/components/schemas/Problem' },
                examples: { gone: { value: { title: 'Order deleted', status: 404 } } },
              },
            },
          },
          '4XX': {
            description: 'Client error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } },
          },
          '503': { description: 'Maintenance' },
          default: {
            description: 'Unexpected error',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Problem' } } },
          },
        },
      },
    },
  },
  components: {
    examples: { ShippedOrder: { value: { id: 'o-1', state: 'shipped' } } },
    schemas: {
      'User-Profile': {
        type: 'object',
        required: [
          'first-name',
          'full name',
          '1st',
          'status',
          'createdAt',
          'type',
          'price',
          'nickname',
          'tags',
          'labels',
          'role',
          'bio',
          'code',
          // Required: an absent optional `constructor` is read off Object.prototype by TypeBox.
          'constructor',
        ],
        properties: {
          'first-name': { type: 'string' },
          'full name': { type: 'string' },
          '1st': { type: 'integer' },
          // Property-name hints would emit a string or a float; the declared type wins.
          status: { type: 'integer', minimum: 100, maximum: 599 },
          createdAt: { type: 'integer' },
          type: { type: 'integer' },
          price: { type: 'integer' },
          nickname: { type: ['string', 'null'] },
          age: { type: ['integer', 'null'] },
          // `arrayMin: 5` must clamp to this maxItems.
          tags: { type: 'array', maxItems: 3, items: { type: 'string' } },
          labels: { type: 'object', additionalProperties: { type: 'integer' } },
          role: { type: 'string', enum: ['admin', 'member'], example: 'admin' },
          bio: { type: 'string', examples: ['Hello'] },
          code: { type: 'string', pattern: '^[a-z]{3}/[0-9]{2}$' },
          constructor: { type: 'string' },
        },
      },
      // Every string format Elysia registers with TypeBox (`password` / `binary` are listed by
      // Elysia but not registered, so TypeBox rejects any value for them).
      Formats: {
        type: 'object',
        required: [
          'email',
          'uuid',
          'url',
          'hostname',
          'ipv4',
          'ipv6',
          'time',
          'isoTime',
          'isoDateTime',
          'duration',
          'uriReference',
          'uriTemplate',
          'jsonPointer',
          'jsonPointerFragment',
          'relativeJsonPointer',
          'byte',
        ],
        properties: {
          email: { type: 'string', format: 'email' },
          uuid: { type: 'string', format: 'uuid' },
          url: { type: 'string', format: 'url' },
          hostname: { type: 'string', format: 'hostname' },
          ipv4: { type: 'string', format: 'ipv4' },
          ipv6: { type: 'string', format: 'ipv6' },
          time: { type: 'string', format: 'time' },
          isoTime: { type: 'string', format: 'iso-time' },
          isoDateTime: { type: 'string', format: 'iso-date-time' },
          duration: { type: 'string', format: 'duration' },
          uriReference: { type: 'string', format: 'uri-reference' },
          uriTemplate: { type: 'string', format: 'uri-template' },
          jsonPointer: { type: 'string', format: 'json-pointer' },
          jsonPointerFragment: { type: 'string', format: 'json-pointer-uri-fragment' },
          relativeJsonPointer: { type: 'string', format: 'relative-json-pointer' },
          byte: { type: 'string', format: 'byte' },
        },
      },
      Order: {
        type: 'object',
        required: ['id', 'state'],
        properties: {
          id: { type: 'string' },
          state: { type: 'string', enum: ['pending', 'shipped'] },
        },
      },
      Problem: {
        type: 'object',
        required: ['title', 'status'],
        properties: { title: { type: 'string' }, status: { type: 'integer' } },
      },
    },
  },
} as unknown as OpenAPI

/** Generates the TypeBox models for the document's component schemas and imports them. */
async function generateModels(spec: OpenAPI) {
  const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-mock-'))
  workdirs.push(dir)
  const output = path.join(dir, 'schemas.ts')
  const components = { schemas: { output, split: false } }
  await runGenerator(schemas(spec.components?.schemas, output, false, false, components))
  const mod: { readonly [k: string]: TSchema } = await import(output)
  return mod
}

describe('generated mock server — bodies satisfy the generated TypeBox models', () => {
  const SAMPLES = 50

  it('answers every sample with a body the model accepts', async () => {
    const server = await mountMock(EDGE_SPEC, { useExamples: 'all', arrayMin: 5 })
    const models = await generateModels(EDGE_SPEC)
    const cases = [
      ['/profiles/p1', models.UserProfileSchema],
      ['/formats', models.FormatsSchema],
    ] as const
    for (const [url, model] of cases) {
      expect(model).toBeDefined()
      for (let i = 0; i < SAMPLES; i += 1) {
        const body: unknown = await (await server.request(url)).json()
        const errors = model
          ? [...Value.Errors(model, body)].map((e) => `${e.path}: ${e.message}`)
          : []
        expect(errors).toStrictEqual([])
      }
    }
  })

  it('clamps arrayMin to maxItems, fills a map and uses schema-level examples', async () => {
    const server = await mountMock(EDGE_SPEC, { useExamples: 'all', arrayMin: 5 })
    const body = (await (await server.request('/profiles/p1')).json()) as {
      readonly tags: readonly unknown[]
      readonly labels: { readonly [k: string]: unknown }
      readonly role: unknown
      readonly bio: unknown
    }
    expect(body.tags).toHaveLength(3)
    expect(Object.keys(body.labels).length).toBeGreaterThan(0)
    expect(body.role).toBe('admin')
    expect(body.bio).toBe('Hello')
  })
})

describe('generated mock server — seed', () => {
  it('answers the same body for a route regardless of request order', async () => {
    const server = await mountMock(EDGE_SPEC, { seed: 42, locale: 'ja' })
    const text = async (url: string) => (await server.request(url)).text()
    const first = await text('/profiles/p1')
    await text('/formats')
    expect(await text('/profiles/p1')).toBe(first)
    const concurrent = await Promise.all(Array.from({ length: 6 }, () => text('/formats')))
    expect(new Set(concurrent).size).toBe(1)
  })
})

describe('generated mock server — Prefer selects a declared response', () => {
  async function order(init?: RequestInit, query = '') {
    const server = await mountMock(EDGE_SPEC)
    const res = await server.request(`/orders/o-1${query}`, init)
    return { status: res.status, type: res.headers.get('content-type'), text: await res.text() }
  }
  const prefer = (value: string) => ({ headers: { Prefer: value } })

  it('answers the first example of the success response by default', async () => {
    const res = await order()
    expect(res.status).toBe(200)
    expect(JSON.parse(res.text)).toStrictEqual({ id: 'o-1', state: 'shipped' })
  })

  it('selects a named example of the success response', async () => {
    const res = await order(prefer('example=pending'))
    expect(JSON.parse(res.text)).toStrictEqual({ id: 'o-2', state: 'pending' })
  })

  it('selects a declared error status and keeps its problem+json media type', async () => {
    const res = await order(prefer('code=404, example="gone"'))
    expect(res.status).toBe(404)
    expect(res.type).toStartWith('application/problem+json')
    expect(JSON.parse(res.text)).toStrictEqual({ title: 'Order deleted', status: 404 })
  })

  it('answers a response without content with just its status', async () => {
    const res = await order(prefer('code=503'))
    expect(res.status).toBe(503)
    expect(res.type).not.toStartWith('application/json')
  })

  it('falls back to the 4XX range, then default, with the requested status', async () => {
    expect((await order(prefer('code=409'))).status).toBe(409)
    expect((await order(prefer('code=502'))).status).toBe(502)
  })

  it('reads __code / __example from the query as well', async () => {
    expect((await order(undefined, '?__code=503')).status).toBe(503)
    const res = await order(undefined, '?__example=pending')
    expect(JSON.parse(res.text)).toStrictEqual({ id: 'o-2', state: 'pending' })
  })

  it('lets an explicit Prefer win over the 404 sentinel', async () => {
    const server = await mountMock(EDGE_SPEC)
    const res = await server.request('/orders/__non_existent__', prefer('code=200'))
    expect(res.status).toBe(200)
  })

  it.each([
    ['example=missing', 'No example named "missing" is declared for the 200 response.'],
    ['code=404, example=pending', 'No example named "pending" is declared for the 404 response.'],
    ['code=abc', 'Prefer code=abc is not a status code between 200 and 599.'],
  ])('answers 500 problem+json for the undeclared %s', async (value, detail) => {
    const res = await order(prefer(value))
    expect(res.status).toBe(500)
    expect(res.type).toStartWith('application/problem+json')
    expect(JSON.parse(res.text)).toMatchObject({ status: 500, detail })
  })

  it('answers 500 problem+json for a status a route without default does not declare', async () => {
    const server = await mountMock(EDGE_SPEC)
    const res = await server.request('/formats', prefer('code=500'))
    expect(res.status).toBe(500)
    expect(await res.json()).toMatchObject({
      detail: 'No 500 response is declared for this operation.',
    })
  })
})
