import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { responsesCode } from '../../generator/components/index.js'
import { runGenerator, runGeneratorError } from '../../testing/index.js'
import { responses } from './responses.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('responses — no-op paths', () => {
  it('returns error when responses is undefined', async () => {
    const result = await runGeneratorError(responses(undefined, '/ignored.ts', false, false))
    expect(result.message).toStrictEqual('No responses found')
  })

  it('returns success message when responses is empty', async () => {
    const result = await runGenerator(responses({}, '/ignored.ts', false, false))
    expect(result).toStrictEqual('No responses found')
  })
})

describe('responses — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-responses-'))
    const output = path.join(tmpDir, 'responses.ts')
    const sample = { NotFound: { description: 'Not Found' }, Ok: { description: 'OK' } }
    const result = await runGenerator(responses(sample, output, false, false))
    expect(result).toStrictEqual(`Generated responses code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('responses — split mode', () => {
  it('writes one file per entry plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-responses-'))
    const output = path.join(tmpDir, 'responses.ts')
    const sample = { NotFound: { description: 'Not Found' }, Ok: { description: 'OK' } }
    const result = await runGenerator(responses(sample, output, true, false))
    const outDir = path.join(tmpDir, 'responses')
    expect(result).toStrictEqual(
      `Generated responses code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'notFound.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'ok.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('responses — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same Response const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-responses-'))
    const output = path.join(tmpDir, 'responses.ts')
    const sample = { NotFound: { description: 'Not Found' }, Ok: { description: 'OK' } }
    await runGenerator(responses(sample, output, false, false))
    const emitted = fs.readFileSync(output, 'utf-8')
    const generated = responsesCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)ResponseSchema\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-entry file declares exactly one Response const that matches the generator output', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-responses-'))
    const output = path.join(tmpDir, 'responses.ts')
    const sample = { NotFound: { description: 'Not Found' } }
    await runGenerator(responses(sample, output, true, false))
    const emitted = fs.readFileSync(path.join(tmpDir, 'responses', 'notFound.ts'), 'utf-8')
    const generated = responsesCode({ NotFound: sample.NotFound })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)ResponseSchema\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})
