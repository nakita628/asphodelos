import { describe, expect, it } from 'bun:test'

import type { OpenAPI } from '../../openapi/index.js'
import { makeAppType, schemaToTs } from './index.js'

const VALIDATION_ENVELOPE = `{ type: "validation"; on: string; summary?: string; message?: string; found?: unknown; property?: string; expected?: string }`

describe('schemaToTs', () => {
  it('emits string for type: string', () => {
    expect(schemaToTs({ type: 'string' })).toBe('string')
  })

  it('collapses integer to TS number', () => {
    expect(schemaToTs({ type: 'integer' })).toBe('number')
  })

  it('emits number for type: number', () => {
    expect(schemaToTs({ type: 'number' })).toBe('number')
  })

  it('emits boolean for type: boolean', () => {
    expect(schemaToTs({ type: 'boolean' })).toBe('boolean')
  })

  it('emits null for type: null', () => {
    expect(schemaToTs({ type: 'null' })).toBe('null')
  })

  it('returns unknown for an undefined schema', () => {
    expect(schemaToTs(undefined)).toBe('unknown')
  })

  it('wraps OpenAPI 3.0 nullable: true with (T | null)', () => {
    expect(schemaToTs({ type: 'string', nullable: true })).toBe('(string | null)')
  })

  it('wraps OpenAPI 3.1 type: ["X","null"] with (T | null)', () => {
    expect(schemaToTs({ type: ['integer', 'null'] })).toBe('(number | null)')
  })

  it('emits a string-literal union for enum members', () => {
    expect(schemaToTs({ type: 'string', enum: ['a', 'b', 'c'] })).toBe('"a" | "b" | "c"')
  })

  it('emits a single literal type for const', () => {
    expect(schemaToTs({ const: 'fixed' })).toBe('"fixed"')
  })

  it('emits required vs optional object properties', () => {
    expect(
      schemaToTs({
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'number' } },
        required: ['a'],
      }),
    ).toBe('{ "a": string; "b"?: number }')
  })

  it('emits Record<string, T> for additionalProperties: <Schema> with no fixed properties', () => {
    expect(schemaToTs({ type: 'object', additionalProperties: { type: 'string' } })).toBe(
      'Record<string, string>',
    )
  })

  it('intersects fixed properties with Record when additionalProperties: <Schema> coexists', () => {
    expect(
      schemaToTs({
        type: 'object',
        properties: { id: { type: 'string' } },
        required: ['id'],
        additionalProperties: { type: 'number' },
      }),
    ).toBe('{ "id": string } & Record<string, number>')
  })

  it('emits Record<string, unknown> for additionalProperties: true', () => {
    expect(schemaToTs({ type: 'object', additionalProperties: true })).toBe(
      'Record<string, unknown>',
    )
  })

  it('emits {} for an empty object schema', () => {
    expect(schemaToTs({ type: 'object' })).toBe('{}')
  })

  it('emits T[] for type: array with items', () => {
    expect(schemaToTs({ type: 'array', items: { type: 'string' } })).toBe('string[]')
  })

  it('emits a tuple type when prefixItems is present', () => {
    expect(
      schemaToTs({
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'number' }],
      } as unknown as Parameters<typeof schemaToTs>[0]),
    ).toBe('[string, number]')
  })

  it('emits a union for oneOf', () => {
    expect(schemaToTs({ oneOf: [{ type: 'string' }, { type: 'number' }] })).toBe('string | number')
  })

  it('emits an intersection for allOf', () => {
    expect(
      schemaToTs({
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'number' } }, required: ['b'] },
        ],
      }),
    ).toBe('{ "a": string } & { "b": number }')
  })

  it('emits a primitive union for type: ["string", "number"]', () => {
    expect(schemaToTs({ type: ['string', 'number'] })).toBe('string | number')
  })

  it('combines mixed-type array with null into ((T | U) | null)', () => {
    expect(schemaToTs({ type: ['string', 'number', 'null'] })).toBe('(string | number | null)')
  })

  it('emits the bare component name for $ref', () => {
    expect(schemaToTs({ $ref: '#/components/schemas/Other' })).toBe('Other')
  })

  it('sanitises hyphenated component names through pascalCase', () => {
    expect(schemaToTs({ $ref: '#/components/schemas/My-Schema' })).toBe('MySchema')
  })
})

