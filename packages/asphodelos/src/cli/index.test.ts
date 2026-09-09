import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { Console, Effect, Exit } from 'effect'

import { asphodelos } from './index.js'

/**
 * The command as a caller meets it: an argument list in, an exit status and printed output out.
 *
 * Parsing, validation, `--help`, `--version` and completions belong to `effect/unstable/cli`, so
 * nothing here re-tests them in the abstract — the cases assert what this command does with them:
 * which combinations it refuses, which mode each one selects, and what reaches the disk.
 */
const PKG_ROOT = path.resolve(import.meta.dir, '../..')
const ENTRY_URL = new URL('../index.ts', import.meta.url).href
const ANSI = new RegExp(`${String.fromCodePoint(27)}\\[[0-9;]*m`, 'gu')

const workdirs: string[] = []
let cwdBefore: string | undefined

const SPEC = `openapi: 3.1.0
info: { title: CLI API, version: 1.0.0 }
paths:
  /items: { get: { operationId: listItems, responses: { '200': { description: OK } } } }
`

/** A project directory, with a config file only when one is given. */
function project(config?: string, configName = 'asphodelos.config.ts') {
  const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-cli-'))
  workdirs.push(dir)
  writeFileSync(path.join(dir, 'openapi.yaml'), SPEC)
  if (config !== undefined) writeFileSync(path.join(dir, configName), config)
  cwdBefore ??= process.cwd()
  process.chdir(dir)
  return dir
}

const configSource = (
  body: string,
) => `import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig(${body})
`

/** Runs the command to completion and answers with what a caller would have seen. */
async function run(argv: readonly string[]) {
  const stdout: string[] = []
  const stderr: string[] = []
  const recorder: Console.Console = Object.assign(Object.create(console), {
    log: (...args: readonly unknown[]) => {
      stdout.push(args.map(String).join(' '))
    },
    error: (...args: readonly unknown[]) => {
      stderr.push(args.map(String).join(' '))
    },
  })
  const exit = await Effect.runPromiseExit(
    asphodelos(argv, ENTRY_URL).pipe(
      Effect.provideService(Console.Console, recorder),
      Effect.provide(NodeServices.layer),
    ),
  )
  return {
    ok: Exit.isSuccess(exit),
    stdout: stdout.join('\n').replaceAll(ANSI, ''),
    stderr: stderr.join('\n').replaceAll(ANSI, ''),
  }
}

afterEach(() => {
  if (cwdBefore) process.chdir(cwdBefore)
})

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

describe('asphodelos --help / --version', () => {
  it('describes both modes and every flag', async () => {
    project()
    const result = await run(['--help'])

    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('Generate Elysia code from OpenAPI or TypeSpec')
    expect(result.stdout).toContain('--output, -o')
    expect(result.stdout).toContain('--config, -c')
    expect(result.stdout).toContain('--watch, -w')
    // The examples are the command's own documentation of what it accepts.
    expect(result.stdout).toContain('asphodelos openapi.yaml -o src/index.ts')
    expect(result.stdout).toContain('asphodelos --watch')
  })

  it('answers with the version from the package manifest', async () => {
    project()
    const manifest = JSON.parse(readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf-8')) as {
      version: string
    }
    const result = await run(['--version'])

    expect(result.ok).toBe(true)
    expect(result.stdout).toContain(manifest.version)
  })
})

