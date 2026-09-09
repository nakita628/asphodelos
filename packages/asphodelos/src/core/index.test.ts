import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Effect } from 'effect'

import type { OpenAPI } from '../openapi/index.js'
import { parseOpenAPI } from '../openapi/index.js'
import { runGenerator } from '../testing/index.js'
import {
  callbacks,
  components,
  elysia,
  examples,
  headers,
  links,
  mediaTypes,
  parameters,
  pathItems,
  requestBodies,
  responses,
  schemas,
  securitySchemes,
} from './index.js'

/**
 * Run the full pipeline (mirrors `cli/index.ts`'s default-mode behavior)
 * so tests can assert on the complete `src/` tree without re-implementing
 * the orchestration in every case. Each kind that the spec declares is
 * written to `src/components/<kind>.ts`. No top-level `components/index.ts`
 * is emitted; per-kind files are imported individually.
 */
const run = (api: OpenAPI, options: Parameters<typeof elysia>[1] = {}) =>
  runGenerator(
    Effect.gen(function* () {
      const isReadonly = options.readonly === true
      const c = api.components
      const ent = (k: string) => ({ output: `src/components/${k}.ts`, split: false })
      const ic = {
        schemas: ent('schemas'),
        responses: ent('responses'),
        parameters: ent('parameters'),
        examples: ent('examples'),
        requestBodies: ent('requestBodies'),
        headers: ent('headers'),
        securitySchemes: ent('securitySchemes'),
        links: ent('links'),
        callbacks: ent('callbacks'),
        pathItems: ent('pathItems'),
        mediaTypes: ent('mediaTypes'),
      }
      const NOOP = Effect.succeed(undefined)
      const results = yield* Effect.all(
        [
          elysia(api, { ...options, components: { ...ic, ...options.components } }),
          c?.schemas
            ? schemas(c.schemas, ic.schemas.output, ic.schemas.split, false, ic, isReadonly)
            : NOOP,
          c?.responses
            ? responses(c.responses, ic.responses.output, ic.responses.split, false, ic, isReadonly)
            : NOOP,
          c?.parameters
            ? parameters(
                c.parameters,
                ic.parameters.output,
                ic.parameters.split,
                false,
                ic,
                isReadonly,
              )
            : NOOP,
          c?.examples ? examples(c.examples, ic.examples.output, ic.examples.split, ic) : NOOP,
          c?.requestBodies
            ? requestBodies(
                c.requestBodies,
                ic.requestBodies.output,
                ic.requestBodies.split,
                false,
                ic,
                isReadonly,
              )
            : NOOP,
          c?.headers
            ? headers(c.headers, ic.headers.output, ic.headers.split, false, ic, isReadonly)
            : NOOP,
          c?.securitySchemes
            ? securitySchemes(
                c.securitySchemes,
                ic.securitySchemes.output,
                ic.securitySchemes.split,
                ic,
              )
            : NOOP,
          c?.links ? links(c.links, ic.links.output, ic.links.split, ic) : NOOP,
          c?.callbacks ? callbacks(c.callbacks, ic.callbacks.output, ic.callbacks.split, ic) : NOOP,
          c?.pathItems ? pathItems(c.pathItems, ic.pathItems.output, ic.pathItems.split, ic) : NOOP,
          c?.mediaTypes
            ? mediaTypes(
                c.mediaTypes,
                ic.mediaTypes.output,
                ic.mediaTypes.split,
                false,
                ic,
                isReadonly,
              )
            : NOOP,
        ],
        { concurrency: 'unbounded' },
      )
      return results[0]
    }),
  )