describe('makeAppType — component aliases', () => {
  it('sanitises component names with hyphens in alias declarations', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/r': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/User' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          'My-Schema': { type: 'string' },
          User: { $ref: '#/components/schemas/My-Schema' },
        },
      },
    }
    const { refAliases } = makeAppType(openAPI)
    expect(refAliases).toStrictEqual(['type User = MySchema', 'type MySchema = string'])
  })

  it('drops orphan schemas that no route reaches', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
      components: {
        schemas: {
          Orphan: { type: 'string' },
          AlsoOrphan: { type: 'number' },
        },
      },
    }
    const { refAliases } = makeAppType(openAPI)
    expect(refAliases).toStrictEqual([])
  })

  it('keeps schemas that are reachable transitively through other refs', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/r': {
          get: {
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            properties: { category: { $ref: '#/components/schemas/Category' } },
          },
          Category: {
            type: 'object',
            properties: { name: { type: 'string' } },
          },
          Unused: { type: 'boolean' },
        },
      },
    }
    const { refAliases } = makeAppType(openAPI)
    expect(refAliases).toStrictEqual([
      'type Pet = { "category"?: Category }',
      'type Category = { "name"?: string }',
    ])
  })

  it('keeps schemas referenced from request body content', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/r': {
          post: {
            requestBody: {
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Body' } },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
      components: {
        schemas: { Body: { type: 'object', properties: { name: { type: 'string' } } } },
      },
    }
    const { refAliases } = makeAppType(openAPI)
    expect(refAliases).toStrictEqual(['type Body = { "name"?: string }'])
  })

  it('keeps schemas referenced through a $ref-based response (#/components/responses/...)', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/r': {
          get: {
            responses: {
              '200': { $ref: '#/components/responses/OrderList' },
            },
          },
        },
      },
      components: {
        responses: {
          OrderList: {
            description: 'List',
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Order' } },
            },
          },
        },
        schemas: { Order: { type: 'object', properties: { id: { type: 'string' } } } },
      },
    }
    const { refAliases } = makeAppType(openAPI)
    expect(refAliases).toStrictEqual(['type Order = { "id"?: string }'])
  })

  it('keeps schemas referenced through a $ref-based requestBody (#/components/requestBodies/...)', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/r': {
          post: {
            requestBody: { $ref: '#/components/requestBodies/CreatePet' },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
      components: {
        requestBodies: {
          CreatePet: {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
            },
          },
        },
        schemas: { Pet: { type: 'object', properties: { name: { type: 'string' } } } },
      },
    }
    const { refAliases } = makeAppType(openAPI)
    expect(refAliases).toStrictEqual(['type Pet = { "name"?: string }'])
  })

  it('keeps schemas referenced from a $ref-based parameter', () => {
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/r': {
          get: {
            parameters: [{ $ref: '#/components/parameters/PageParam' }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
      components: {
        parameters: {
          PageParam: { name: 'page', in: 'query', schema: { $ref: '#/components/schemas/PageId' } },
        },
        schemas: { PageId: { type: 'integer' } },
      },
    } as unknown as OpenAPI
    const { refAliases } = makeAppType(openAPI)
    expect(refAliases).toStrictEqual(['type PageId = number'])
  })
})

