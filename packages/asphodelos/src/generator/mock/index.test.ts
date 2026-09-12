import { describe, expect, it } from 'bun:test'

import type { OpenAPI } from '../../openapi/index.js'
import { makeMock } from './index.js'

// The Prism-compatible `Prefer` helpers are emitted verbatim into every mock; they are pinned once
// (the `Prefer` suite in the generator tests) and stand in as one line everywhere else.
function withoutPreferHelpers(code: string) {
  return code.replace(
    /\/\/ Reads Prism's[\s\S]*?\nfunction preferProblem\([\s\S]*?\n\}\n/u,
    '/* resolvePrefer, preferProblem */\n',
  )
}

describe('makeMock', () => {
  it('emits a self-contained Elysia app with an inline mock for a 200 object response', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/health': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { status: { type: 'string' } },
                      required: ['status'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
    expect(withoutPreferHelpers(makeMock(spec, { prefix: '/api' })))
      .toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

/* resolvePrefer, preferProblem */

export const app = new Elysia({ prefix: '/api' })
  .get('/health', (c) => {
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"200":[]}, '200')
    if (prefer.problem) return prefer.problem
    return ({ status: faker.helpers.arrayElement(['active', 'inactive', 'pending']) })
  })

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`)
  })

  it('wires array / single / 201 / 204 routes to a shared component mock factory', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'Users API', version: '1' },
      paths: {
        '/users': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    schema: { type: 'array', items: { $ref: '#/components/schemas/User' } },
                  },
                },
              },
            },
          },
          post: {
            responses: {
              '201': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
              },
            },
          },
        },
        '/users/{userId}': {
          get: {
            parameters: [
              { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
              },
            },
          },
          delete: {
            parameters: [
              { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: { '204': { description: 'deleted' } },
          },
        },
      },
      components: {
        schemas: {
          User: {
            type: 'object',
            required: ['id', 'name'],
            properties: {
              id: { type: 'integer' },
              name: { type: 'string' },
              email: { type: 'string', format: 'email' },
            },
          },
        },
      },
    }
    expect(withoutPreferHelpers(makeMock(spec, { prefix: '/api' })))
      .toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

function mockUser() {
  return { id: faker.number.int({ min: 1, max: 99999 }), name: faker.person.fullName(), email: faker.helpers.arrayElement([faker.internet.email(), undefined]) }
}

/* resolvePrefer, preferProblem */

export const app = new Elysia({ prefix: '/api' })
  .get('/users', (c) => {
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"200":[]}, '200')
    if (prefer.problem) return prefer.problem
    return (Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => (mockUser())))
  })
  .post('/users', (c) => {
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"201":[]}, '201')
    if (prefer.problem) return prefer.problem
    return c.status(201, mockUser())
  })
  .get('/users/:userId', (c) => {
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"200":[]}, '200')
    if (prefer.problem) return prefer.problem
    return (mockUser())
  })
  .delete('/users/:userId', (c) => {
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"204":[]}, '204')
    if (prefer.problem) return prefer.problem
    return c.status(204)
  })

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`)
  })

  it('omits the prefix and the faker import for a 204-only spec', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/items/{id}': {
          delete: {
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: { '204': { description: 'deleted' } },
          },
        },
      },
    }
    expect(withoutPreferHelpers(makeMock(spec))).toBe(`import { Elysia } from 'elysia'

/* resolvePrefer, preferProblem */

export const app = new Elysia()
  .delete('/items/:id', (c) => {
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"204":[]}, '204')
    if (prefer.problem) return prefer.problem
    return c.status(204)
  })

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`)
  })

  it('returns a bare string for a text/plain response', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/version': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: { 'text/plain': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    }
    expect(withoutPreferHelpers(makeMock(spec, { prefix: '/api' })))
      .toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

/* resolvePrefer, preferProblem */

export const app = new Elysia({ prefix: '/api' })
  .get('/version', (c) => {
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"200":[]}, '200')
    if (prefer.problem) return prefer.problem
    return faker.string.alpha({ length: { min: 5, max: 20 } })
  })

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`)
  })

  it('serves a `default`-only response as 200', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/d': {
          get: {
            responses: {
              default: {
                description: 'def',
                content: {
                  'application/json': {
                    schema: {
                      type: 'object',
                      properties: { msg: { type: 'string' } },
                      required: ['msg'],
                    },
                  },
                },
              },
            },
          },
        },
      },
    }
    expect(withoutPreferHelpers(makeMock(spec, { prefix: '/api' })))
      .toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

/* resolvePrefer, preferProblem */

export const app = new Elysia({ prefix: '/api' })
  .get('/d', (c) => {
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"default":[]}, 'default')
    if (prefer.problem) return prefer.problem
    if (prefer.key === 'default') {
      return c.status(prefer.status ?? 200, { msg: faker.string.alpha({ length: { min: 5, max: 20 } }) })
    }
    return ({ msg: faker.string.alpha({ length: { min: 5, max: 20 } }) })
  })

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`)
  })

  it('marks a self-referential schema factory with `: any` to escape infinite types', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/nodes': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Node' } } },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Node: {
            type: 'object',
            required: ['id'],
            properties: {
              id: { type: 'integer' },
              children: { type: 'array', items: { $ref: '#/components/schemas/Node' } },
            },
          },
        },
      },
    }
    expect(withoutPreferHelpers(makeMock(spec, { prefix: '/api' })))
      .toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

