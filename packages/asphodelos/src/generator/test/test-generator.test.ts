import { describe, expect, it } from 'bun:test'

import type { OpenAPI } from '../../openapi/index.js'
import { extractTestCases, makeColocatedTestEntries, makeTestFile } from './test-generator.js'

const twoResourceSpec: OpenAPI = {
  openapi: '3.1.0',
  info: { title: 'Two', version: '1.0.0' },
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        tags: ['users'],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/posts': {
      get: {
        operationId: 'listPosts',
        tags: ['posts'],
        responses: { '200': { description: 'OK' } },
      },
    },
  },
}

describe('extractTestCases', () => {
  it('extracts method/path/params/body/refs per operation (refs resolved)', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      tags: [{ name: 'users', description: 'User operations' }],
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            tags: ['users'],
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
        '/users/{userId}': {
          get: {
            operationId: 'getUser',
            tags: ['users'],
            summary: 'Get user',
            parameters: [
              {
                name: 'userId',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
              },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: { id: { type: 'integer' }, name: { type: 'string' } },
            required: ['id', 'name'],
          },
        },
      },
    }
    expect(extractTestCases(spec)).toStrictEqual([
      {
        operationId: 'createUser',
        method: 'POST',
        path: '/users',
        summary: '',
        tag: 'users',
        pathParams: [],
        queryParams: [],
        headerParams: [],
        requestBody: { fakerCode: 'mockUser()' },
        successStatus: 201,
        errorStatuses: [],
        security: [],
        usedSchemaRefs: ['User'],
      },
      {
        operationId: 'getUser',
        method: 'GET',
        path: '/users/{userId}',
        summary: 'Get user',
        tag: 'users',
        pathParams: [
          {
            name: 'userId',
            fakerCode: 'faker.string.uuid()',
            schema: { type: 'string', format: 'uuid' },
          },
        ],
        queryParams: [],
        headerParams: [],
        requestBody: undefined,
        successStatus: 200,
        errorStatuses: [],
        security: [],
        usedSchemaRefs: [],
      },
    ])
  })
})