describe('makeAppType (full Elysia<...> shape)', () => {
  it('emits an empty routes object for a spec with no paths', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
    }
    const { appType, refAliases } = makeAppType(openAPI)
    expect(refAliases).toStrictEqual([])
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, {}, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('builds a one-route Elysia<...> for GET /items', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            responses: {
              '200': {
                description: 'OK',
                content: {
                  'application/json': { schema: { type: 'array', items: { type: 'string' } } },
                },
              },
            },
          },
        },
      },
    }
    const { appType } = makeAppType(openAPI)
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, { "items": { get: { body: unknown; params: {}; query: unknown; headers: unknown; response: { 200: string[]; 422: ${VALIDATION_ENVELOPE} } } } }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('converts {id} path templating to :id and unwraps required path params', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          get: {
            operationId: 'getItem',
            parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    }
    const { appType } = makeAppType(openAPI)
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, { "items": { ":id": { get: { body: unknown; params: { "id": string }; query: unknown; headers: unknown; response: { 200: string; 422: ${VALIDATION_ENVELOPE} } } } } }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('marks non-required query parameters as optional', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            parameters: [{ name: 'page', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const { appType } = makeAppType(openAPI)
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, { "items": { get: { body: unknown; params: {}; query: { "page"?: number }; headers: unknown; response: { 200: unknown; 422: ${VALIDATION_ENVELOPE} } } } }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('prepends prefix segments to every route key', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/pet': {
          get: {
            operationId: 'getPet',
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const { appType } = makeAppType(openAPI, '/api/v3')
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, { "api": { "v3": { "pet": { get: { body: unknown; params: {}; query: unknown; headers: unknown; response: { 200: unknown; 422: ${VALIDATION_ENVELOPE} } } } } } }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('treats prefix "/" as no prefix', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/pet': {
          get: { operationId: 'getPet', responses: { '200': { description: 'OK' } } },
        },
      },
    }
    const { appType } = makeAppType(openAPI, '/')
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, { "pet": { get: { body: unknown; params: {}; query: unknown; headers: unknown; response: { 200: unknown; 422: ${VALIDATION_ENVELOPE} } } } }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('does not duplicate the 422 envelope when the spec declares its own 422', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            responses: {
              '200': { description: 'OK' },
              '422': {
                description: 'Custom',
                content: { 'application/json': { schema: { type: 'string' } } },
              },
            },
          },
        },
      },
    }
    const { appType } = makeAppType(openAPI)
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, { "items": { get: { body: unknown; params: {}; query: unknown; headers: unknown; response: { 200: unknown; 422: string } } } }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('resolves $ref-based parameters through components.parameters', () => {
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            parameters: [{ $ref: '#/components/parameters/PageParam' }],
            responses: { '200': { description: 'OK' } },
          },
        },
      },
      components: {
        parameters: {
          PageParam: { name: 'page', in: 'query', schema: { type: 'integer' } },
        },
      },
    } as unknown as OpenAPI
    const { appType } = makeAppType(openAPI)
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, { "items": { get: { body: unknown; params: {}; query: { "page"?: number }; headers: unknown; response: { 200: unknown; 422: ${VALIDATION_ENVELOPE} } } } }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('prefers application/json over other content types', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          post: {
            operationId: 'create',
            requestBody: {
              content: {
                'application/xml': { schema: { type: 'string' } },
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: { name: { type: 'string' } },
                    required: ['name'],
                  },
                },
              },
            },
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    }
    const { appType } = makeAppType(openAPI)
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, { "items": { post: { body: { "name": string }; params: {}; query: unknown; headers: unknown; response: { 201: unknown; 422: ${VALIDATION_ENVELOPE} } } } }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('falls back to multipart/form-data when application/json is absent', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/upload': {
          post: {
            operationId: 'upload',
            requestBody: {
              content: {
                'multipart/form-data': {
                  schema: {
                    type: 'object',
                    properties: { file: { type: 'string', format: 'binary' } },
                    required: ['file'],
                  },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const { appType } = makeAppType(openAPI)
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, { "upload": { post: { body: { "file": string }; params: {}; query: unknown; headers: unknown; response: { 200: unknown; 422: ${VALIDATION_ENVELOPE} } } } }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('maps application/octet-stream + format: binary to Blob | File | ArrayBuffer', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/upload': {
          post: {
            operationId: 'upload',
            requestBody: {
              content: {
                'application/octet-stream': {
                  schema: { type: 'string', format: 'binary' },
                },
              },
            },
            responses: { '200': { description: 'OK' } },
          },
        },
      },
    }
    const { appType } = makeAppType(openAPI)
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, { "upload": { post: { body: Blob | File | ArrayBuffer; params: {}; query: unknown; headers: unknown; response: { 200: unknown; 422: ${VALIDATION_ENVELOPE} } } } }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('drops the OpenAPI default response bucket', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            responses: {
              '200': { description: 'OK' },
              default: { description: 'Unexpected' },
            },
          },
        },
      },
    }
    const { appType } = makeAppType(openAPI)
    expect(appType).toBe(
      `export type App = Elysia<"", { decorator: {}; store: {}; derive: {}; resolve: {} }, { typebox: {}; error: {} }, { schema: {}; standaloneSchema: {}; macro: {}; macroFn: {}; parser: {}; response: {} }, { "items": { get: { body: unknown; params: {}; query: unknown; headers: unknown; response: { 200: unknown; 422: ${VALIDATION_ENVELOPE} } } } }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }, { derive: {}; resolve: {}; schema: {}; standaloneSchema: {}; response: {} }>`,
    )
  })

  it('intersects multiple operations into one routes generic', () => {
    const openAPI: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/a': {
          get: {
            operationId: 'a',
            responses: { '200': { description: 'OK' } },
          },
          post: {
            operationId: 'aCreate',
            responses: { '201': { description: 'Created' } },
          },
        },
      },
    }
    const { routes } = makeAppType(openAPI)
    expect(routes.length).toBe(2)
    expect(routes[0]).toBe(
      `{ "a": { get: { body: unknown; params: {}; query: unknown; headers: unknown; response: { 200: unknown; 422: ${VALIDATION_ENVELOPE} } } } }`,
    )
    expect(routes[1]).toBe(
      `{ "a": { post: { body: unknown; params: {}; query: unknown; headers: unknown; response: { 201: unknown; 422: ${VALIDATION_ENVELOPE} } } } }`,
    )
  })
})
