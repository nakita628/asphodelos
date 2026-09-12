import { describe, expect, it } from 'bun:test'

import type { OpenAPI, Operation } from '../openapi/index.js'
import {
  HTTP_METHODS,
  makeOperationId,
  makeRoute,
  operationsByResource,
  resolveOperationId,
  resourceName,
} from './openapi.js'

describe('resolveOperationId', () => {
  it('uses a non-empty string operationId verbatim', () => {
    expect(resolveOperationId({ operationId: 'getThing' }, 'get', '/things')).toBe('getThing')
  })

  it('synthesizes an id when operationId is absent', () => {
    expect(resolveOperationId({}, 'get', '/things')).toBe('getThings')
  })

  it('synthesizes an id when a YAML keyword parsed operationId to a non-string', () => {
    expect(resolveOperationId({ operationId: true }, 'get', '/things')).toBe('getThings')
    expect(resolveOperationId({ operationId: 0 }, 'post', '/things')).toBe('postThings')
  })

  it('synthesizes an id when operationId is an empty string', () => {
    expect(resolveOperationId({ operationId: '' }, 'get', '/things')).toBe('getThings')
  })
})

describe('makeOperationId', () => {
  it('joins method + camelCased path segments', () => {
    expect(makeOperationId('get', '/pet/findByStatus')).toBe('getPetFindByStatus')
  })

  it('encodes path parameters as `By-<name>`', () => {
    expect(makeOperationId('get', '/pet/{petId}')).toBe('getPetByPetId')
  })

  it('handles multiple path parameters', () => {
    expect(makeOperationId('get', '/store/{storeId}/order/{orderId}')).toBe(
      'getStoreByStoreIdOrderByOrderId',
    )
  })

  it('handles a root path with no segments → bare method', () => {
    expect(makeOperationId('get', '/')).toBe('get')
  })

  it('handles consecutive slashes by skipping empty segments', () => {
    expect(makeOperationId('get', '/pet//findByStatus')).toBe('getPetFindByStatus')
  })

  it('preserves method case (lowercase by convention but pass-through)', () => {
    expect(makeOperationId('post', '/pet')).toBe('postPet')
    expect(makeOperationId('delete', '/pet/{petId}')).toBe('deletePetByPetId')
  })

  it('camel-cases hyphenated segments', () => {
    expect(makeOperationId('get', '/api-v1/health-check')).toBe('getApiV1HealthCheck')
  })

  it('idempotent on already-camelCased segments', () => {
    expect(makeOperationId('get', '/findPetsByStatus')).toBe('getFindPetsByStatus')
  })
})

describe('resourceName', () => {
  it('uses the first meaningful segment for a flat collection', () => {
    expect(resourceName('/users')).toBe('users')
  })

  it('keeps the parent resource for an item path', () => {
    expect(resourceName('/users/{id}')).toBe('users')
  })

  it('groups nested sub-resources under the parent', () => {
    expect(resourceName('/users/{id}/orders')).toBe('users')
  })

  it('uses the OpenAPI path verbatim, including api and version prefixes', () => {
    expect(resourceName('/api/v1/users')).toBe('api')
    expect(resourceName('/v1/orders')).toBe('v1')
  })

  it('camelCases multi-word segments via tagName', () => {
    expect(resourceName('/user-profiles')).toBe('userProfiles')
    expect(resourceName('/user_sessions/{id}')).toBe('userSessions')
  })

  it('does not normalize singular vs plural', () => {
    expect(resourceName('/user')).toBe('user')
    expect(resourceName('/users')).toBe('users')
  })

  it('falls back to root for empty or parameter-only paths', () => {
    expect(resourceName('/')).toBe('root')
    expect(resourceName('')).toBe('root')
    expect(resourceName('/{id}')).toBe('root')
  })

  it('handles action-style endpoints as their own resources', () => {
    expect(resourceName('/login')).toBe('login')
    expect(resourceName('/healthz')).toBe('healthz')
  })
})

describe('operationsByResource', () => {
  it('groups tagless operations by REST resource derived from path', () => {
    const api = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/users': { get: { responses: { '200': { description: 'ok' } } } },
        '/users/{id}': { get: { responses: { '200': { description: 'ok' } } } },
        '/orders': { get: { responses: { '200': { description: 'ok' } } } },
      },
    } as OpenAPI
    const result = operationsByResource(api)
    expect([...result.keys()]).toStrictEqual(['users', 'orders'])
    expect(result.get('users')?.length).toBe(2)
    expect(result.get('orders')?.length).toBe(1)
  })

  it('keeps nested sub-resources under the parent (URL hierarchy root)', () => {
    const api = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/users/{id}/orders': { get: { responses: { '200': { description: 'ok' } } } },
        '/users/{id}/posts': { get: { responses: { '200': { description: 'ok' } } } },
      },
    } as OpenAPI
    const result = operationsByResource(api)
    expect([...result.keys()]).toStrictEqual(['users'])
    expect(result.get('users')?.length).toBe(2)
  })

  it('uses the OpenAPI path verbatim, including api and version prefixes', () => {
    const api = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/api/v1/users': { get: { responses: { '200': { description: 'ok' } } } },
        '/api/v2/users/{id}': { get: { responses: { '200': { description: 'ok' } } } },
        '/v1/orders': { post: { responses: { '201': { description: 'created' } } } },
      },
    } as OpenAPI
    const result = operationsByResource(api)
    expect([...result.keys()].toSorted()).toStrictEqual(['api', 'v1'])
    expect(result.get('api')?.length).toBe(2)
    expect(result.get('v1')?.length).toBe(1)
  })

  it('preserves OpenAPI tags on routes without using them for grouping', () => {
    const api = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/users': {
          get: { tags: ['Auth', 'Public'], responses: { '200': { description: 'ok' } } },
        },
        '/orders': { get: { tags: ['Auth'], responses: { '200': { description: 'ok' } } } },
      },
    } as OpenAPI
    const result = operationsByResource(api)
    expect([...result.keys()].toSorted()).toStrictEqual(['orders', 'users'])
    expect(result.get('users')?.[0]?.route.tags).toStrictEqual(['Auth', 'Public'])
    expect(result.get('orders')?.[0]?.route.tags).toStrictEqual(['Auth'])
  })

  it('emits empty tags array when the operation declares none', () => {
    const api = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/users': { get: { responses: { '200': { description: 'ok' } } } },
      },
    } as OpenAPI
    const result = operationsByResource(api)
    expect(result.get('users')?.[0]?.route.tags).toStrictEqual([])
  })

  it('falls back to root for parameter-only paths', () => {
    const api = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/{id}': { get: { responses: { '200': { description: 'ok' } } } },
      },
    } as OpenAPI
    const result = operationsByResource(api)
    expect([...result.keys()]).toStrictEqual(['root'])
  })
})