const TAGLESS_OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Tagless API', version: '0.0.1' },
  paths: {
    '/users': {
      get: { operationId: 'listUsers', responses: { '200': { description: 'ok' } } },
      post: { operationId: 'createUser', responses: { '201': { description: 'created' } } },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/users/{id}/orders': {
      get: {
        operationId: 'listUserOrders',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/orders': {
      get: { operationId: 'listOrders', responses: { '200': { description: 'ok' } } },
    },
    '/orders/{id}': {
      get: {
        operationId: 'getOrder',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/healthz': {
      get: { operationId: 'healthCheck', responses: { '200': { description: 'ok' } } },
    },
  },
} as const

const COMPONENTS_OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Components Fixture', version: '0.0.1' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [
          { $ref: '#/components/parameters/PageSize' },
          { $ref: '#/components/parameters/Page' },
        ],
        responses: {
          '200': { $ref: '#/components/responses/ItemList' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
      },
      post: {
        operationId: 'createItem',
        security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
        requestBody: { $ref: '#/components/requestBodies/ItemBody' },
        responses: { '201': { $ref: '#/components/responses/ItemSingle' } },
      },
    },
  },
  components: {
    schemas: {
      Item: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          price: { type: 'integer' },
        },
      },
      Error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
      },
    },
    parameters: {
      PageSize: {
        name: 'pageSize',
        in: 'query',
        schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      Page: {
        name: 'page',
        in: 'query',
        schema: { type: 'integer', minimum: 1, default: 1 },
      },
    },
    requestBodies: {
      ItemBody: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              required: ['name'],
              properties: {
                name: { type: 'string' },
                price: { type: 'integer' },
              },
            },
          },
        },
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
      NotFound: {
        description: 'not found',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
      },
    },
    headers: {
      RateLimitRemaining: {
        description: 'remaining requests',
        schema: { type: 'integer', minimum: 0 },
      },
    },
    securitySchemes: {
      apiKeyAuth: { type: 'apiKey', in: 'header', name: 'X-API-Key' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
      basicAuth: { type: 'http', scheme: 'basic' },
    },
  },
} as const

const ALL_COMPONENTS_OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'All Components Fixture', version: '0.0.1' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        parameters: [{ $ref: '#/components/parameters/PageSize' }],
        responses: {
          '200': { $ref: '#/components/responses/ItemList' },
        },
      },
      post: {
        operationId: 'createItem',
        security: [{ bearerAuth: [] }],
        requestBody: { $ref: '#/components/requestBodies/ItemBody' },
        responses: { '201': { $ref: '#/components/responses/ItemSingle' } },
        callbacks: {
          onCreated: { $ref: '#/components/callbacks/ItemCreated' },
        },
      },
    },
    '/users': { $ref: '#/components/pathItems/UserCollection' },
  },
  webhooks: {
    newPet: {
      post: {
        operationId: 'onNewPet',
        requestBody: {
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Item' } },
          },
        },
        responses: { '200': { description: 'ack' } },
      },
    },
  },
  components: {
    schemas: {
      Item: {
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
        },
      },
      Error: {
        type: 'object',
        required: ['code', 'message'],
        properties: {
          code: { type: 'string' },
          message: { type: 'string' },
        },
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
    examples: {
      ItemSample: {
        summary: 'a sample item',
        value: { id: 'abc', name: 'sample' },
      },
    },
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
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/Item' } },
              },
            },
            responses: { '200': { description: 'ack' } },
          },
        },
      },
    },
    pathItems: {
      UserCollection: {
        get: {
          operationId: 'listUsers',
          responses: { '200': { description: 'ok' } },
        },
      },
    },
    mediaTypes: {
      JsonItem: {
        schema: { $ref: '#/components/schemas/Item' },
      },
    },
  },
} as const