describe('makeTestFile', () => {
  it('minimal: imports the assembled app and asserts the spec success status', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'Mini', version: '1.0.0' },
      paths: {
        '/ping': { get: { operationId: 'ping', responses: { '200': { description: 'OK' } } } },
      },
    }
    expect(makeTestFile(spec)).toBe(
      "import{describe,it,expect}from'bun:test'\nimport{app}from'..'\n\ndescribe('Mini',()=>{describe('default',()=>{describe('GET /ping',()=>{it('should return 200',async()=>{\nconst res=await app.handle(new Request(`http://localhost/ping`,{method:'GET'}))\nexpect(res.status).toBe(200)})})\n})\n})\n",
    )
  })

  it('full: faker import, mock function, prefix on URL, app import specifier', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'Test API', version: '1.0.0' },
      tags: [{ name: 'users', description: 'User operations' }],
      paths: {
        '/users': {
          post: {
            operationId: 'createUser',
            tags: ['users'],
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
        '/users/{userId}': {
          get: {
            operationId: 'getUser',
            tags: ['users'],
            summary: 'Get user',
            parameters: [
              {
                name: 'userId',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
              },
            ],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
      components: {
        schemas: {
          User: {
            type: 'object',
            properties: { id: { type: 'integer' }, name: { type: 'string' } },
            required: ['id', 'name'],
          },
        },
      },
    }
    expect(makeTestFile(spec, '../src/modules', '/api')).toBe(
      "import{describe,it,expect}from'bun:test'\nimport{faker}from'@faker-js/faker'\nimport{app}from'../src/modules'\n\nfunction mockUser() {\n  return { id: faker.number.int({ min: 1, max: 99999 }), name: faker.person.fullName() }\n}\n\ndescribe('Test API',()=>{describe('User operations',()=>{describe('POST /api/users',()=>{it('should return 201',async()=>{const body=mockUser()\nconst res=await app.handle(new Request(`http://localhost/api/users`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}))\nexpect(res.status).toBe(201)})})\ndescribe('GET /api/users/{userId}',()=>{it('should return 200 - Get user',async()=>{const userId=faker.string.uuid()\nconst res=await app.handle(new Request(`http://localhost/api/users/${userId}`,{method:'GET'}))\nexpect(res.status).toBe(200)})})\n})\n})\n",
    )
  })

  it('routes a hostile parameter name through a safe identifier binding', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'I', version: '1.0.0' },
      paths: {
        '/x/{id}': {
          get: {
            operationId: 'g',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'q;evil()', in: 'query', schema: { type: 'string' } },
            ],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    expect(makeTestFile(spec)).toBe(
      "import{describe,it,expect}from'bun:test'\nimport{faker}from'@faker-js/faker'\nimport{app}from'..'\n\ndescribe('I',()=>{describe('default',()=>{describe('GET /x/{id}',()=>{it('should return 200',async()=>{const id=faker.string.alpha({ length: { min: 5, max: 20 } })\nconst qEvil=faker.string.alpha({ length: { min: 5, max: 20 } })\nconst res=await app.handle(new Request(`http://localhost/x/${id}?q;evil()=${encodeURIComponent(String(qEvil))}`,{method:'GET'}))\nexpect(res.status).toBe(200)})})\n})\n})\n",
    )
  })

  it('adds a 401 test when secured and a 404 test when the spec declares 404 (spec-driven)', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'Sec', version: '1.0.0' },
      components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } } },
      paths: {
        '/items/{id}': {
          get: {
            operationId: 'getItem',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
            security: [{ bearerAuth: [] }],
            responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
          },
        },
      },
    }
    expect(makeTestFile(spec)).toBe(
      "import{describe,it,expect}from'bun:test'\nimport{faker}from'@faker-js/faker'\nimport{app}from'..'\n\ndescribe('Sec',()=>{describe('default',()=>{describe('GET /items/{id}',()=>{it('should return 200',async()=>{const id=faker.number.int({ min: 1, max: 99999 })\nconst res=await app.handle(new Request(`http://localhost/items/${id}`,{method:'GET',headers:{'Authorization':`Bearer ${faker.string.alphanumeric(32)}`}}))\nexpect(res.status).toBe(200)})\nit('should return 401 without auth',async()=>{const id=faker.number.int({ min: 1, max: 99999 })\nconst res=await app.handle(new Request(`http://localhost/items/${id}`,{method:'GET'}))\nexpect(res.status).toBe(401)})\nit('should return 404 for non-existent resource',async()=>{\nconst res=await app.handle(new Request(`http://localhost/items/2147483647`,{method:'GET',headers:{'Authorization':`Bearer ${faker.string.alphanumeric(32)}`}}))\nexpect(res.status).toBe(404)})})\n})\n})\n",
    )
  })

  it('404 probe honors a constrained path param (no value the host would 422)', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'Min', version: '1.0.0' },
      paths: {
        '/items/{id}': {
          get: {
            operationId: 'getItem',
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'integer', minimum: 1, maximum: 100 },
              },
            ],
            responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
          },
        },
      },
    }
    expect(makeTestFile(spec)).toBe(
      "import{describe,it,expect}from'bun:test'\nimport{faker}from'@faker-js/faker'\nimport{app}from'..'\n\ndescribe('Min',()=>{describe('default',()=>{describe('GET /items/{id}',()=>{it('should return 200',async()=>{const id=faker.number.int({ min: 1, max: 100 })\nconst res=await app.handle(new Request(`http://localhost/items/${id}`,{method:'GET'}))\nexpect(res.status).toBe(200)})\nit('should return 404 for non-existent resource',async()=>{\nconst res=await app.handle(new Request(`http://localhost/items/100`,{method:'GET'}))\nexpect(res.status).toBe(404)})})\n})\n})\n",
    )
  })

  it('404 probe binds a faker expr for a pattern-constrained path param', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'Pat', version: '1.0.0' },
      paths: {
        '/items/{code}': {
          get: {
            operationId: 'getItem',
            parameters: [
              {
                name: 'code',
                in: 'path',
                required: true,
                schema: { type: 'string', pattern: '^[a-z]{3}$' },
              },
            ],
            responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
          },
        },
      },
    }
    expect(makeTestFile(spec)).toBe(
      "import{describe,it,expect}from'bun:test'\nimport{faker}from'@faker-js/faker'\nimport{app}from'..'\n\ndescribe('Pat',()=>{describe('default',()=>{describe('GET /items/{code}',()=>{it('should return 200',async()=>{const code=faker.helpers.fromRegExp(\"^[a-z]{3}$\")\nconst res=await app.handle(new Request(`http://localhost/items/${code}`,{method:'GET'}))\nexpect(res.status).toBe(200)})\nit('should return 404 for non-existent resource',async()=>{const code=faker.helpers.fromRegExp(\"^[a-z]{3}$\")\nconst res=await app.handle(new Request(`http://localhost/items/${code}`,{method:'GET'}))\nexpect(res.status).toBe(404)})})\n})\n})\n",
    )
  })

  it('omits the 404 test when an enum path param admits no non-existent value', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'Enum', version: '1.0.0' },
      paths: {
        '/items/{kind}': {
          get: {
            operationId: 'getItem',
            parameters: [
              {
                name: 'kind',
                in: 'path',
                required: true,
                schema: { type: 'string', enum: ['a', 'b'] },
              },
            ],
            responses: { '200': { description: 'OK' }, '404': { description: 'Not found' } },
          },
        },
      },
    }
    expect(makeTestFile(spec)).toBe(
      "import{describe,it,expect}from'bun:test'\nimport{faker}from'@faker-js/faker'\nimport{app}from'..'\n\ndescribe('Enum',()=>{describe('default',()=>{describe('GET /items/{kind}',()=>{it('should return 200',async()=>{const kind=faker.helpers.arrayElement([\"a\", \"b\"] as const)\nconst res=await app.handle(new Request(`http://localhost/items/${kind}`,{method:'GET'}))\nexpect(res.status).toBe(200)})})\n})\n})\n",
    )
  })

  it('escapes template-literal metacharacters in paths to block codegen injection', () => {
    const spec: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'X', version: '1.0.0' },
      paths: {
        '/a`b${c}': { get: { operationId: 'g', responses: { '200': { description: 'ok' } } } },
      },
    }
    expect(makeTestFile(spec)).toBe(
      "import{describe,it,expect}from'bun:test'\nimport{app}from'..'\n\ndescribe('X',()=>{describe('default',()=>{describe('GET /a`b${c}',()=>{it('should return 200',async()=>{\nconst res=await app.handle(new Request(`http://localhost/a\\`b\\${c}`,{method:'GET'}))\nexpect(res.status).toBe(200)})})\n})\n})\n",
    )
  })
})

