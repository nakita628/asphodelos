import { afterAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Effect } from 'effect'

import { parseConfig } from '../config/index.js'
import type { OpenAPI } from '../openapi/index.js'
import { runGenerator, runGeneratorError } from '../testing/index.js'
import {
  cleanSplitOutputs,
  isInsideDirectory,
  isUserCodeJob,
  jobTargets,
  makeJob,
  outsideSources,
} from './index.js'

describe('makeJob', () => {
  it('emits only the elysia job for a minimal config and component-less spec', () => {
    const parsed = Effect.runSync(parseConfig({ input: 'api.yaml' }))
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
    } as OpenAPI
    const jobs = makeJob(openAPI, parsed).map(({ name, output, split }) => ({
      name,
      output,
      split,
    }))
    expect(jobs).toStrictEqual([{ name: 'elysia', output: 'src/index.ts', split: false }])
  })

  it('assembles component, client, eden, types and hook jobs in canonical order with default outputs', () => {
    const parsed = Effect.runSync(
      parseConfig({
        input: 'api.yaml',
        output: 'src/index.ts',
        client: { output: 'src/client.ts' },
        eden: { output: 'src/eden.ts' },
        types: { output: 'src/types.ts' },
        swr: { output: 'src/swr.ts' },
        'preact-query': { output: 'src/preact.ts' },
      }),
    )
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
      components: {
        schemas: { Foo: { type: 'object' } },
        responses: { Bar: { description: 'ok' } },
      },
    } as OpenAPI
    const jobs = makeJob(openAPI, parsed).map(({ name, output, split }) => ({
      name,
      output,
      split,
    }))
    expect(jobs).toStrictEqual([
      { name: 'elysia', output: 'src/index.ts', split: false },
      { name: 'schemas', output: 'src/components/schemas.ts', split: false },
      { name: 'responses', output: 'src/components/responses.ts', split: false },
      { name: 'client', output: 'src/client.ts', split: false },
      { name: 'eden', output: 'src/eden.ts', split: false },
      { name: 'types', output: 'src/types.ts', split: false },
      { name: 'swr', output: 'src/swr.ts', split: false },
      { name: 'preact-query', output: 'src/preact.ts', split: false },
    ])
  })

  it('wires the mock job when config.mock is set (single file, never split)', () => {
    const parsed = Effect.runSync(
      parseConfig({ input: 'api.yaml', mock: { output: 'src/mock.ts' } }),
    )
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
    } as OpenAPI
    const mockJob = makeJob(openAPI, parsed).find((job) => job.name === 'mock')
    expect(mockJob).toBeDefined()
    expect(mockJob?.split).toBe(false)
    expect(mockJob?.output).toBe('src/mock.ts')
  })

  it('omits the mock job when config.mock is absent', () => {
    const parsed = Effect.runSync(parseConfig({ input: 'api.yaml' }))
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
    } as OpenAPI
    expect(makeJob(openAPI, parsed).find((job) => job.name === 'mock')).toBeUndefined()
  })

  // The hooks are always one file: a directory output is its `index.ts`, and the job is never
  // split, so the split clean never empties a directory the user keeps other files in.
  it('writes a hooks job to one file, a directory output standing for its index.ts', () => {
    const parsed = Effect.runSync(
      parseConfig({
        input: 'api.yaml',
        client: { output: 'src/client.ts' },
        'preact-query': { output: 'src/preact' },
      }),
    )
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
    } as OpenAPI
    const preact = makeJob(openAPI, parsed).find((job) => job.name === 'preact-query')
    expect(preact).toBeDefined()
    expect(preact?.split).toBe(false)
    expect(preact?.output).toBe('src/preact/index.ts')
  })

  it('emits a single aggregate components job (and no per-type jobs) when components.output is set', () => {
    const parsed = Effect.runSync(
      parseConfig({
        input: 'api.yaml',
        output: 'src/index.ts',
        components: { output: 'src/components.ts' },
      }),
    )
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
      components: {
        schemas: { Foo: { type: 'object' } },
        responses: { Bar: { description: 'ok' } },
      },
    } as OpenAPI
    const jobs = makeJob(openAPI, parsed).map(({ name, output, split }) => ({
      name,
      output,
      split,
    }))
    expect(jobs).toStrictEqual([
      { name: 'elysia', output: 'src/index.ts', split: false },
      { name: 'components', output: 'src/components.ts', split: false },
    ])
  })
})

