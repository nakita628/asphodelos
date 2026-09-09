import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { parseOpenAPI } from '../../openapi/index.js'
import { runGenerator } from '../../testing/index.js'
import { elysia } from './index.js'

// Integration coverage for `elysia()` writing `src/index.ts`. Statement-level
// merge contracts (var:/type:/expr:* drop on user deletion, etc.) live in
// `src/merge/index.test.ts`; these tests only exercise behaviours that span
// generator + merge + file I/O end-to-end.

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

describe('elysia — merges user edits into src/index.ts on regen', () => {
  const cwdBefore = process.cwd()
  let workdir: string
  let openapiPath: string

  beforeAll(async () => {
    const sanityDir = mkdtempSync(path.join(tmpdir(), 'asphodelos-sanity-'))
    const sanityPath = path.join(sanityDir, 'openapi.json')
    writeFileSync(sanityPath, JSON.stringify(TAGLESS_OPENAPI))
    await runGenerator(parseOpenAPI(sanityPath))
    rmSync(sanityDir, { recursive: true, force: true })
  })

  beforeEach(() => {
    workdir = mkdtempSync(path.join(tmpdir(), 'asphodelos-app-merge-'))
    process.chdir(workdir)
    openapiPath = path.join(workdir, 'openapi.json')
    writeFileSync(openapiPath, JSON.stringify(TAGLESS_OPENAPI))
  })

  afterEach(() => {
    process.chdir(cwdBefore)
    rmSync(workdir, { recursive: true, force: true })
  })

  afterAll(() => {
    process.chdir(cwdBefore)
  })

  it('writes the canonical app file on a clean working directory', async () => {
    const parsed = await runGenerator(parseOpenAPI(openapiPath))
    await runGenerator(elysia(parsed))

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

  it('is idempotent across consecutive runs on a clean directory', async () => {
    const parsed = await runGenerator(parseOpenAPI(openapiPath))
    await runGenerator(elysia(parsed))
    const after1 = await readFile(path.join(workdir, 'src', 'index.ts'), 'utf8')
    await runGenerator(elysia(parsed))
    const after2 = await readFile(path.join(workdir, 'src', 'index.ts'), 'utf8')
    expect(after2).toBe(after1)
  })

  it('converges on user-edited files after one merge cycle', async () => {
    const parsed = await runGenerator(parseOpenAPI(openapiPath))
    const srcDir = path.join(workdir, 'src')
    await mkdir(srcDir, { recursive: true })
    const seeded = `import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { users } from './modules/users'
import { orders } from './modules/orders'
import { healthz } from './modules/healthz'
import { runGenerator } from '../../testing/index.js'

const app = new Elysia().use(swagger()).use(users).use(orders).use(healthz).listen(8080)

export type App = typeof app
`
    await writeFile(path.join(srcDir, 'index.ts'), seeded, 'utf8')

    await runGenerator(elysia(parsed))
    const run1 = await readFile(path.join(srcDir, 'index.ts'), 'utf8')
    await runGenerator(elysia(parsed))
    const run2 = await readFile(path.join(srcDir, 'index.ts'), 'utf8')
    await runGenerator(elysia(parsed))
    const run3 = await readFile(path.join(srcDir, 'index.ts'), 'utf8')
    expect(run2).toBe(run1)
    expect(run3).toBe(run1)
  })

  it('survives five consecutive regen cycles without drift', async () => {
    const parsed = await runGenerator(parseOpenAPI(openapiPath))
    const srcDir = path.join(workdir, 'src')
    await mkdir(srcDir, { recursive: true })
    const seeded = `import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { users } from './modules/users'
import { orders } from './modules/orders'
import { healthz } from './modules/healthz'

const app = new Elysia().use(swagger()).use(users).use(orders).use(healthz).listen(3000)

export type App = typeof app
`
    await writeFile(path.join(srcDir, 'index.ts'), seeded, 'utf8')

    await runGenerator(elysia(parsed))
    const r1 = await readFile(path.join(srcDir, 'index.ts'), 'utf8')
    await runGenerator(elysia(parsed))
    const r2 = await readFile(path.join(srcDir, 'index.ts'), 'utf8')
    await runGenerator(elysia(parsed))
    const r3 = await readFile(path.join(srcDir, 'index.ts'), 'utf8')
    await runGenerator(elysia(parsed))
    const r4 = await readFile(path.join(srcDir, 'index.ts'), 'utf8')
    await runGenerator(elysia(parsed))
    const r5 = await readFile(path.join(srcDir, 'index.ts'), 'utf8')

    expect(r2).toBe(r1)
    expect(r3).toBe(r1)
    expect(r4).toBe(r1)
    expect(r5).toBe(r1)
  })

  it('preserves user edits to the import.meta.main block (dropped console.log stays dropped)', async () => {
    const parsed = await runGenerator(parseOpenAPI(openapiPath))
    await runGenerator(elysia(parsed))
    const appPath = path.join(workdir, 'src', 'index.ts')
    const initial = await readFile(appPath, 'utf8')
    expect(initial.includes('console.log')).toBe(true)

    // Remove the console.log line from inside the listen block, keeping the block.
    const trimmed = initial.replace(
      /\n {2}console\.log\(`🦊 Elysia is running at \$\{app\.server\?\.hostname\}:\$\{app\.server\?\.port\}`\)/,
      '',
    )
    expect(trimmed.includes('console.log')).toBe(false)
    await writeFile(appPath, trimmed, 'utf8')

    await runGenerator(elysia(parsed))
    const afterRegen = await readFile(appPath, 'utf8')
    expect(afterRegen.includes('console.log')).toBe(false)
    expect(afterRegen.includes('if (import.meta.main)')).toBe(true)
  })
})