describe('makeColocatedTestEntries', () => {
  it('emits one file per resource importing the shared app (../../index, no barrel)', () => {
    expect(makeColocatedTestEntries(twoResourceSpec)).toStrictEqual([
      {
        name: 'users',
        code: "import{describe,it,expect}from'bun:test'\nimport{app}from'../../index'\n\ndescribe('Two',()=>{describe('users',()=>{describe('GET /users',()=>{it('should return 200',async()=>{\nconst res=await app.handle(new Request(`http://localhost/users`,{method:'GET'}))\nexpect(res.status).toBe(200)})})\n})\n})\n",
      },
      {
        name: 'posts',
        code: "import{describe,it,expect}from'bun:test'\nimport{app}from'../../index'\n\ndescribe('Two',()=>{describe('posts',()=>{describe('GET /posts',()=>{it('should return 200',async()=>{\nconst res=await app.handle(new Request(`http://localhost/posts`,{method:'GET'}))\nexpect(res.status).toBe(200)})})\n})\n})\n",
      },
    ])
  })

  it('uses the given app import specifier (e.g. a pathAlias)', () => {
    expect(makeColocatedTestEntries(twoResourceSpec, '@/index')).toStrictEqual([
      {
        name: 'users',
        code: "import{describe,it,expect}from'bun:test'\nimport{app}from'@/index'\n\ndescribe('Two',()=>{describe('users',()=>{describe('GET /users',()=>{it('should return 200',async()=>{\nconst res=await app.handle(new Request(`http://localhost/users`,{method:'GET'}))\nexpect(res.status).toBe(200)})})\n})\n})\n",
      },
      {
        name: 'posts',
        code: "import{describe,it,expect}from'bun:test'\nimport{app}from'@/index'\n\ndescribe('Two',()=>{describe('posts',()=>{describe('GET /posts',()=>{it('should return 200',async()=>{\nconst res=await app.handle(new Request(`http://localhost/posts`,{method:'GET'}))\nexpect(res.status).toBe(200)})})\n})\n})\n",
      },
    ])
  })
})
