import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { makeQueryHooks } from '../helper/query.js'
import type { OpenAPI } from '../openapi/index.js'
import { runGenerator } from '../testing/index.js'
import { HOOK_CONFIGS } from './hooks/index.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

const generators = [
  { name: 'tanstack-query', config: HOOK_CONFIGS['tanstack-query'] },
  { name: 'preact-query', config: HOOK_CONFIGS['preact-query'] },
  { name: 'swr', config: HOOK_CONFIGS.swr },
  { name: 'solid-query', config: HOOK_CONFIGS['solid-query'] },
  { name: 'svelte-query', config: HOOK_CONFIGS['svelte-query'] },
  { name: 'vue-query', config: HOOK_CONFIGS['vue-query'] },
  { name: 'angular-query', config: HOOK_CONFIGS['angular-query'] },
] as const

const emitAll = async (openapi: OpenAPI) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-contract-'))
  tmpDir = dir
  return Promise.all(
    generators.map(async ({ name, config }) => {
      const output = path.join(dir, `${name}.ts`)
      await runGenerator(makeQueryHooks(openapi, output, '../client', config, 'client'))
      return { name, code: fs.readFileSync(output, 'utf-8') }
    }),
  )
}

describe('7 query clients — dataT contract', () => {
  it('emit the same dataT pattern across all 6 clients (after oxfmt normalisation)', async () => {
    const results = await emitAll({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const flags = results.map(({ name, code }) => ({
      name,
      hasDataT: code.includes(
        "Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data']",
      ),
    }))
    expect(flags.every((r) => r.hasDataT)).toBe(true)
  })
})

describe('7 query clients — key derivation contract (hono-takibi path-based)', () => {
  it('uses the first path segment as prefix and the full path as the second key element (tag is not used)', async () => {
    const api: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/v1/pet/{petId}': {
          get: {
            operationId: 'getPet',
            tags: ['Store'],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    }
    const results = await emitAll(api)
    const flags = results.map(({ name, code }) => ({
      name,
      hasPathKey: code.includes("'v1'") && code.includes("'/v1/pet/{petId}'"),
      ignoresTag: !code.includes("'store'") && !code.includes('"store"'),
    }))
    expect(flags.every((r) => r.hasPathKey && r.ignoresTag)).toBe(true)
  })

  it('does not skip version (vN) segments — the raw first path segment is the prefix', async () => {
    const api: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/v2/users/{id}': {
          get: { operationId: 'getUser', responses: { '200': { description: 'ok' } } },
        },
      },
    }
    const results = await emitAll(api)
    const flags = results.map(({ name, code }) => ({
      name,
      hasV2PathKey: code.includes("'v2'") && code.includes("'/v2/users/{id}'"),
    }))
    expect(flags.every((r) => r.hasV2PathKey)).toBe(true)
  })
})

describe('7 query clients — HTTP method contract', () => {
  it('emits mutation hooks for PUT and PATCH (not query hooks)', async () => {
    const api: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          put: { operationId: 'replaceItem', responses: { '204': { description: 'ok' } } },
          patch: { operationId: 'patchItem', responses: { '204': { description: 'ok' } } },
        },
      },
    }
    const results = await emitAll(api)
    const flags = results.map(({ name, code }) => ({
      name,
      hasReplace:
        code.includes('useReplaceItem') ||
        code.includes('createReplaceItem') ||
        code.includes('injectReplaceItem'),
      hasPatch:
        code.includes('usePatchItem') ||
        code.includes('createPatchItem') ||
        code.includes('injectPatchItem'),
    }))
    expect(flags.every((r) => r.hasReplace && r.hasPatch)).toBe(true)
  })

  it('emits query hooks for HEAD (treated as GET-like)', async () => {
    const api: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          head: { operationId: 'headItems', responses: { '200': { description: 'ok' } } },
        },
      },
    }
    const results = await emitAll(api)
    const flags = results.map(({ name, code }) => ({
      name,
      hasHeadHook:
        code.includes('useHeadItems') ||
        code.includes('createHeadItems') ||
        code.includes('injectHeadItems'),
    }))
    expect(flags.every((r) => r.hasHeadHook)).toBe(true)
  })
})

describe('7 query clients — multiple path parameters & basePath contract', () => {
  it('threads every path parameter into the key getter and hook signature', async () => {
    const results = await emitAll({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/orgs/{orgId}/repos/{repoId}': {
          get: { operationId: 'getRepo', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const flags = results.map(({ name, code }) => ({
      name,
      threadsBothParams: code.includes('params:') && code.includes('params2:'),
      keyHasFullPath: code.includes("'/orgs/{orgId}/repos/{repoId}'"),
    }))
    expect(flags.every((r) => r.threadsBothParams && r.keyHasFullPath)).toBe(true)
  })

  it('applies basePath as the first key segment and full path-key element', async () => {
    const api: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-contract-base-'))
    tmpDir = dir
    const results = await Promise.all(
      generators.map(async ({ name, config }) => {
        const output = path.join(dir, `${name}.ts`)
        await runGenerator(makeQueryHooks(api, output, '../client', config, 'client', '/api'))
        return { name, code: fs.readFileSync(output, 'utf-8') }
      }),
    )
    const flags = results.map(({ name, code }) => ({
      name,
      hasBasePrefix: code.includes("'api'") && code.includes("'/api/items'"),
    }))
    expect(flags.every((r) => r.hasBasePrefix)).toBe(true)
  })
})