describe('isUserCodeJob', () => {
  it('names the one generator that merges into what the user wrote', () => {
    expect(isUserCodeJob({ name: 'elysia' })).toBe(true)
    expect(isUserCodeJob({ name: 'swr' })).toBe(false)
    expect(isUserCodeJob({ name: 'schemas' })).toBe(false)
  })
})

describe('jobTargets', () => {
  it('adds the modules directory beside the elysia app entry, and nothing for other jobs', () => {
    expect(jobTargets({ name: 'elysia', output: '/p/src/index.ts', split: false })).toStrictEqual([
      '/p/src/index.ts',
      '/p/src/modules',
    ])
    expect(jobTargets({ name: 'schemas', output: '/p/src/schemas', split: true })).toStrictEqual([
      '/p/src/schemas',
    ])
  })

  it('resolves a relative output against the working directory', () => {
    expect(jobTargets({ name: 'types', output: 'src/types.ts', split: false })).toStrictEqual([
      path.resolve(process.cwd(), 'src/types.ts'),
    ])
  })
})

describe('isInsideDirectory', () => {
  it('is true for a file at any depth under the directory', () => {
    expect(isInsideDirectory('/app/spec', '/app/spec/openapi.yaml')).toBe(true)
    expect(isInsideDirectory('/app/spec', '/app/spec/models/user.yaml')).toBe(true)
  })

  it('is false for the directory itself, its parent, and a sibling sharing its prefix', () => {
    expect(isInsideDirectory('/app/spec', '/app/spec')).toBe(false)
    expect(isInsideDirectory('/app/spec', '/app/openapi.yaml')).toBe(false)
    // `/app/spec-old` starts with `/app/spec` and is not inside it.
    expect(isInsideDirectory('/app/spec', '/app/spec-old/openapi.yaml')).toBe(false)
  })
})

describe('cleanSplitOutputs', () => {
  const workdirs: string[] = []
  afterAll(() => {
    for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
  })

  /** A split directory holding a stale entry, a hand-written note, a nested dir and one output. */
  function splitDirectory() {
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-split-'))
    workdirs.push(dir)
    const schemas = path.join(dir, 'schemas')
    mkdirSync(path.join(schemas, 'nested'), { recursive: true })
    writeFileSync(path.join(schemas, 'stale.ts'), '// stale')
    writeFileSync(path.join(schemas, 'index.ts'), '// barrel')
    writeFileSync(path.join(schemas, 'types.ts'), '// another job')
    writeFileSync(path.join(schemas, 'README.md'), 'keep')
    writeFileSync(path.join(schemas, 'nested', 'deep.ts'), '// keep')
    return schemas
  }

  it('empties the direct .ts children and keeps everything else', async () => {
    const schemas = splitDirectory()
    const removed = await runGenerator(
      cleanSplitOutputs([
        { name: 'schemas', output: schemas, split: true },
        { name: 'types', output: path.join(schemas, 'types.ts'), split: false },
      ]),
    )

    expect(removed.toSorted()).toStrictEqual([
      path.join(schemas, 'index.ts'),
      path.join(schemas, 'stale.ts'),
    ])
    // A single-file output of another job is left in place rather than deleted and rewritten.
    expect(existsSync(path.join(schemas, 'types.ts'))).toBe(true)
    expect(existsSync(path.join(schemas, 'README.md'))).toBe(true)
    expect(existsSync(path.join(schemas, 'nested', 'deep.ts'))).toBe(true)
  })

  it('never cleans a split job that merges into the user code', async () => {
    const modules = splitDirectory()
    const removed = await runGenerator(
      cleanSplitOutputs([{ name: 'elysia', output: modules, split: true }]),
    )

    expect(removed).toStrictEqual([])
    expect(existsSync(path.join(modules, 'stale.ts'))).toBe(true)
  })

  it('treats a split directory that does not exist yet as empty', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-split-'))
    workdirs.push(dir)
    const removed = await runGenerator(
      cleanSplitOutputs([{ name: 'schemas', output: path.join(dir, 'missing'), split: true }]),
    )

    expect(removed).toStrictEqual([])
  })
})