function mockNode(): any {
  return { id: faker.number.int({ min: 1, max: 99999 }), children: faker.helpers.arrayElement([Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => (mockNode())), undefined]) }
}

/* resolvePrefer, preferProblem */

export const app = new Elysia({ prefix: '/api' })
  .get('/nodes', (c) => {
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"200":[]}, '200')
    if (prefer.problem) return prefer.problem
    return (mockNode())
  })

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`)
  })

  it('emits the resolvePrefer / preferProblem helpers once', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: { '/a': { get: { responses: { '204': { description: 'none' } } } } },
    }
    const helpers = makeMock(spec).match(
      /\/\/ Reads Prism's[\s\S]*?\nfunction preferProblem\([\s\S]*?\n\}\n/gu,
    )
    expect(helpers?.length).toBe(1)
    expect(helpers?.[0])
      .toBe(`// Reads Prism's \`Prefer: code=<status>, example=<name>\` header (or the \`__code\` /
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
}
`)
  })

  it('branches on named examples, problem+json, a 4XX range, default and no-content responses', () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/orders/{orderId}': {
          get: {
            parameters: [
              { name: 'orderId', in: 'path', required: true, schema: { type: 'string' } },
            ],
            responses: {
              '200': {
                description: 'The order',
                content: {
                  'application/json': {
                    schema: { $ref: '#/components/schemas/Order' },
                    examples: {
                      shipped: { $ref: '#/components/examples/ShippedOrder' },
                      pending: { value: { id: 'o-2' } },
                      external: { externalValue: 'https://example.com/order.json' },
                    },
                  },
                },
              },
              '404': {
                description: 'No such order',
                content: {
                  'application/problem+json': { schema: { $ref: '#/components/schemas/Problem' } },
                },
              },
              '4xx': {
                description: 'Client error',
                content: { 'text/plain': { schema: { type: 'string' } } },
              },
              '503': { description: 'Maintenance' },
              default: {
                description: 'Unexpected error',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Problem' } },
                },
              },
            },
          },
        },
      },
      components: {
        examples: { ShippedOrder: { value: { id: 'o-1' } } },
        schemas: {
          Order: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } },
          Problem: {
            type: 'object',
            required: ['title'],
            properties: { title: { type: 'string' } },
          },
        },
      },
    } as unknown as OpenAPI
    expect(withoutPreferHelpers(makeMock(spec))).toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

function mockOrder() {
  return { id: faker.string.alpha({ length: { min: 5, max: 20 } }) }
}

function mockProblem() {
  return { title: faker.lorem.sentence() }
}

/* resolvePrefer, preferProblem */

export const app = new Elysia()
  .get('/orders/:orderId', (c) => {
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"200":["shipped","pending"],"404":[],"503":[],"4XX":[],"default":[]}, '200')
    if (prefer.problem) return prefer.problem
    if (prefer.key === '200' && prefer.example === 'pending') {
      return ({"id":"o-2"})
    }
    if (prefer.key === '404') {
      c.set.headers['content-type'] = 'application/problem+json'
      return c.status(404, mockProblem())
    }
    if (prefer.key === '503') {
      return c.status(503)
    }
    if (prefer.key === '4XX') {
      return c.status(prefer.status ?? 400, faker.string.alpha({ length: { min: 5, max: 20 } }))
    }
    if (prefer.key === 'default') {
      return c.status(prefer.status ?? 200, mockProblem())
    }
    if (prefer.key === undefined && c.params['orderId'] === '__non_existent__') return c.status(404)
    return ({"id":"o-1"})
  })

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`)
  })

  it('seeds faker and pins its reference date at the start of every handler that uses it', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1' },
      paths: {
        '/n': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: { 'application/json': { schema: { type: 'integer' } } },
              },
            },
          },
        },
        '/gone': { delete: { responses: { '204': { description: 'gone' } } } },
      },
    }
    expect(withoutPreferHelpers(makeMock(spec, { seed: [1, 2] })))
      .toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

/* resolvePrefer, preferProblem */

export const app = new Elysia()
  .get('/n', (c) => {
    faker.seed([1,2])
    faker.setDefaultRefDate('2025-01-01T00:00:00.000Z')
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"200":[]}, '200')
    if (prefer.problem) return prefer.problem
    return (faker.number.int({ min: 1, max: 1000 }))
  })
  .delete('/gone', (c) => {
    const prefer = resolvePrefer(c.headers.prefer, c.query, {"204":[]}, '204')
    if (prefer.problem) return prefer.problem
    return c.status(204)
  })

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`)
  })
})
