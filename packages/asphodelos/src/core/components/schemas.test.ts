import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { schemasCode } from '../../generator/components/index.js'
import { runGenerator, runGeneratorError } from '../../testing/index.js'
import { schemas } from './schemas.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('schemas — no-op paths', () => {
  it('returns error when schemas is undefined', async () => {
    const result = await runGeneratorError(schemas(undefined, '/ignored.ts', false, false))
    expect(result.message).toStrictEqual('No schemas found')
  })

  it('returns success message when schemas is empty', async () => {
    const result = await runGenerator(schemas({}, '/ignored.ts', false, false))
    expect(result).toStrictEqual('No schemas found')
  })
})

describe('schemas — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-schemas-'))
    const output = path.join(tmpDir, 'schemas.ts')
    const sample = {
      User: { type: 'object', properties: { id: { type: 'string' } } },
      Post: { type: 'object', properties: { title: { type: 'string' } } },
    } as const
    const result = await runGenerator(schemas(sample, output, false, false))
    expect(result).toStrictEqual(`Generated schemas code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('schemas — split mode', () => {
  it('writes one file per SCC plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-schemas-'))
    const output = path.join(tmpDir, 'schemas.ts')
    const sample = {
      User: { type: 'object', properties: { id: { type: 'string' } } },
      Post: { type: 'object', properties: { title: { type: 'string' } } },
    } as const
    const result = await runGenerator(schemas(sample, output, true, false))
    const outDir = path.join(tmpDir, 'schemas')
    expect(result).toStrictEqual(
      `Generated schemas code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'user.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'post.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('schemas — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same Schema const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-schemas-'))
    const output = path.join(tmpDir, 'schemas.ts')
    const sample = {
      User: { type: 'object', properties: { id: { type: 'string' } } },
      Post: { type: 'object', properties: { title: { type: 'string' } } },
    } as const
    await runGenerator(schemas(sample, output, false, false))
    const emitted = fs.readFileSync(output, 'utf-8')
    const generated = schemasCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Schema\s*=/g
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-SCC file declares exactly the Schema const for that SCC member', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-schemas-'))
    const output = path.join(tmpDir, 'schemas.ts')
    const sample = {
      User: { type: 'object', properties: { id: { type: 'string' } } },
    } as const
    await runGenerator(schemas(sample, output, true, false))
    const emitted = fs.readFileSync(path.join(tmpDir, 'schemas', 'user.ts'), 'utf-8')
    const generated = schemasCode({ User: sample.User })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Schema\s*=/g
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})
