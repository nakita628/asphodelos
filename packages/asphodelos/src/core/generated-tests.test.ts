import { afterAll, describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import type { OpenAPI } from '../openapi/index.js'
import { runGenerator } from '../testing/index.js'
import { elysia, schemas, test as generateTests } from './index.js'

/**
 * The test generator's output is itself a deliverable: users run it as the contract their
 * handlers must satisfy. Asserting on its text only proves it was written — not that it parses,
 * that its imports resolve, that the faker calls it emits produce values the routes accept, or
 * that the app it drives actually answers. So this suite generates an app and its tests into a
 * throwaway directory and runs `bun test` over the result.
 *
 * It walks the workflow the README prescribes, because each step is a separate promise to the
 * user:
 *
 *   red    a freshly generated suite passes wherever an empty stub already satisfies the spec,
 *          and fails — pointing at the exact route — wherever it does not. That failure is the
 *          "implement here" signal, so it has to be precise rather than merely present.
 *   green  once the handler is written, the generated test passes. This is where the generator's
 *          two halves have to agree: the test asserts the status the controller declares.
 *   merge  regenerating over an implemented handler keeps the implementation. Users regenerate
 *          after every spec change, so losing hand-written logic here would be silent data loss.
 *
 * The directory has to sit inside this package so the generated `import { app }` /
 * `import { faker }` resolve. `tmp-*` is gitignored and excluded from lint and format.
 */
const PKG_ROOT = path.resolve(import.meta.dir, '../..')

const workdirs: string[] = []

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

const SHOP_API = {
  openapi: '3.1.0',
  info: { title: 'Shop API', version: '1.0.0' },
  tags: [
    { name: 'users', description: 'User operations' },
    { name: 'posts', description: 'Post operations' },
  ],
  paths: {
    '/users': {
      get: {
        operationId: 'listUsers',
        tags: ['users'],
        summary: 'List users',
        responses: { '200': { description: 'OK' } },
      },
    },
    '/users/{id}': {
      get: {
        operationId: 'getUser',
        tags: ['users'],
        summary: 'Get a user',
        parameters: [
          { name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } },
        ],
        responses: { '200': { description: 'OK' } },
      },
    },
    '/posts': {
      get: {
        operationId: 'listPosts',
        tags: ['posts'],
        responses: { '200': { description: 'OK' } },
      },
      post: {
        operationId: 'createPost',
        tags: ['posts'],
        summary: 'Create a post',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { $ref: '#/components/schemas/NewPost' } } },
        },
        responses: { '201': { description: 'Created' } },
      },
    },
  },
  components: {
    schemas: {
      NewPost: {
        type: 'object',
        required: ['title', 'body'],
        properties: { title: { type: 'string' }, body: { type: 'string' } },
      },
    },
  },
} as unknown as OpenAPI

/** Generates app, component schemas and tests, then returns the directory they landed in. */
async function generateProject(api: OpenAPI, options: { readonly split: boolean }) {
  const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-generated-tests-'))
  workdirs.push(dir)
  const appOutput = path.join(dir, 'src/index.ts')
  const componentsOutput = path.join(dir, 'src/components/schemas.ts')
  const components = { schemas: { output: componentsOutput, split: false } }

  // A failure rejects, so there is nothing to branch on here.
  await runGenerator(elysia(api, { output: appOutput, components }))
  if (api.components?.schemas) {
    await runGenerator(schemas(api.components.schemas, componentsOutput, false, false, components))
  }
  await runGenerator(
    generateTests(api, options.split ? undefined : path.join(dir, 'src/app.test.ts'), {
      appOutput,
      split: options.split,
    }),
  )
  return dir
}

/** Each case runs a nested `bun test` over a generated project; a loaded machine needs longer than the default. */
const SPAWN_TIMEOUT_MS = 60_000