describe('makeRoute', () => {
  it('preserves the method literal for every HTTP_METHODS entry', () => {
    const minimal: Operation = { responses: {} }
    for (const method of HTTP_METHODS) {
      expect(makeRoute(method, '/x', minimal).route.method).toBe(method)
    }
  })

  it('synthesizes inline schema names as <operationId><Kind>', () => {
    const operation: Operation = {
      operationId: 'getThing',
      parameters: [
        { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'q', in: 'query', schema: { type: 'string' } },
        { name: 'X-Token', in: 'header', schema: { type: 'string' } },
        { name: 'sid', in: 'cookie', schema: { type: 'string' } },
      ],
      requestBody: {
        content: { 'application/json': { schema: { type: 'object' } } },
      },
      responses: {
        '200': {
          description: 'ok',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    }
    const { route, inlineSchemas } = makeRoute('post', '/things', operation)
    expect(route.paramsRef).toBe('getThingParams')
    expect(route.queryRef).toBe('getThingQuery')
    expect(route.headersRef).toBe('getThingHeaders')
    expect(route.cookieRef).toBe('getThingCookie')
    expect(route.bodyRef).toBe('getThingBody')
    expect(inlineSchemas.map((s) => s.name)).toStrictEqual([
      'getThingParams',
      'getThingQuery',
      'getThingHeaders',
      'getThingCookie',
      'getThingBody',
      'getThingResponse200',
    ])
  })

  it('sanitizes a hyphenated operationId for synth identifiers while keeping route.operationId verbatim', () => {
    const operation: Operation = {
      operationId: 'get-current-users-profile',
      parameters: [{ name: 'q', in: 'query', schema: { type: 'string' } }],
      responses: {
        '401': {
          description: 'no',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    }
    const { route, inlineSchemas } = makeRoute('get', '/me', operation)
    expect(route.operationId).toBe('get-current-users-profile')
    expect(route.queryRef).toBe('getCurrentUsersProfileQuery')
    expect(inlineSchemas.map((s) => s.name)).toStrictEqual([
      'getCurrentUsersProfileQuery',
      'getCurrentUsersProfileResponse401',
    ])
  })

  it('orders inlineSchemas as params → query → headers → cookie → body → responses', () => {
    const operation: Operation = {
      operationId: 'op',
      parameters: [
        { name: 'p', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'q', in: 'query', schema: { type: 'string' } },
      ],
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      responses: {
        '200': {
          description: 'ok',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
      },
    }
    const { inlineSchemas } = makeRoute('post', '/op', operation)
    expect(inlineSchemas.map((s) => s.name)).toStrictEqual([
      'opParams',
      'opQuery',
      'opBody',
      'opResponse200',
    ])
  })

  it('produces ref / inline (synthesized to ref) / void schema kinds for responses', () => {
    const operation: Operation = {
      operationId: 'op',
      responses: {
        '200': {
          description: 'ok',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        },
        '201': {
          description: 'Created',
          content: { 'application/json': { schema: { type: 'object' } } },
        },
        '204': { description: 'No Content' },
      },
    }
    const { route } = makeRoute('get', '/x', operation)
    expect(route.responses).toStrictEqual([
      { status: '200', schema: { kind: 'ref', name: 'Pet' } },
      { status: '201', schema: { kind: 'ref', name: 'opResponse201' } },
      { status: '204', schema: { kind: 'void' } },
    ])
  })

  it('prefers bodyRef from $ref over inline body synthesis', () => {
    const withRef: Operation = {
      operationId: 'op',
      requestBody: {
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
      },
      responses: {},
    }
    expect(makeRoute('post', '/x', withRef).route.bodyRef).toBe('Pet')

    const withInline: Operation = {
      operationId: 'op',
      requestBody: { content: { 'application/json': { schema: { type: 'object' } } } },
      responses: {},
    }
    expect(makeRoute('post', '/x', withInline).route.bodyRef).toBe('opBody')

    const withoutBody: Operation = { operationId: 'op', responses: {} }
    expect(makeRoute('post', '/x', withoutBody).route.bodyRef).toBeUndefined()
  })
})
