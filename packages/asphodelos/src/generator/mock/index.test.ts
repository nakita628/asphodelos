import { describe, expect, it } from 'bun:test'

import type { OpenAPI } from '../../openapi/index.js'
import { makeMock } from './index.js'

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
    expect(makeMock(spec, { prefix: '/api' })).toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

export const app = new Elysia({ prefix: '/api' })
  .get('/health', () => ({ status: faker.helpers.arrayElement(['active', 'inactive', 'pending']) }))

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
    expect(makeMock(spec, { prefix: '/api' })).toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

function mockUser() {
  return { id: faker.number.int({ min: 1, max: 99999 }), name: faker.person.fullName(), email: faker.helpers.arrayElement([faker.internet.email(), undefined]) }
}

export const app = new Elysia({ prefix: '/api' })
  .get('/users', () => (Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => (mockUser()))))
  .post('/users', ({ status }) => status(201, mockUser()))
  .get('/users/:userId', () => (mockUser()))
  .delete('/users/:userId', ({ status }) => status(204))

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
    expect(makeMock(spec)).toBe(`import { Elysia } from 'elysia'

export const app = new Elysia()
  .delete('/items/:id', ({ status }) => status(204))

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
    expect(makeMock(spec, { prefix: '/api' })).toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

export const app = new Elysia({ prefix: '/api' })
  .get('/version', () => faker.string.alpha({ length: { min: 5, max: 20 } }))

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
    expect(makeMock(spec, { prefix: '/api' })).toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

export const app = new Elysia({ prefix: '/api' })
  .get('/d', () => ({ msg: faker.string.alpha({ length: { min: 5, max: 20 } }) }))

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
    expect(makeMock(spec, { prefix: '/api' })).toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

function mockNode(): any {
  return { id: faker.number.int({ min: 1, max: 99999 }), children: faker.helpers.arrayElement([Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => (mockNode())), undefined]) }
}

export const app = new Elysia({ prefix: '/api' })
  .get('/nodes', () => (mockNode()))

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`)
  })
})
