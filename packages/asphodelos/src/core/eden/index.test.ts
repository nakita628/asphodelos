import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { OpenAPI, Operation } from '../../openapi/index.js'
import { runGenerator } from '../../testing/index.js'
import { eden, makeJsDocs } from './index.js'

const generateAndRead = async (
  api: OpenAPI,
  importPath = './client',
  client = 'client',
  basePath?: string,
) => {
  const cwd = process.cwd()
  const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-eden-'))
  process.chdir(dir)
  try {
    await runGenerator(eden(api, 'src/eden.ts', importPath, client, basePath))
    return readFileSync(path.join(dir, 'src/eden.ts'), 'utf8')
  } finally {
    process.chdir(cwd)
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('eden generator — header', () => {
  it('imports the client (default name `client`) from the configured path', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    expect(code.startsWith("import { client } from './client'")).toBe(true)
  })

  it('respects custom import path + client variable name', async () => {
    const code = await generateAndRead(
      {
        openapi: '3.1.0',
        info: { title: 'T', version: '0' },
        paths: {
          '/items': {
            get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
          },
        },
      },
      './sdk',
      'api',
    )
    expect(code.startsWith("import { api } from './sdk'")).toBe(true)
  })
})

describe('eden generator — function signatures (spread Parameters<>)', () => {
  it('GET static path: spread args from Eden method signature', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    expect(code).toBe(
      `import { client } from './client'

export async function listItems(...args: Parameters<typeof client.items.get>) {
  return client.items.get(...args)
}
`,
    )
  })

  it('GET dynamic path: params arg + spread method args', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          get: { operationId: 'getItem', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    expect(code).toBe(
      `import { client } from './client'

export async function getItem(
  params: Parameters<typeof client.items>[0],
  ...args: Parameters<ReturnType<typeof client.items>['get']>
) {
  return client.items(params).get(...args)
}
`,
    )
  })

  it('POST static path: spread args (body + options as positional)', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
        },
      },
    })
    expect(code).toBe(
      `import { client } from './client'

export async function createItem(...args: Parameters<typeof client.items.post>) {
  return client.items.post(...args)
}
`,
    )
  })

  it('POST dynamic path: params arg + spread method args', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          put: { operationId: 'updateItem', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    expect(code).toBe(
      `import { client } from './client'

export async function updateItem(
  params: Parameters<typeof client.items>[0],
  ...args: Parameters<ReturnType<typeof client.items>['put']>
) {
  return client.items(params).put(...args)
}
`,
    )
  })

  it('multiple path params: each callable layer gets its own params arg', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/users/{userId}/posts/{postId}': {
          get: { operationId: 'getUserPost', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    expect(code).toBe(
      `import { client } from './client'

export async function getUserPost(
  params: Parameters<typeof client.users>[0],
  params2: Parameters<ReturnType<typeof client.users>['posts']>[0],
  ...args: Parameters<ReturnType<ReturnType<typeof client.users>['posts']>['get']>
) {
  return client
    .users(params)
    .posts(params2)
    .get(...args)
}
`,
    )
  })

  it('falls back to method+path camelCase when operationId is missing', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': { get: { responses: { '200': { description: 'ok' } } } },
      },
    })
    expect(code).toBe(
      `import { client } from './client'

export async function getItems(...args: Parameters<typeof client.items.get>) {
  return client.items.get(...args)
}
`,
    )
  })

  it('basePath: prepended to every path so chain matches Elysia client type', async () => {
    const code = await generateAndRead(
      {
        openapi: '3.1.0',
        info: { title: 'T', version: '0' },
        paths: {
          '/pet': { post: { operationId: 'addPet', responses: { '200': { description: 'ok' } } } },
        },
      },
      './client',
      undefined,
      '/api/v3',
    )
    expect(code).toBe(
      `import { client } from './client'

export async function addPet(...args: Parameters<typeof client.api.v3.pet.post>) {
  return client.api.v3.pet.post(...args)
}
`,
    )
  })
})

describe('eden generator — same path, multiple methods', () => {
  it('emits in HTTP_METHODS order (get → post → delete) when one path has GET + POST + DELETE', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
          post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
          delete: { operationId: 'deleteItems', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    expect(code).toBe(
      `import { client } from './client'

export async function listItems(...args: Parameters<typeof client.items.get>) {
  return client.items.get(...args)
}

export async function createItem(...args: Parameters<typeof client.items.post>) {
  return client.items.post(...args)
}

export async function deleteItems(...args: Parameters<typeof client.items.delete>) {
  return client.items.delete(...args)
}
`,
    )
  })
})

describe('eden generator — empty input', () => {
  it('returns ok with no-op message when there are no operations', async () => {
    const result = await runGenerator(
      eden(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/eden.ts',
        './client',
        'client',
      ),
    )
    expect(result).toStrictEqual('No operations found')
  })
})