/** Runs `bun test` over a generated project and reports what the runner printed. */
function runBunTest(dir: string) {
  const result = spawnSync('bun', ['test'], {
    cwd: dir,
    encoding: 'utf-8',
    // `bun test` writes its summary to stderr.
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const passed = Number(/(\d+) pass/u.exec(output)?.[1] ?? '0')
  const failed = Number(/(\d+) fail/u.exec(output)?.[1] ?? '0')
  return { status: result.status, output, passed, failed }
}

/** The "you fill in the handler" step from the README, applied to the one stub that needs it. */
async function implementCreatePost(dir: string, stub: string, implemented: string) {
  const file = path.join(dir, 'src/modules/posts/index.ts')
  const source = await readFile(file, 'utf-8')
  if (!source.includes(stub)) throw new Error(`generated stub not found in ${file}:\n${source}`)
  await writeFile(file, source.replace(stub, implemented))
}

describe('generated tests — the red / green / regenerate workflow', () => {
  // The one route whose declared success status an empty stub cannot produce: Elysia answers 200
  // until a handler sets 201.
  const STUB = "  .post('/posts', ({ body }) => {}, {"
  const IMPLEMENTED = `  .post(
    '/posts',
    ({ body, set }) => {
      set.status = 201
    },
    {`

  it(
    'red: a fresh suite passes the routes a stub satisfies, and fails only on the one it cannot',
    async () => {
      const dir = await generateProject(SHOP_API, { split: false })
      const run = runBunTest(dir)

      // GET /users, GET /users/{id}, GET /posts — all declare 200.
      expect(run.passed).toBe(3)
      expect(run.failed).toBe(1)
      expect(run.status).not.toBe(0)
      // The failure has to name the route and the mismatch, or it is not an actionable signal.
      expect(run.output).toContain('POST /posts')
      expect(run.output).toContain('Expected: 201')
      expect(run.output).toContain('Received: 200')
    },
    SPAWN_TIMEOUT_MS,
  )

  it(
    'green: implementing the handler turns the generated suite green',
    async () => {
      const dir = await generateProject(SHOP_API, { split: false })
      await implementCreatePost(dir, STUB, IMPLEMENTED)

      const run = runBunTest(dir)
      expect(run.failed).toBe(0)
      // Four operations in the document; a generator that emitted nothing must not read as success.
      expect(run.passed).toBe(4)
      expect(run.status).toBe(0)
    },
    SPAWN_TIMEOUT_MS,
  )

  it(
    'regenerate: the implemented handler survives, and the suite stays green',
    async () => {
      const dir = await generateProject(SHOP_API, { split: false })
      await implementCreatePost(dir, STUB, IMPLEMENTED)

      // Same document, second pass — exactly what a user runs after editing the spec.
      await runGenerator(
        elysia(SHOP_API, {
          output: path.join(dir, 'src/index.ts'),
          components: {
            schemas: { output: path.join(dir, 'src/components/schemas.ts'), split: false },
          },
        }),
      )

      const controller = await readFile(path.join(dir, 'src/modules/posts/index.ts'), 'utf-8')
      expect(controller).toContain('set.status = 201')

      const run = runBunTest(dir)
      expect(run.failed).toBe(0)
      expect(run.passed).toBe(4)
      expect(run.status).toBe(0)
    },
    SPAWN_TIMEOUT_MS,
  )

  it(
    'split: one colocated test file per resource, green once implemented',
    async () => {
      const dir = await generateProject(SHOP_API, { split: true })
      await implementCreatePost(dir, STUB, IMPLEMENTED)

      const run = runBunTest(dir)
      expect(run.failed).toBe(0)
      expect(run.passed).toBe(4)

      for (const resource of ['users', 'posts']) {
        const source = await readFile(
          path.join(dir, 'src/modules', resource, 'index.test.ts'),
          'utf-8',
        )
        expect(source).toContain("from 'bun:test'")
        // Colocated tests reach the app entry from two directories down.
        expect(source).toContain("from '../../index'")
      }
    },
    SPAWN_TIMEOUT_MS,
  )

  it(
    'mocks a uuid path parameter with a value the route accepts',
    async () => {
      const dir = await generateProject(SHOP_API, { split: false })
      const source = await readFile(path.join(dir, 'src/app.test.ts'), 'utf-8')
      // A plain `faker.string.alpha()` here would 422 against `format: uuid`. The green run above
      // is what proves the emitted call satisfies the constraint; this pins which call it emits.
      expect(source).toContain('faker.string.uuid()')
    },
    SPAWN_TIMEOUT_MS,
  )
})
