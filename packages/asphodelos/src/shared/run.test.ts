import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import { Effect } from 'effect'

import { parseConfig } from '../config/index.js'
import type { OpenAPI } from '../openapi/index.js'
import { runGenerator } from '../testing/index.js'
import { makeJob } from './index.js'

/**
 * `makeJob` is the wiring between a config file and the generators: which field becomes which
 * argument, and which output path each job writes to. Asserting on `{ name, output, split }`
 * proves the table's shape but never runs a single `run`, so a swapped argument — `split` for
 * `exportTypes`, a prefix that never reaches the generator — would not show up.
 *
 * These cases invoke every job the table can produce and check what landed on disk.
 *
 * Jobs resolve their paths against `process.cwd()`, so each case runs inside its own directory.
 */
const PKG_ROOT = path.resolve(import.meta.dir, '../..')

const workdirs: string[] = []

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

const OPENAPI = {
  openapi: '3.1.0',
  info: { title: 'Jobs API', version: '1.0.0' },
  paths: {
    '/items': {
      get: {
        operationId: 'listItems',
        responses: {
          '200': {
            description: 'OK',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
          },
        },
      },
    },
  },
  components: {
    schemas: { Item: { type: 'object', required: ['id'], properties: { id: { type: 'string' } } } },
    responses: { NotFound: { description: 'missing' } },
    parameters: {
      Page: { name: 'page', in: 'query', schema: { type: 'integer' } },
    },
    examples: { Sample: { value: { id: '1' } } },
    requestBodies: {
      ItemBody: {
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Item' } } },
      },
    },
    headers: { RateLimit: { schema: { type: 'integer' } } },
    securitySchemes: { ApiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' } },
    links: { Self: { operationId: 'listItems' } },
    callbacks: { OnItem: { '{$request.body#/url}': { post: { responses: {} } } } },
    pathItems: { Shared: { get: { responses: {} } } },
    mediaTypes: {
      Json: { schema: { $ref: '#/components/schemas/Item' } },
    },
  },
} as unknown as OpenAPI

/** Decodes a config and runs every job it produces, inside a fresh directory. */
async function runJobs(config: Record<string, unknown>) {
  const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-jobs-'))
  workdirs.push(dir)
  const cwd = process.cwd()
  process.chdir(dir)
  try {
    const decoded = Effect.runSync(parseConfig({ input: 'openapi.yaml', ...config }))
    const jobs = makeJob(OPENAPI, decoded)
    const logs = await runGenerator(
      Effect.all(
        jobs.map((job) => job.run(job.output)),
        { concurrency: 'unbounded' },
      ),
    )
    return {
      dir,
      logs,
      names: jobs.map((job) => job.name),
      read: (relative: string) => readFileSync(path.join(dir, relative), 'utf8'),
      exists: (relative: string) => existsSync(path.join(dir, relative)),
    }
  } finally {
    process.chdir(cwd)
  }
}

describe('makeJob — every job actually runs', () => {
  it('elysia: writes the app and its modules at the configured output', async () => {
    const run = await runJobs({ output: 'src/app.ts' })
    // The document declares components, so per-type jobs come along; `elysia` is always first.
    expect(run.names[0]).toBe('elysia')
    expect(run.exists('src/app.ts')).toBe(true)
    expect(run.exists('src/modules/items/index.ts')).toBe(true)
  })

  it('elysia: threads prefix, port and integration into the generated app', async () => {
    const run = await runJobs({
      output: 'src/index.ts',
      prefix: '/api',
      port: '4000',
      integration: true,
    })
    const app = run.read('src/index.ts')
    expect(app).toContain("prefix: '/api'")
    // `integration: true` is what drops the `.listen()` block, so the port must not appear.
    expect(app).not.toContain('4000')
  })

  it('elysia: port reaches the app entry when it is not an integration build', async () => {
    const run = await runJobs({ output: 'src/index.ts', port: '4000' })
    expect(run.read('src/index.ts')).toContain('4000')
  })

  it('components (single output): bundles every section into one file', async () => {
    const run = await runJobs({ components: { output: 'src/components.ts' } })
    // A single `output` replaces the per-type jobs entirely.
    expect(run.names).toStrictEqual(['elysia', 'components'])
    const bundled = run.read('src/components.ts')
    expect(bundled).toContain('ItemSchema')
    expect(bundled).toContain('RateLimitHeader')
    expect(run.exists('src/components/schemas.ts')).toBe(false)
  })

  it('components (per type): routes each section to its own file', async () => {
    const run = await runJobs({ components: { schemas: { output: 'src/schemas.ts' } } })
    expect(run.names).toContain('schemas')
    expect(run.read('src/schemas.ts')).toContain('ItemSchema')
  })

  it('components: every section the document declares gets a job that writes', async () => {
    const run = await runJobs({})
    const sections = [
      'schemas',
      'responses',
      'parameters',
      'examples',
      'requestBodies',
      'headers',
      'securitySchemes',
      'links',
      'callbacks',
      'pathItems',
      'mediaTypes',
    ]
    expect(run.names).toStrictEqual(['elysia', ...sections])
    for (const section of sections) {
      expect(run.exists(`src/components/${section}.ts`)).toBe(true)
    }
  })

  it('components: exportTypes reaches the generator, and split is not confused with it', async () => {
    const withTypes = await runJobs({
      components: { schemas: { output: 'src/schemas.ts', exportTypes: true } },
    })
    expect(withTypes.read('src/schemas.ts')).toContain('export type Item')

    const withoutTypes = await runJobs({
      components: { schemas: { output: 'src/schemas.ts' } },
    })
    expect(withoutTypes.read('src/schemas.ts')).not.toContain('export type Item')
  })

  it('components: split writes one file per entry plus a barrel', async () => {
    const run = await runJobs({
      components: { schemas: { split: true, output: 'src/schemas' } },
    })
    expect(run.names).toContain('schemas')
    expect(run.exists('src/schemas/item.ts')).toBe(true)
    expect(run.exists('src/schemas/index.ts')).toBe(true)
  })

  it('eden: writes per-operation wrappers importing the configured client', async () => {
    const run = await runJobs({
      eden: { output: 'src/eden.ts', import: './lib', client: 'api' },
    })
    expect(run.names).toContain('eden')
    const eden = run.read('src/eden.ts')
    expect(eden).toContain("import { api } from './lib'")
    expect(eden).toContain('listItems')
  })

  it('eden: docs: true prepends JSDoc to each wrapper', async () => {
    const run = await runJobs({
      eden: { output: 'src/eden.ts', import: './lib', docs: true },
    })
    expect(run.read('src/eden.ts')).toContain('/**')
  })

  it('types: writes the self-contained App type', async () => {
    const run = await runJobs({ types: { output: 'src/types.ts' } })
    expect(run.names).toContain('types')
    expect(run.read('src/types.ts')).toContain('export type App')
  })

  it('test (single file): writes one suite importing the assembled app', async () => {
    const run = await runJobs({ test: { output: 'src/app.test.ts' } })
    expect(run.names).toContain('test')
    const suite = run.read('src/app.test.ts')
    expect(suite).toContain("from 'bun:test'")
    expect(suite).toContain("from './index'")
  })

  it('test (split): co-locates a suite in each module directory', async () => {
    const run = await runJobs({ test: { split: true } })
    const job = makeJob(
      OPENAPI,
      Effect.runSync(parseConfig({ input: 'a.yaml', test: { split: true } })),
    )
    expect(job.find((j) => j.name === 'test')?.split).toBe(true)
    expect(run.exists('src/modules/items/index.test.ts')).toBe(true)
  })

  it('test: pathAlias rewrites the app import in the generated suite', async () => {
    const run = await runJobs({ test: { output: 'src/app.test.ts', pathAlias: '@/src' } })
    expect(run.read('src/app.test.ts')).toContain("from '@/src/index'")
  })

  it('mock: writes a faker-backed server at the configured output', async () => {
    const run = await runJobs({ mock: { output: 'src/mock.ts' }, port: '5000' })
    expect(run.names).toContain('mock')
    const mock = run.read('src/mock.ts')
    expect(mock).toContain('faker')
    expect(mock).toContain('5000')
  })

  it('hook libraries: each configured client gets its own job and file', async () => {
    const libraries = [
      'swr',
      'tanstack-query',
      'preact-query',
      'vue-query',
      'svelte-query',
      'solid-query',
      'angular-query',
    ] as const
    const config = Object.fromEntries(
      libraries.map((library) => [library, { output: `src/${library}.ts`, import: './lib' }]),
    )
    const run = await runJobs(config)
    for (const library of libraries) {
      expect(run.names).toContain(library)
      expect(run.exists(`src/${library}.ts`)).toBe(true)
    }
  })

  it('hook libraries: split writes one file per operation plus a barrel', async () => {
    const run = await runJobs({
      swr: { split: true, output: 'src/swr', import: './lib' },
    })
    expect(run.exists('src/swr/listItems.ts')).toBe(true)
    expect(run.exists('src/swr/index.ts')).toBe(true)
  })

  it('every job answers with the log line the CLI prints', async () => {
    const run = await runJobs({
      output: 'src/index.ts',
      types: { output: 'src/types.ts' },
      mock: { output: 'src/mock.ts' },
    })
    expect(run.logs.length).toBe(run.names.length)
    for (const line of run.logs) expect(line).toContain('Generated')
  })
})
