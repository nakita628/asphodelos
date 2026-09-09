import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import type { OpenAPI } from '../../openapi/index.js'
import { runGenerator } from '../../testing/index.js'
import { test as testGen } from './index.js'

const spec: OpenAPI = {
  openapi: '3.1.0',
  info: { title: 'Test API', version: '1.0.0' },
  paths: {
    '/users': {
      get: { operationId: 'getUsers', responses: { '200': { description: 'OK' } } },
    },
  },
}

describe('test (core caller)', () => {
  it('writes a formatted bun:test file for the spec', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-test-'))
    const output = path.join(dir, 'index.test.ts')
    const result = await runGenerator(testGen(spec, output))
    expect(result).toBe(`Generated test file written to ${output}`)
    const content = readFileSync(output, 'utf8')
    expect(content.includes("from 'bun:test'")).toBe(true)
    expect(content.includes('app.handle(new Request(')).toBe(true)
    expect(content.includes('expect(res.status).toBe(200)')).toBe(true)
  })

  it('split: co-locates an index.test.ts in each module dir importing the shared app', async () => {
    const splitSpec: OpenAPI = {
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
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-test-split-'))
    await runGenerator(
      testGen(splitSpec, undefined, {
        appOutput: path.join(dir, 'src/index.ts'),
        split: true,
      }),
    )
    const modulesDir = path.join(dir, 'src', 'modules')
    const users = readFileSync(path.join(modulesDir, 'users', 'index.test.ts'), 'utf8')
    const posts = readFileSync(path.join(modulesDir, 'posts', 'index.test.ts'), 'utf8')
    expect(users.includes("from '../../index'")).toBe(true)
    expect(users.includes('app.handle(new Request(')).toBe(true)
    expect(users.includes('new Elysia(')).toBe(false)
    expect(users.includes('/posts')).toBe(false)
    expect(posts.includes("from '../../index'")).toBe(true)
    expect(posts.includes('/posts')).toBe(true)
  })

  it('split + pathAlias: imports the shared app through the alias', async () => {
    const splitSpec: OpenAPI = {
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
      },
    }
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-test-split-alias-'))
    await runGenerator(
      testGen(splitSpec, undefined, {
        appOutput: path.join(dir, 'src/index.ts'),
        split: true,
        pathAlias: '@/',
      }),
    )
    const content = readFileSync(path.join(dir, 'src', 'modules', 'users', 'index.test.ts'), 'utf8')
    expect(content.includes("from '@/index'")).toBe(true)
  })

  it('pathAlias (single file): imports the app through the given alias', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-test-alias-'))
    const output = path.join(dir, 'test', 'index.test.ts')
    await runGenerator(
      testGen(spec, output, {
        appOutput: path.join(dir, 'src/index.ts'),
        pathAlias: '@/',
      }),
    )
    const content = readFileSync(output, 'utf8')
    expect(content.includes("from '@/index'")).toBe(true)
  })

  it('merges into an existing file, preserving hand-written describe blocks', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-test-merge-'))
    const output = path.join(dir, 'index.test.ts')
    writeFileSync(
      output,
      `import { describe, it, expect } from 'bun:test'

describe('custom-marker', () => {
  it('keeps my hand-written test', () => {
    expect(true).toBe(true)
  })
})
`,
    )
    await runGenerator(testGen(spec, output))
    const content = readFileSync(output, 'utf8')
    expect(content.includes('custom-marker')).toBe(true)
  })
})
