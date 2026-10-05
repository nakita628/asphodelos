import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { OpenAPI } from '../../openapi/index.js'
import { runGenerator } from '../../testing/index.js'
import { eden } from './index.js'

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