describe('elysia (tagless OpenAPI)', () => {
  const cwdBefore = process.cwd()
  const workdir = mkdtempSync(path.join(tmpdir(), 'asphodelos-tagless-'))
  const taglessPath = path.join(workdir, 'openapi.json')

  beforeAll(() => {
    process.chdir(workdir)
    writeFileSync(taglessPath, JSON.stringify(TAGLESS_OPENAPI))
  })

  afterAll(() => {
    process.chdir(cwdBefore)
    rmSync(workdir, { recursive: true, force: true })
  })

  it('groups operations by REST resource derived from path, not by tag', async () => {
    const parsed = await runGenerator(parseOpenAPI(taglessPath))

    const result = await run(parsed)

    expect(result).toBe('Generated 3 module(s) (users, orders, healthz) → src/')

    const moduleDirs = (await readdir(path.join(workdir, 'src', 'modules'))).toSorted()
    expect(moduleDirs).toStrictEqual(['healthz', 'orders', 'users'])

    const appSrc = await readFile(path.join(workdir, 'src', 'index.ts'), 'utf8')
    expect(appSrc).toBe(
      `import { Elysia } from 'elysia'
import { users } from './modules/users'
import { orders } from './modules/orders'
import { healthz } from './modules/healthz'

export const app = new Elysia().use(users).use(orders).use(healthz)

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`,
    )
  })

  it('default mode: each kind lands in its own src/components/<kind>.ts (no top-level index.ts)', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-perkind-'))
    process.chdir(dir)
    try {
      const apiPath = path.join(dir, 'openapi.json')
      writeFileSync(apiPath, JSON.stringify(COMPONENTS_OPENAPI))
      const parsed = await runGenerator(parseOpenAPI(apiPath))
      await run(parsed)

      const componentsDir = path.join(dir, 'src', 'components')
      const entries = new Set((await readdir(componentsDir)).toSorted())
      expect(entries.has('index.ts')).toBe(false)
      expect(entries.has('schemas.ts')).toBe(true)
      expect(entries.has('responses.ts')).toBe(true)

      const schemasSrc = await readFile(path.join(componentsDir, 'schemas.ts'), 'utf8')
      expect(schemasSrc.includes('export const ItemSchema')).toBe(true)
      expect(schemasSrc.includes('export const ErrorSchema')).toBe(true)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('cross-kind references emit explicit imports in per-kind files', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-cross-'))
    process.chdir(dir)
    try {
      const apiPath = path.join(dir, 'openapi.json')
      writeFileSync(apiPath, JSON.stringify(COMPONENTS_OPENAPI))
      const parsed = await runGenerator(parseOpenAPI(apiPath))
      await run(parsed)

      const responsesSrc = await readFile(
        path.join(dir, 'src', 'components', 'responses.ts'),
        'utf8',
      )
      expect(responsesSrc.includes('ItemListResponseSchema')).toBe(true)
      expect(/from\s+['"]\.\/schemas['"]/.test(responsesSrc)).toBe(true)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('modules register schemas with ORIGINAL spec names; app does NOT (registrations propagate via .use)', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-modreg-'))
    process.chdir(dir)
    try {
      const apiPath = path.join(dir, 'openapi.json')
      writeFileSync(apiPath, JSON.stringify(COMPONENTS_OPENAPI))
      const parsed = await runGenerator(parseOpenAPI(apiPath))
      await run(parsed)

      const appSrc = await readFile(path.join(dir, 'src', 'index.ts'), 'utf8')
      expect(appSrc.includes('ItemSchema')).toBe(false)
      expect(appSrc.includes('.model(')).toBe(false)

      const ctrl = await readFile(path.join(dir, 'src', 'modules', 'items', 'index.ts'), 'utf8')
      expect(ctrl.includes('Item: ItemSchema')).toBe(true)
      expect(ctrl.includes('Error: ErrorSchema')).toBe(true)
      expect(ctrl.includes("from '../../components/schemas'")).toBe(true)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('inlines schemas directly inside the Model object literal (no separate consts)', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-model-'))
    process.chdir(dir)
    try {
      const apiPath = path.join(dir, 'openapi.json')
      writeFileSync(apiPath, JSON.stringify(COMPONENTS_OPENAPI))
      const parsed = await runGenerator(parseOpenAPI(apiPath))
      await run(parsed)

      const modelSrc = await readFile(path.join(dir, 'src', 'modules', 'items', 'model.ts'), 'utf8')
      expect(modelSrc).toBe(
        `import { t, type UnwrapSchema } from 'elysia'
import { ItemSchema } from '../../components/schemas'

export const ItemsModel = {
  listItemsQuery: t.Object({
    pageSize: t.Optional(t.Integer({ minimum: 1, maximum: 100, default: 20 })),
    page: t.Optional(t.Integer({ minimum: 1, maximum: 9007199254740991, default: 1 })),
  }),
  listItemsResponse200: t.Array(ItemSchema),
  createItemBody: t.Object({
    name: t.String(),
    price: t.Optional(t.Integer({ maximum: 9007199254740991 })),
  }),
} as const

export type ItemsModel = { [k in keyof typeof ItemsModel]: UnwrapSchema<(typeof ItemsModel)[k]> }
`,
      )
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('does NOT wire the openapi plugin in the generated app (user adds it manually)', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-no-openapi-'))
    process.chdir(dir)
    try {
      const apiPath = path.join(dir, 'openapi.json')
      writeFileSync(apiPath, JSON.stringify(COMPONENTS_OPENAPI))
      const parsed = await runGenerator(parseOpenAPI(apiPath))
      await run(parsed)

      const appSrc = await readFile(path.join(dir, 'src', 'index.ts'), 'utf8')
      expect(appSrc.includes('@elysiajs/openapi')).toBe(false)
      expect(appSrc.includes('openapi(')).toBe(false)
      expect(appSrc.includes('documentation:')).toBe(false)
      expect(appSrc.includes('securitySchemes:')).toBe(false)
      expect(appSrc.includes('apiKeyAuth')).toBe(false)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('emits a controller with empty tags metadata when the operation has none', async () => {
    const parsed = await runGenerator(parseOpenAPI(taglessPath))

    await run(parsed)

    const usersController = await readFile(
      path.join(workdir, 'src', 'modules', 'users', 'index.ts'),
      'utf8',
    )
    expect(usersController.includes('tags: []')).toBe(true)
    expect(usersController.includes("'default'")).toBe(false)
  })

  it('readonly: true wraps every top-level export in t.Readonly(...)', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-ro-'))
    process.chdir(dir)
    try {
      const apiPath = path.join(dir, 'openapi.json')
      writeFileSync(apiPath, JSON.stringify(COMPONENTS_OPENAPI))
      const parsed = await runGenerator(parseOpenAPI(apiPath))
      await run(parsed, { readonly: true })

      const schemasSrc = await readFile(path.join(dir, 'src', 'components', 'schemas.ts'), 'utf8')
      const responsesSrc = await readFile(
        path.join(dir, 'src', 'components', 'responses.ts'),
        'utf8',
      )
      expect(/export const ItemSchema\s*=\s*t\.Readonly\(/.test(schemasSrc)).toBe(true)
      expect(/export const ErrorSchema\s*=\s*t\.Readonly\(/.test(schemasSrc)).toBe(true)
      expect(/ItemListResponseSchema\s*=\s*t\.Readonly\(/.test(responsesSrc)).toBe(true)

      const modelSrc = await readFile(path.join(dir, 'src', 'modules', 'items', 'model.ts'), 'utf8')
      expect(modelSrc.includes('t.Readonly(')).toBe(true)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('split mode: each schema entry becomes its own .ts file + index.ts barrel', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-split-'))
    process.chdir(dir)
    try {
      const apiPath = path.join(dir, 'openapi.json')
      writeFileSync(apiPath, JSON.stringify(COMPONENTS_OPENAPI))
      const parsed = await runGenerator(parseOpenAPI(apiPath))
      const { schemas: schemasComponent } = await import('./index.js')
      await runGenerator(
        schemasComponent(parsed.components?.schemas, 'src/lib/schemas', true, false),
      )

      const splitDir = path.join(dir, 'src', 'lib', 'schemas')
      const entries = (await readdir(splitDir)).toSorted()
      expect(entries).toStrictEqual(['error.ts', 'index.ts', 'item.ts'])

      const itemSrc = await readFile(path.join(splitDir, 'item.ts'), 'utf8')
      expect(itemSrc.includes('export const ItemSchema')).toBe(true)

      const barrel = await readFile(path.join(splitDir, 'index.ts'), 'utf8')
      expect(barrel).toBe(`export * from './error'\nexport * from './item'\n`)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('all 11 component kinds + webhooks: every section emits its own per-kind file', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-all-'))
    process.chdir(dir)
    try {
      const apiPath = path.join(dir, 'openapi.json')
      writeFileSync(apiPath, JSON.stringify(ALL_COMPONENTS_OPENAPI))
      const parsed = await runGenerator(parseOpenAPI(apiPath))
      await run(parsed)

      const compEntries = (await readdir(path.join(dir, 'src', 'components'))).toSorted()
      expect(compEntries).toStrictEqual([
        'callbacks.ts',
        'examples.ts',
        'headers.ts',
        'links.ts',
        'mediaTypes.ts',
        'parameters.ts',
        'pathItems.ts',
        'requestBodies.ts',
        'responses.ts',
        'schemas.ts',
        'securitySchemes.ts',
      ])

      const schemasSrc = await readFile(path.join(dir, 'src', 'components', 'schemas.ts'), 'utf8')
      expect(schemasSrc.includes('export const ItemSchema')).toBe(true)
      expect(schemasSrc.includes('export const ErrorSchema')).toBe(true)
      const responsesSrc = await readFile(
        path.join(dir, 'src', 'components', 'responses.ts'),
        'utf8',
      )
      expect(responsesSrc.includes('ItemListResponseSchema')).toBe(true)
      const examplesSrc = await readFile(path.join(dir, 'src', 'components', 'examples.ts'), 'utf8')
      expect(examplesSrc.includes('export const ItemSampleExample')).toBe(true)
      expect(examplesSrc.includes('as const')).toBe(true)

      const moduleDirs = new Set((await readdir(path.join(dir, 'src', 'modules'))).toSorted())
      expect(moduleDirs.has('webhooks')).toBe(true)
      expect(moduleDirs.has('items')).toBe(true)
      expect(moduleDirs.has('users')).toBe(true)

      const webhookCtrl = await readFile(
        path.join(dir, 'src', 'modules', 'webhooks', 'index.ts'),
        'utf8',
      )
      expect(webhookCtrl.includes('Item: ItemSchema')).toBe(true)
      expect(webhookCtrl.includes("from '../../components/schemas'")).toBe(true)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('all kinds split mode: every section emits per-entry files + barrels', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-all-split-'))
    process.chdir(dir)
    try {
      const apiPath = path.join(dir, 'openapi.json')
      writeFileSync(apiPath, JSON.stringify(ALL_COMPONENTS_OPENAPI))
      const parsed = await runGenerator(parseOpenAPI(apiPath))
      const c = parsed.components
      // A failure rejects, so reaching the assertions below is itself the success check.
      await runGenerator(
        Effect.all(
          [
            schemas(c?.schemas, 'src/components/schemas', true, false),
            responses(c?.responses, 'src/components/responses', true, false),
            parameters(c?.parameters, 'src/components/parameters', true, false),
            examples(c?.examples, 'src/components/examples', true),
            requestBodies(c?.requestBodies, 'src/components/requestBodies', true, false),
            headers(c?.headers, 'src/components/headers', true, false),
            securitySchemes(c?.securitySchemes, 'src/components/securitySchemes', true),
            links(c?.links, 'src/components/links', true),
            callbacks(c?.callbacks, 'src/components/callbacks', true),
            pathItems(c?.pathItems, 'src/components/pathItems', true),
            mediaTypes(c?.mediaTypes, 'src/components/mediaTypes', true, false),
          ],
          { concurrency: 'unbounded' },
        ),
      )

      const checks: readonly { kind: string; entries: readonly string[] }[] = [
        { kind: 'schemas', entries: ['error.ts', 'index.ts', 'item.ts'] },
        { kind: 'responses', entries: ['index.ts', 'itemList.ts', 'itemSingle.ts'] },
        { kind: 'parameters', entries: ['index.ts', 'pageSize.ts'] },
        { kind: 'examples', entries: ['index.ts', 'itemSample.ts'] },
        { kind: 'requestBodies', entries: ['index.ts', 'itemBody.ts'] },
        { kind: 'headers', entries: ['index.ts', 'rateLimitRemaining.ts'] },
        {
          kind: 'securitySchemes',
          entries: ['apiKeyAuth.ts', 'bearerAuth.ts', 'index.ts'],
        },
        { kind: 'links', entries: ['getItemById.ts', 'index.ts'] },
        { kind: 'callbacks', entries: ['index.ts', 'itemCreated.ts'] },
        { kind: 'pathItems', entries: ['index.ts', 'userCollection.ts'] },
        { kind: 'mediaTypes', entries: ['index.ts', 'jsonItem.ts'] },
      ]
      for (const { kind, entries } of checks) {
        const got = (await readdir(path.join(dir, 'src', 'components', kind))).toSorted()
        expect(got).toStrictEqual([...entries].toSorted())
      }
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('output: src/server/index.ts moves the entire generated tree under src/server/', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-out-'))
    process.chdir(dir)
    try {
      const apiPath = path.join(dir, 'openapi.json')
      writeFileSync(apiPath, JSON.stringify(COMPONENTS_OPENAPI))
      const parsed = await runGenerator(parseOpenAPI(apiPath))
      await runGenerator(elysia(parsed, { output: 'src/server/index.ts' }))

      expect(await readFile(path.join(dir, 'src', 'server', 'index.ts'), 'utf8')).toBe(
        `import { Elysia } from 'elysia'
import { items } from './modules/items'

export const app = new Elysia().use(items)

if (import.meta.main) {
  app.listen(3000)
  console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
}
`,
      )
      const modDirs = (await readdir(path.join(dir, 'src', 'server', 'modules'))).toSorted()
      expect(modDirs.length).toBeGreaterThan(0)
      const srcEntries = (await readdir(path.join(dir, 'src'))).toSorted()
      expect(srcEntries).toStrictEqual(['server'])
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('skips the components dir entirely when the spec declares no components', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-nocomp-'))
    process.chdir(dir)
    try {
      const apiPath = path.join(dir, 'openapi.json')
      writeFileSync(apiPath, JSON.stringify(TAGLESS_OPENAPI))
      const parsed = await runGenerator(parseOpenAPI(apiPath))
      await run(parsed)

      const srcEntries = (await readdir(path.join(dir, 'src'))).toSorted()
      expect(srcEntries).toStrictEqual(['index.ts', 'modules'])
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('components.output aggregate mode — end-to-end import paths', () => {
  // A spec whose only operation references a component schema, so the generated
  // module must import that schema from the single aggregated components file.
  const api = {
    openapi: '3.1.0',
    info: { title: 'T', version: '0' },
    paths: {
      '/items': {
        get: {
          operationId: 'listItems',
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
            },
          },
        },
      },
    },
    components: { schemas: { Item: { type: 'object', properties: { id: { type: 'string' } } } } },
  } as OpenAPI

  it('generates the aggregate file and modules import it via the flat relative path', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-agg-flat-'))
    process.chdir(dir)
    try {
      await runGenerator(
        elysia(api, {
          output: 'src/index.ts',
          componentsOutput: 'src/components.ts',
        }),
      )
      await runGenerator(components(api.components, path.join(dir, 'src', 'components.ts'), false))
      expect(existsSync(path.join(dir, 'src', 'components.ts'))).toBe(true)

      const module = await readFile(path.join(dir, 'src', 'modules', 'items', 'index.ts'), 'utf8')
      expect(module).toBe(`import { Elysia } from 'elysia'
import { ItemSchema } from '../../components'
import { ItemsModel } from './model'

export const items = new Elysia()
  .model({ Item: ItemSchema })
  .get('/items', () => {}, {
    response: { 200: 'Item' },
    detail: { tags: [], operationId: 'listItems' },
  })
`)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('modules import the aggregate file via a nested relative path', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-agg-nested-'))
    process.chdir(dir)
    try {
      await runGenerator(
        elysia(api, {
          output: 'src/index.ts',
          componentsOutput: 'src/lib/components.ts',
        }),
      )

      const module = await readFile(path.join(dir, 'src', 'modules', 'items', 'index.ts'), 'utf8')
      expect(module).toBe(`import { Elysia } from 'elysia'
import { ItemSchema } from '../../lib/components'
import { ItemsModel } from './model'

export const items = new Elysia()
  .model({ Item: ItemSchema })
  .get('/items', () => {}, {
    response: { 200: 'Item' },
    detail: { tags: [], operationId: 'listItems' },
  })
`)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
