import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Components } from '../../openapi/index.js'
import { runGenerator } from '../../testing/index.js'
import { components } from './output.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('components — no-op paths', () => {
  it('returns success when components is undefined', async () => {
    const result = await runGenerator(components(undefined, '/ignored.ts'))
    expect(result).toStrictEqual('No components found')
  })

  it('returns success when every component section is empty', async () => {
    const result = await runGenerator(components({ schemas: {}, responses: {} }, '/ignored.ts'))
    expect(result).toStrictEqual('No components found')
  })
})

describe('components — single-file aggregate', () => {
  it('emits all 11 component kinds into one file with a single elysia import', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-components-'))
    const output = path.join(tmpDir, 'components.ts')
    const sample: Components = {
      schemas: {
        Item: {
          type: 'object',
          required: ['id', 'name'],
          properties: { id: { type: 'string' }, name: { type: 'string' } },
        },
        Error: {
          type: 'object',
          required: ['code', 'message'],
          properties: { code: { type: 'string' }, message: { type: 'string' } },
        },
      },
      responses: {
        ItemList: {
          description: 'list',
          content: {
            'application/json': {
              schema: { type: 'array', items: { $ref: '#/components/schemas/Item' } },
            },
          },
        },
        ItemSingle: {
          description: 'single',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
        },
      },
      parameters: {
        PageSize: {
          name: 'pageSize',
          in: 'query',
          schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        },
      },
      examples: { ItemSample: { summary: 'a sample item', value: { id: 'abc', name: 'sample' } } },
      requestBodies: {
        ItemBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: { name: { type: 'string' } },
              },
            },
          },
        },
      },
      headers: {
        RateLimitRemaining: {
          description: 'remaining requests',
          schema: { type: 'integer', minimum: 0 },
        },
      },
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      },
      links: {
        GetItemById: {
          operationId: 'listItems',
          parameters: { id: '$response.body#/id' },
          description: 'Look up item by id from a list response',
        },
      },
      callbacks: {
        ItemCreated: {
          '{$request.body#/callbackUrl}': {
            post: {
              requestBody: {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
              },
              responses: { '200': { description: 'ack' } },
            },
          },
        },
      },
      pathItems: {
        UserCollection: {
          get: { operationId: 'listUsers', responses: { '200': { description: 'ok' } } },
        },
      },
      mediaTypes: { JsonItem: { schema: { $ref: '#/components/schemas/Item' } } },
    }
    const result = await runGenerator(components(sample, output, false))
    expect(result).toStrictEqual(`Generated components code written to ${output}`)
    expect(fs.readFileSync(output, 'utf-8')).toBe(`import { t } from 'elysia'

export const ItemSchema = t.Object({ id: t.String(), name: t.String() })

export const ErrorSchema = t.Object({ code: t.String(), message: t.String() })

export const ItemListResponseSchema = t.Array(ItemSchema)

export const ItemSingleResponseSchema = ItemSchema

export const PageSizeParamsSchema = t.Integer({ minimum: 1, maximum: 100, default: 20 })

export const ItemSampleExample = {
  summary: 'a sample item',
  value: { id: 'abc', name: 'sample' },
} as const

export const ItemBodyRequestBodySchema = t.Object({ name: t.String() })

export const RateLimitRemainingHeaderSchema = t.Integer({ minimum: 0, maximum: 9007199254740991 })

export const BearerAuthSecurityScheme = {
  type: 'http',
  scheme: 'bearer',
  bearerFormat: 'JWT',
} as const

export const ApiKeyAuthSecurityScheme = { type: 'apiKey', in: 'header', name: 'X-API-Key' } as const

export const GetItemByIdLink = {
  operationId: 'listItems',
  parameters: { id: '$response.body#/id' },
  description: 'Look up item by id from a list response',
} as const

export const ItemCreatedCallback = {
  '{$request.body#/callbackUrl}': {
    post: {
      requestBody: { content: { 'application/json': { schema: ItemSchema } } },
      responses: { '200': { description: 'ack' } },
    },
  },
} as const

export const UserCollectionPathItem = {
  get: { operationId: 'listUsers', responses: { '200': { description: 'ok' } } },
} as const

export const JsonItemMediaTypeSchema = ItemSchema
`)
  })

  it('propagates readonly: true to every typebox component kind', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-components-ro-'))
    const output = path.join(tmpDir, 'components.ts')
    const sample: Components = {
      schemas: { Item: { type: 'object', properties: { id: { type: 'string' } } } },
      responses: {
        Res: {
          description: 'r',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { ok: { type: 'boolean' } } },
            },
          },
        },
      },
      parameters: { Page: { name: 'page', in: 'query', schema: { type: 'integer' } } },
      requestBodies: {
        Body: {
          content: {
            'application/json': {
              schema: { type: 'object', properties: { name: { type: 'string' } } },
            },
          },
        },
      },
      headers: { H: { schema: { type: 'string' } } },
      mediaTypes: { Mt: { schema: { type: 'string' } } },
    }
    await runGenerator(components(sample, output, true))
    expect(fs.readFileSync(output, 'utf-8')).toBe(`import { t } from 'elysia'

export const ItemSchema = t.Readonly(t.Object({ id: t.Optional(t.String()) }))

export const ResResponseSchema = t.Readonly(t.Object({ ok: t.Optional(t.Boolean()) }))

export const PageParamsSchema = t.Readonly(t.Integer({ maximum: 9007199254740991 }))

export const BodyRequestBodySchema = t.Readonly(t.Object({ name: t.Optional(t.String()) }))

export const HHeaderSchema = t.Readonly(t.String())

export const MtMediaTypeSchema = t.Readonly(t.String())
`)
  })

  // Cross-component `$ref`s resolve in-file (no per-kind imports) since every
  // component is a locally-defined const — this is why `components` needs no
  // `excludeKinds`. Locks that `makeImports`' `definedConsts` coverage holds.
  it('resolves cross-component references within the file without emitting imports', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-components-xref-'))
    const output = path.join(tmpDir, 'components.ts')
    const sample: Components = {
      schemas: {
        User: { type: 'object', properties: { pet: { $ref: '#/components/schemas/Pet' } } },
        Pet: { type: 'object', properties: { name: { type: 'string' } } },
      },
      responses: {
        UserRes: {
          description: 'u',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/User' } } },
        },
      },
    }
    const result = await runGenerator(components(sample, output, false))
    expect(result).toStrictEqual(`Generated components code written to ${output}`)
    expect(fs.readFileSync(output, 'utf-8')).toBe(`import { t } from 'elysia'

export const PetSchema = t.Object({ name: t.Optional(t.String()) })

export const UserSchema = t.Object({ pet: t.Optional(PetSchema) })

export const UserResResponseSchema = UserSchema
`)
  })
})
