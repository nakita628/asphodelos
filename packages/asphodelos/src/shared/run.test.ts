import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

/**
 * Decodes a config and runs every job it produces, inside a fresh directory — one `seed` may
 * first fill with what a project would already hold.
 */
async function runJobs(config: Record<string, unknown>, seed?: (dir: string) => void) {
  const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-jobs-'))
  workdirs.push(dir)
  seed?.(dir)
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

  // The client imports the app entry for its type and is created with the address the entry
  // listens on, so a config with nothing but `client: { output }` yields a client that works
  // against `bun run src/index.ts`.
  it('client: writes a treaty client typed by the app entry, aimed at the configured port', async () => {
    const run = await runJobs({ client: { output: 'src/lib/client.ts' }, port: '4000' })
    expect(run.names).toContain('client')
    const code = run.read('src/lib/client.ts')
    expect(code).toContain("import type { app } from '../index'")
    expect(code).toContain("treaty<typeof app>('http://localhost:4000')")
  })

  // A file that names no import reads the generated client, from wherever it is written. Beside
  // the app entry the client has no barrel — the `index.ts` there is the entry.
  it('client: eden and the hooks import the generated client when they name no import', async () => {
    const run = await runJobs({
      client: { output: 'src/client.ts' },
      eden: { output: 'src/api/eden.ts' },
      swr: { output: 'src/swr.ts' },
    })
    expect(run.read('src/api/eden.ts')).toContain("import { client } from '../client'")
    expect(run.read('src/swr.ts')).toContain("import { client } from './client'")
    expect(run.read('src/index.ts')).not.toContain('export * from')
  })

  // A client in a directory of its own is re-exported by the `index.ts` beside it, and the files
  // elsewhere import that directory; a file beside the client imports the client itself.
  it('client: a barrel beside the client re-exports it, and the other files import the directory', async () => {
    const run = await runJobs({
      client: { output: 'src/lib/client.ts' },
      eden: { output: 'src/lib/eden.ts' },
      swr: { output: 'src/hooks/swr.ts' },
    })
    expect(run.read('src/lib/index.ts')).toBe("export * from './client'\n")
    expect(run.read('src/lib/eden.ts')).toContain("import { client } from './client'")
    expect(run.read('src/hooks/swr.ts')).toContain("import { client } from '../lib'")
  })

  // The barrel is written through the formatter like every generated file, so what was there is
  // kept as the formatter spells it.
  it('client: a barrel that is there already keeps its exports and gains the client once', async () => {
    const run = await runJobs({ client: { output: 'src/lib/client.ts' } }, (dir) => {
      mkdirSync(path.join(dir, 'src/lib'), { recursive: true })
      writeFileSync(path.join(dir, 'src/lib/index.ts'), "export * from './env';\n")
    })
    expect(run.read('src/lib/index.ts')).toBe("export * from './env'\nexport * from './client'\n")
    const again = await runJobs({ client: { output: 'src/lib/client.ts' } }, (dir) => {
      mkdirSync(path.join(dir, 'src/lib'), { recursive: true })
      writeFileSync(path.join(dir, 'src/lib/index.ts'), 'export * from "./client"\n')
    })
    expect(again.read('src/lib/index.ts')).toBe('export * from "./client"\n')
  })

  // The `index.ts` beside the client is left alone when another generator writes it.
  it('client: no barrel where another generator writes the index.ts beside the client', async () => {
    const run = await runJobs({
      client: { output: 'src/lib/client.ts' },
      eden: { output: 'src/lib/index.ts' },
      swr: { output: 'src/swr.ts' },
    })
    expect(run.read('src/lib/index.ts')).not.toContain('export * from')
    expect(run.read('src/swr.ts')).toContain("import { client } from './lib/client'")
  })

  // `@/` stands for the app entry's directory; every import between generated files under it
  // goes through the alias, the module's import of the schemas included. A file outside that
  // directory is imported relatively, since the alias does not reach it.
  it('pathAlias: the generated files under the app directory import each other through it', async () => {
    const run = await runJobs({
      output: 'src/index.ts',
      pathAlias: '@/',
      client: { output: 'src/lib/client.ts' },
      'tanstack-query': { output: 'src/hooks.ts' },
      swr: { output: 'web/swr.ts' },
    })
    expect(run.read('src/lib/client.ts')).toContain("import type { app } from '@/index'")
    expect(run.read('src/hooks.ts')).toContain("import { client } from '@/lib'")
    expect(run.read('web/swr.ts')).toContain("import { client } from '@/lib'")
    expect(run.read('src/modules/items/index.ts')).toContain("from '@/components/schemas'")
  })

  it('pathAlias: a client outside the app directory is imported relatively', async () => {
    const run = await runJobs({
      output: 'server/index.ts',
      pathAlias: '~/',
      client: { output: 'web/lib/client.ts' },
      swr: { output: 'web/swr.ts' },
    })
    expect(run.read('web/lib/client.ts')).toContain("import type { app } from '~/index'")
    expect(run.read('web/swr.ts')).toContain("import { client } from './lib'")
  })

  it('types: writes the self-contained App type', async () => {
    const run = await runJobs({ types: { output: 'src/types.ts' } })
    expect(run.names).toContain('types')
    expect(run.read('src/types.ts')).toContain('export type App')
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

  it('hook libraries: a directory output is written as its index.ts', async () => {
    const run = await runJobs({
      swr: { output: 'src/swr', import: './lib' },
    })
    expect(run.exists('src/swr/index.ts')).toBe(true)
    expect(run.read('src/swr/index.ts')).toContain('useGetItems')
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