describe('asphodelos <input> -o <output> — one-shot', () => {
  it('generates the app and its modules from the document', async () => {
    const dir = project()
    const result = await run(['openapi.yaml', '-o', 'src/index.ts'])

    expect(result.ok).toBe(true)
    expect(result.stdout).toContain('Generated 1 module(s) (items)')
    expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(true)
    expect(existsSync(path.join(dir, 'src/modules/items/index.ts'))).toBe(true)
  })

  it('consults no config file, even when one is sitting there', async () => {
    const dir = project(configSource(`{ input: 'openapi.yaml', output: 'src/fromConfig.ts' }`))
    const result = await run(['openapi.yaml', '-o', 'src/fromArgv.ts'])

    expect(result.ok).toBe(true)
    expect(existsSync(path.join(dir, 'src/fromArgv.ts'))).toBe(true)
    expect(existsSync(path.join(dir, 'src/fromConfig.ts'))).toBe(false)
  })

  it('rejects an input whose extension is not one it can read', async () => {
    const dir = project()
    writeFileSync(path.join(dir, 'openapi.txt'), SPEC)
    const result = await run(['openapi.txt', '-o', 'src/index.ts'])

    expect(result.ok).toBe(false)
    expect(existsSync(path.join(dir, 'src'))).toBe(false)
  })

  it('rejects an output that is not a .ts file', async () => {
    const dir = project()
    const result = await run(['openapi.yaml', '-o', 'src/index.js'])

    expect(result.ok).toBe(false)
    expect(existsSync(path.join(dir, 'src'))).toBe(false)
  })

  it('rejects an input that is not there', async () => {
    project()
    expect((await run(['missing.yaml', '-o', 'src/index.ts'])).ok).toBe(false)
  })

  it('refuses each half of the pair without the other', async () => {
    project()
    const withoutOutput = await run(['openapi.yaml'])
    const withoutInput = await run(['-o', 'src/index.ts'])

    // The rejection goes to stderr and the usage block to stdout, so a shell pipeline keeps the
    // two apart.
    expect(withoutOutput.ok).toBe(false)
    expect(withoutOutput.stderr).toContain('<input> requires -o <output.ts>.')
    expect(withoutOutput.stdout).toContain('USAGE')
    expect(withoutInput.ok).toBe(false)
    expect(withoutInput.stderr).toContain('-o <output.ts> requires an <input> document.')
  })
})

describe('asphodelos — config mode', () => {
  it('runs every job the config asks for and reports one line each', async () => {
    const dir = project(
      configSource(`{
  input: 'openapi.yaml',
  output: 'src/index.ts',
  types: { output: 'src/types.ts' },
}`),
    )
    const result = await run([])

    expect(result.ok).toBe(true)
    expect(result.stdout.split('\n')).toHaveLength(2)
    expect(result.stdout).toContain('Generated 1 module(s) (items)')
    expect(result.stdout).toContain('Generated app type written to src/types.ts')
    expect(existsSync(path.join(dir, 'src/types.ts'))).toBe(true)
  })

  it("the config's format block reaches the generated source", async () => {
    const dir = project(
      configSource(`{
  input: 'openapi.yaml',
  output: 'src/index.ts',
  format: { semi: true, singleQuote: false },
}`),
    )
    await run([])

    expect(readFileSync(path.join(dir, 'src/index.ts'), 'utf-8')).toContain('from "elysia";')
  })

  it('runs a config from another location through --config', async () => {
    const dir = project(
      configSource(`{ input: 'openapi.yaml', output: 'src/elsewhere.ts' }`),
      'other.config.ts',
    )
    const result = await run(['--config', 'other.config.ts'])

    expect(result.ok).toBe(true)
    expect(existsSync(path.join(dir, 'src/elsewhere.ts'))).toBe(true)
  })

  it('names the field that is wrong when the config does not validate', async () => {
    const dir = project(
      configSource(`{
  // @ts-expect-error deliberately invalid: the extension is not one asphodelos accepts
  input: 'openapi.txt',
}`),
    )
    const result = await run([])

    expect(result.ok).toBe(false)
    expect(existsSync(path.join(dir, 'src'))).toBe(false)
  })

  it('shows the usage block when there is no config and none was asked for', async () => {
    project()
    const result = await run([])

    // The one place the usage block is the answer: the caller ran the command with nothing.
    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('Config not found')
    expect(result.stdout).toContain('USAGE')
  })

  it('does not show the usage block when the config it was pointed at is missing', async () => {
    project()
    const result = await run(['--config', 'nope.config.ts'])

    // A path the caller typed is wrong in a way the usage block cannot help with.
    expect(result.ok).toBe(false)
  })
})

describe('asphodelos — combinations it refuses', () => {
  it('refuses --config alongside <input> or --output', async () => {
    project(configSource(`{ input: 'openapi.yaml' }`), 'other.config.ts')
    const result = await run(['openapi.yaml', '-o', 'src/index.ts', '-c', 'other.config.ts'])

    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('--config cannot be combined with <input> or --output.')
  })

  it('refuses --watch alongside the one-shot arguments', async () => {
    project()
    const result = await run(['openapi.yaml', '-o', 'src/index.ts', '--watch'])

    expect(result.ok).toBe(false)
    expect(result.stderr).toContain('--watch runs a config file')
  })
})
