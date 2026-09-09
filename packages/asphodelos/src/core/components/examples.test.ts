import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { examplesCode } from '../../generator/components/index.js'
import { runGenerator, runGeneratorError } from '../../testing/index.js'
import { examples } from './examples.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('examples — no-op paths', () => {
  it('returns error when examples is undefined', async () => {
    const result = await runGeneratorError(examples(undefined, '/ignored.ts', false))
    expect(result.message).toStrictEqual('No examples found')
  })

  it('returns success message when examples is empty', async () => {
    const result = await runGenerator(examples({}, '/ignored.ts', false))
    expect(result).toStrictEqual('No examples found')
  })
})

describe('examples — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-examples-'))
    const dir = tmpDir
    const output = path.join(dir, 'examples.ts')
    const sample = { Hello: { value: 'hi' }, World: { value: 'wat' } }
    const result = await runGenerator(examples(sample, output, false))
    expect(result).toStrictEqual(`Generated examples code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('examples — split mode', () => {
  it('writes one file per entry plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-examples-'))
    const dir = tmpDir
    const output = path.join(dir, 'examples.ts')
    const sample = { Hello: { value: 'hi' }, World: { value: 'wat' } }
    const result = await runGenerator(examples(sample, output, true))
    const outDir = path.join(dir, 'examples')
    expect(result).toStrictEqual(
      `Generated examples code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'hello.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'world.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('examples — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same Example const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-examples-'))
    const dir = tmpDir
    const output = path.join(dir, 'examples.ts')
    const sample = { Hello: { value: 'hi' }, World: { value: 'wat' } }
    await runGenerator(examples(sample, output, false))
    const emitted = fs.readFileSync(output, 'utf-8')
    const generated = examplesCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Example\s*=/g
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-entry file declares exactly one Example const that matches the generator output', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-examples-'))
    const dir = tmpDir
    const output = path.join(dir, 'examples.ts')
    const sample = { Hello: { value: 'hi' } }
    await runGenerator(examples(sample, output, true))
    const emitted = fs.readFileSync(path.join(dir, 'examples', 'hello.ts'), 'utf-8')
    const generated = examplesCode({ Hello: sample.Hello })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Example\s*=/g
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})
