import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { Elysia } from 'elysia'

import type { OpenAPI } from '../../openapi/index.js'
import { runGenerator } from '../../testing/index.js'
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