describe('outsideSources', () => {
  const directories: string[] = []
  function makeDirectory() {
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), 'asphodelos-sources-')))
    directories.push(directory)
    return directory
  }
  afterAll(() => {
    for (const directory of directories) rmSync(directory, { recursive: true, force: true })
  })

  // The document itself is already covered by the watcher on its directory, so a document that
  // refers to nothing else leaves nothing more to watch.
  it('names nothing when the document has no external reference', async () => {
    const directory = makeDirectory()
    const input = path.join(directory, 'openapi.json')
    writeFileSync(
      input,
      JSON.stringify({ openapi: '3.1.0', info: { title: 'A', version: '1' }, paths: {} }),
    )

    expect(await runGenerator(outsideSources(input))).toStrictEqual([])
  })

  // A `$ref` that leaves the document's directory is exactly the file a watcher on that
  // directory would miss, so it has to be named with its real location.
  it('names a file a $ref reaches outside the document directory', async () => {
    const directory = makeDirectory()
    mkdirSync(path.join(directory, 'spec'))
    mkdirSync(path.join(directory, 'shared'))
    const input = path.join(directory, 'spec', 'openapi.json')
    const shared = path.join(directory, 'shared', 'item.json')
    writeFileSync(shared, JSON.stringify({ type: 'object' }))
    writeFileSync(
      input,
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'A', version: '1' },
        paths: {},
        components: { schemas: { Item: { $ref: '../shared/item.json' } } },
      }),
    )

    expect(await runGenerator(outsideSources(input))).toStrictEqual([shared])
  })

  // A document that does not parse cannot say what it refers to; the caller decides what to
  // watch instead, so this has to fail rather than answer with a partial list.
  it('fails when the document cannot be parsed', async () => {
    const directory = makeDirectory()
    const input = path.join(directory, 'openapi.json')
    writeFileSync(input, '{ not json')

    expect((await runGeneratorError(outsideSources(input)))._tag).toBe('GenerateError')
  })

  // TypeSpec imports are followed through the source text: a relative file, a directory
  // standing for its `main.tsp`, and an import of an import. A package import is a library
  // under node_modules and is not something the user edits.
  it('follows relative TypeSpec imports and leaves package imports out', async () => {
    const directory = makeDirectory()
    mkdirSync(path.join(directory, 'spec'))
    mkdirSync(path.join(directory, 'models'))
    mkdirSync(path.join(directory, 'common'))
    const input = path.join(directory, 'spec', 'main.tsp')
    const user = path.join(directory, 'models', 'user.tsp')
    const id = path.join(directory, 'models', 'id.tsp')
    const common = path.join(directory, 'common', 'main.tsp')
    writeFileSync(
      input,
      'import "@typespec/http";\nimport "../models/user.tsp";\nimport "../common";\n',
    )
    writeFileSync(user, 'import "./id.tsp";\nmodel User {}\n')
    writeFileSync(id, 'scalar Id extends string;\n')
    writeFileSync(common, 'model Common {}\n')

    expect(await runGenerator(outsideSources(input))).toStrictEqual([common, id, user])
  })

  // Two files importing each other must not send the walk round in circles.
  it('stops on TypeSpec files that import each other', async () => {
    const directory = makeDirectory()
    mkdirSync(path.join(directory, 'spec'))
    mkdirSync(path.join(directory, 'models'))
    const input = path.join(directory, 'spec', 'a.tsp')
    const other = path.join(directory, 'models', 'b.tsp')
    writeFileSync(input, 'import "../models/b.tsp";\n')
    writeFileSync(other, 'import "../spec/a.tsp";\n')

    expect(await runGenerator(outsideSources(input))).toStrictEqual([other])
  })

  // A file beside the document, or below it, is one the watcher on the directory already sees;
  // naming it again would watch it twice.
  it('leaves out a referenced file under the document directory', async () => {
    const directory = makeDirectory()
    mkdirSync(path.join(directory, 'schemas'))
    const input = path.join(directory, 'openapi.json')
    writeFileSync(path.join(directory, 'schemas', 'item.json'), JSON.stringify({ type: 'object' }))
    writeFileSync(
      input,
      JSON.stringify({
        openapi: '3.1.0',
        info: { title: 'A', version: '1' },
        paths: {},
        components: { schemas: { Item: { $ref: './schemas/item.json' } } },
      }),
    )

    expect(await runGenerator(outsideSources(input))).toStrictEqual([])
  })
})
