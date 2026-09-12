import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { mediaTypesCode } from '../../generator/components/index.js'
import { runGenerator, runGeneratorError } from '../../testing/index.js'
import { mediaTypes } from './mediaTypes.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('mediaTypes — no-op paths', () => {
  it('returns error when mediaTypes is undefined', async () => {
    const result = await runGeneratorError(mediaTypes(undefined, '/ignored.ts', false, false))
    expect(result.message).toStrictEqual('No mediaTypes found')
  })

  it('returns success message when mediaTypes is empty', async () => {
    const result = await runGenerator(mediaTypes({}, '/ignored.ts', false, false))
    expect(result).toStrictEqual('No mediaTypes found')
  })
})

describe('mediaTypes — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-mediaTypes-'))
    const dir = tmpDir
    const output = path.join(dir, 'mediaTypes.ts')
    const sample = {
      Json: { schema: { type: 'string' } },
      Xml: { schema: { type: 'string' } },
    } as const
    const result = await runGenerator(mediaTypes(sample, output, false, false))
    expect(result).toStrictEqual(`Generated mediaTypes code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('mediaTypes — split mode', () => {
  it('writes one file per entry plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-mediaTypes-'))
    const dir = tmpDir
    const output = path.join(dir, 'mediaTypes.ts')
    const sample = {
      Json: { schema: { type: 'string' } },
      Xml: { schema: { type: 'string' } },
    } as const
    const result = await runGenerator(mediaTypes(sample, output, true, false))
    const outDir = path.join(dir, 'mediaTypes')
    expect(result).toStrictEqual(
      `Generated mediaTypes code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'json.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'xml.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('mediaTypes — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same MediaType const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-mediaTypes-'))
    const dir = tmpDir
    const output = path.join(dir, 'mediaTypes.ts')
    const sample = {
      Json: { schema: { type: 'string' } },
      Xml: { schema: { type: 'string' } },
    } as const
    await runGenerator(mediaTypes(sample, output, false, false))
    const emitted = fs.readFileSync(output, 'utf-8')
    const generated = mediaTypesCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)MediaTypeSchema\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-entry file declares exactly one MediaType const that matches the generator output', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-mediaTypes-'))
    const dir = tmpDir
    const output = path.join(dir, 'mediaTypes.ts')
    const sample = {
      Json: { schema: { type: 'string' } },
    } as const
    await runGenerator(mediaTypes(sample, output, true, false))
    const emitted = fs.readFileSync(path.join(dir, 'mediaTypes', 'json.ts'), 'utf-8')
    const generated = mediaTypesCode({ Json: sample.Json })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)MediaTypeSchema\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})