describe('makeJsDocs — JSDoc block from OpenAPI metadata', () => {
  const op = (overrides: Partial<Operation> = {}): Operation => ({
    responses: { '200': { description: 'ok' } },
    ...overrides,
  })

  it('no metadata: emits METHOD + path only', () => {
    expect(makeJsDocs('get', '/items', op())).toBe(`/**
 * GET /items
 */`)
  })

  it('summary only: prepended above METHOD + path', () => {
    expect(makeJsDocs('get', '/items', op({ summary: 'List items' }))).toBe(`/**
 * List items
 *
 * GET /items
 */`)
  })

  it('description only (single-line): prepended above METHOD + path', () => {
    expect(makeJsDocs('get', '/items/{id}', op({ description: 'Returns 404 if missing.' })))
      .toBe(`/**
 * Returns 404 if missing.
 *
 * GET /items/{id}
 */`)
  })

  it('description multi-line: each line emitted as its own ` * ` line', () => {
    expect(makeJsDocs('get', '/items', op({ description: 'Line one.\nLine two.' }))).toBe(`/**
 * Line one.
 * Line two.
 *
 * GET /items
 */`)
  })

  it('summary + description: blocks separated by blank ` *` lines', () => {
    expect(
      makeJsDocs(
        'get',
        '/items/{id}',
        op({ summary: 'Get item', description: 'Returns 404 if missing.' }),
      ),
    ).toBe(`/**
 * Get item
 *
 * Returns 404 if missing.
 *
 * GET /items/{id}
 */`)
  })

  it('deprecated only: no summary/description, METHOD + path + @deprecated', () => {
    expect(makeJsDocs('delete', '/items/{id}', op({ deprecated: true }))).toBe(`/**
 * DELETE /items/{id}
 *
 * @deprecated
 */`)
  })

  it('full: summary + description + deprecated', () => {
    expect(
      makeJsDocs(
        'put',
        '/items/{id}',
        op({
          summary: 'Update item',
          description: 'Replaces the item in place.',
          deprecated: true,
        }),
      ),
    ).toBe(`/**
 * Update item
 *
 * Replaces the item in place.
 *
 * PUT /items/{id}
 *
 * @deprecated
 */`)
  })
})

describe('eden generator — JSDoc (docs flag)', () => {
  it('default (docs=false): no JSDoc block emitted', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-eden-docs-'))
    process.chdir(dir)
    try {
      await runGenerator(
        eden(
          {
            openapi: '3.1.0',
            info: { title: 'T', version: '0' },
            paths: {
              '/items': {
                get: {
                  operationId: 'listItems',
                  summary: 'List items',
                  responses: { '200': { description: 'ok' } },
                },
              },
            },
          },
          'src/eden.ts',
          './client',
          'client',
        ),
      )
      const code = readFileSync(path.join(dir, 'src/eden.ts'), 'utf8')
      const expected = `import { client } from './client'

export async function listItems(...args: Parameters<typeof client.items.get>) {
  return client.items.get(...args)
}
`
      expect(code).toBe(expected)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('docs=true with no metadata: emits METHOD + path only', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-eden-docs-'))
    process.chdir(dir)
    try {
      await runGenerator(
        eden(
          {
            openapi: '3.1.0',
            info: { title: 'T', version: '0' },
            paths: {
              '/items': {
                get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
              },
            },
          },
          'src/eden.ts',
          './client',
          'client',
          undefined,
          true,
        ),
      )
      const code = readFileSync(path.join(dir, 'src/eden.ts'), 'utf8')
      const expected = `import { client } from './client'

/**
 * GET /items
 */
export async function listItems(...args: Parameters<typeof client.items.get>) {
  return client.items.get(...args)
}
`
      expect(code).toBe(expected)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('docs=true with summary + description + deprecated: full JSDoc block', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-eden-docs-'))
    process.chdir(dir)
    try {
      await runGenerator(
        eden(
          {
            openapi: '3.1.0',
            info: { title: 'T', version: '0' },
            paths: {
              '/items/{id}': {
                get: {
                  operationId: 'getItem',
                  summary: 'Get an item',
                  description: 'Returns 404 if missing.',
                  deprecated: true,
                  responses: { '200': { description: 'ok' } },
                },
              },
            },
          },
          'src/eden.ts',
          './client',
          'client',
          undefined,
          true,
        ),
      )
      const code = readFileSync(path.join(dir, 'src/eden.ts'), 'utf8')
      const expected = `import { client } from './client'

/**
 * Get an item
 *
 * Returns 404 if missing.
 *
 * GET /items/{id}
 *
 * @deprecated
 */
export async function getItem(
  params: Parameters<typeof client.items>[0],
  ...args: Parameters<ReturnType<typeof client.items>['get']>
) {
  return client.items(params).get(...args)
}
`
      expect(code).toBe(expected)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
