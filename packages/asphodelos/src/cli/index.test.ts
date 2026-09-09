import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { runGenerator, runGeneratorError } from '../testing/index.js'
import { asphodelos, parseCli } from './index.js'

describe('parseCli', () => {
  for (const input of ['petstore.yaml', 'petstore.json', 'petstore.tsp'] as const) {
    it(`accepts ${input} -o <output.ts>`, async () => {
      const result = await runGenerator(parseCli([input, '-o', 'src/index.ts']))
      expect(result).toStrictEqual({ input, output: 'src/index.ts' })
    })
  }

  // Every rejection answers with the help text, which is what the bin prints.
  for (const [reason, args] of [
    ['-o is missing', ['petstore.yaml']],
    ['input has the wrong extension', ['petstore.txt', '-o', 'src/index.ts']],
    ['output has the wrong extension', ['petstore.yaml', '-o', 'src/index.js']],
    ['args are empty', []],
    ['-o has no value following', ['petstore.yaml', '-o']],
  ] as const) {
    it(`rejects when ${reason}`, async () => {
      const error = await runGeneratorError(parseCli(args))
      expect(error._tag).toBe('GenerateError')
      expect(error.message.startsWith('Usage: asphodelos')).toBe(true)
    })
  }
})

describe('asphodelos --help / -h', () => {
  for (const flag of ['--help', '-h']) {
    it(`returns help text on ${flag}`, async () => {
      const result = await runGenerator(asphodelos([flag]))
      expect(result.startsWith('Usage: asphodelos')).toBe(true)
    })
  }
})

/**
 * The command end to end, in a real directory.
 *
 * `asphodelos()` picks its path from whether `asphodelos.config.ts` exists, and both branches
 * write files — so neither is covered by the argv parsing above. Each case runs inside its own
 * directory because the config is resolved against `process.cwd()`.
 */
describe('asphodelos — end to end', () => {
  const PKG_ROOT = path.resolve(import.meta.dir, '../..')
  const workdirs: string[] = []
  let cwdBefore: string | undefined

  const OPENAPI = `openapi: 3.1.0
info: { title: CLI API, version: 1.0.0 }
paths:
  /items:
    get:
      operationId: listItems
      responses:
        '200':
          description: OK
          content:
            application/json:
              schema: { $ref: '#/components/schemas/Item' }
components:
  schemas:
    Item:
      type: object
      required: [id]
      properties:
        id: { type: string }
`

  /** A project directory, with a config file only when one is given. */
  function project(config?: string) {
    const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-cli-'))
    workdirs.push(dir)
    writeFileSync(path.join(dir, 'openapi.yaml'), OPENAPI)
    if (config !== undefined) writeFileSync(path.join(dir, 'asphodelos.config.ts'), config)
    cwdBefore ??= process.cwd()
    process.chdir(dir)
    return dir
  }

  afterEach(() => {
    if (cwdBefore) process.chdir(cwdBefore)
  })

  afterAll(() => {
    for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
  })

  it('argv path: with no config file, generates from <input> -o <output>', async () => {
    const dir = project()
    const log = await runGenerator(asphodelos(['openapi.yaml', '-o', 'src/index.ts']))

    expect(log).toContain('Generated 1 module(s) (items)')
    expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(true)
    expect(existsSync(path.join(dir, 'src/modules/items/index.ts'))).toBe(true)
    // The argv path generates the app only — components need a config file.
    expect(existsSync(path.join(dir, 'src/components'))).toBe(false)
  })

  it('argv path: a spec that cannot be read fails with the parser message', async () => {
    project()
    const error = await runGeneratorError(asphodelos(['missing.yaml', '-o', 'src/index.ts']))

    expect(error._tag).toBe('OpenAPIError')
    expect(error.message.length).toBeGreaterThan(0)
  })

  it('argv path: bad arguments fail with the help text', async () => {
    project()
    const error = await runGeneratorError(asphodelos(['openapi.yaml']))

    expect(error._tag).toBe('GenerateError')
    expect(error.message.startsWith('Usage: asphodelos')).toBe(true)
  })

  it('config path: runs every job the config asks for and reports one line each', async () => {
    const dir = project(`import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig({
  input: 'openapi.yaml',
  output: 'src/index.ts',
  components: { schemas: { output: 'src/components/schemas.ts' } },
  types: { output: 'src/types.ts' },
})
`)
    const log = await runGenerator(asphodelos([]))

    expect(log.split('\n').length).toBe(3)
    expect(log).toContain('Generated 1 module(s) (items)')
    expect(log).toContain('Generated schemas code written to src/components/schemas.ts')
    expect(log).toContain('Generated app type written to src/types.ts')
    expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(true)
    expect(existsSync(path.join(dir, 'src/components/schemas.ts'))).toBe(true)
    expect(existsSync(path.join(dir, 'src/types.ts'))).toBe(true)
  })

  it('config path: the config wins over argv, so the arguments are ignored', async () => {
    const dir = project(`import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig({ input: 'openapi.yaml', output: 'src/fromConfig.ts' })
`)
    await runGenerator(asphodelos(['openapi.yaml', '-o', 'src/fromArgv.ts']))

    expect(existsSync(path.join(dir, 'src/fromConfig.ts'))).toBe(true)
    expect(existsSync(path.join(dir, 'src/fromArgv.ts'))).toBe(false)
  })

  it("config path: the config's format block reaches the generated source", async () => {
    const dir = project(`import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig({
  input: 'openapi.yaml',
  output: 'src/index.ts',
  format: { semi: true, singleQuote: false },
})
`)
    await runGenerator(asphodelos([]))

    const app = readFileSync(path.join(dir, 'src/index.ts'), 'utf8')
    expect(app).toContain('from "elysia";')
  })

  it('config path: an invalid config fails with the field that is wrong', async () => {
    project(`import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
// @ts-expect-error deliberately invalid: the input extension is not one asphodelos accepts
export default defineConfig({ input: 'openapi.txt' })
`)
    const error = await runGeneratorError(asphodelos([]))

    expect(error._tag).toBe('ConfigError')
    expect(error.message).toContain('Invalid config: input:')
  })

  it('config path: a module with no default export fails before any generation', async () => {
    const dir = project('export const notDefault = 1\n')
    const error = await runGeneratorError(asphodelos([]))

    expect(error._tag).toBe('ConfigError')
    expect(error.message).toBe('Config must export default object')
    expect(existsSync(path.join(dir, 'src'))).toBe(false)
  })
})
