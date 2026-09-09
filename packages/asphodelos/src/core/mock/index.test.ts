import { afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { OpenAPI } from '../../openapi/index.js'
import { runGenerator } from '../../testing/index.js'
import { mock } from './index.js'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true })
})

describe('mock', () => {
  it('writes a formatted, self-contained Elysia mock server to the output file', async () => {
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
    const dir = mkdtempSync(path.join(tmpdir(), 'asph-mock-'))
    dirs.push(dir)
    const output = path.join(dir, 'mock.ts')
    const result = await runGenerator(mock(spec, output, { prefix: '/api' }))
    expect(result).toStrictEqual(`Generated mock server written to ${output}`)
    expect(await readFile(output, 'utf-8')).toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

function mockUser() {
  return {
    id: faker.number.int({ min: 1, max: 99999 }),
    name: faker.person.fullName(),
    email: faker.helpers.arrayElement([faker.internet.email(), undefined]),
  }
}

export const app = new Elysia({ prefix: '/api' })
  .get('/users', () =>
    Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => mockUser()),
  )
  .post('/users', ({ status }) => status(201, mockUser()))
  .delete('/users/:userId', ({ status }) => status(204))

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`)
  })

  it('inlines the mock for an object response when there is no component schema', async () => {
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
    const dir = mkdtempSync(path.join(tmpdir(), 'asph-mock-'))
    dirs.push(dir)
    const output = path.join(dir, 'mock.ts')
    await runGenerator(mock(spec, output, { prefix: '/api' }))
    expect(await readFile(output, 'utf-8')).toBe(`import { Elysia } from 'elysia'
import { faker } from '@faker-js/faker'

export const app = new Elysia({ prefix: '/api' }).get('/health', () => ({
  status: faker.helpers.arrayElement(['active', 'inactive', 'pending']),
}))

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`)
  })
})
