import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { pathItemsCode } from '../../generator/components/index.js'
import { runGenerator, runGeneratorError } from '../../testing/index.js'
import { pathItems } from './pathItems.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('pathItems — no-op paths', () => {
  it('returns error when pathItems is undefined', async () => {
    const result = await runGeneratorError(pathItems(undefined, '/ignored.ts', false))
    expect(result.message).toStrictEqual('No pathItems found')
  })

  it('returns success message when pathItems is empty', async () => {
    const result = await runGenerator(pathItems({}, '/ignored.ts', false))
    expect(result).toStrictEqual('No pathItems found')
  })
})

describe('pathItems — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-pathItems-'))
    const dir = tmpDir
    const output = path.join(dir, 'pathItems.ts')
    const sample = {
      Health: { get: { responses: { '200': { description: 'ok' } } } },
      Ready: { get: { responses: { '200': { description: 'ok' } } } },
    }
    const result = await runGenerator(pathItems(sample, output, false))
    expect(result).toStrictEqual(`Generated pathItems code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('pathItems — split mode', () => {
  it('writes one file per entry plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-pathItems-'))
    const dir = tmpDir
    const output = path.join(dir, 'pathItems.ts')
    const sample = {
      Health: { get: { responses: { '200': { description: 'ok' } } } },
      Ready: { get: { responses: { '200': { description: 'ok' } } } },
    }
    const result = await runGenerator(pathItems(sample, output, true))
    const outDir = path.join(dir, 'pathItems')
    expect(result).toStrictEqual(
      `Generated pathItems code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'health.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'ready.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('pathItems — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same PathItem const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-pathItems-'))
    const dir = tmpDir
    const output = path.join(dir, 'pathItems.ts')
    const sample = {
      Health: { get: { responses: { '200': { description: 'ok' } } } },
      Ready: { get: { responses: { '200': { description: 'ok' } } } },
    }
    await runGenerator(pathItems(sample, output, false))
    const emitted = fs.readFileSync(output, 'utf-8')
    const generated = pathItemsCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)PathItem\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-entry file declares exactly one PathItem const that matches the generator output', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-pathItems-'))
    const dir = tmpDir
    const output = path.join(dir, 'pathItems.ts')
    const sample = {
      Health: { get: { responses: { '200': { description: 'ok' } } } },
    }
    await runGenerator(pathItems(sample, output, true))
    const emitted = fs.readFileSync(path.join(dir, 'pathItems', 'health.ts'), 'utf-8')
    const generated = pathItemsCode({ Health: sample.Health })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)PathItem\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})
