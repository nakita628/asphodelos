import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Effect } from 'effect'

import { fileSystemLayer } from '../../fsp/index.js'
import { examplesCode } from '../../generator/components/index.js'
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
    const result = await Effect.runPromise(
      examples(undefined, '/ignored.ts', false).pipe(Effect.provide(fileSystemLayer), Effect.flip),
    )
    expect(result.message).toStrictEqual('No examples found')
  })

  it('returns success message when examples is empty', async () => {
    const result = await Effect.runPromise(
      examples({}, '/ignored.ts', false).pipe(Effect.provide(fileSystemLayer)),
    )
    expect(result).toStrictEqual('No examples found')
  })
})

describe('examples — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-examples-'))
    const dir = tmpDir
    const output = path.join(dir, 'examples.ts')
    const sample = { Hello: { value: 'hi' }, World: { value: 'wat' } }
    const result = await Effect.runPromise(
      examples(sample, output, false).pipe(Effect.provide(fileSystemLayer)),
    )
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
    const result = await Effect.runPromise(
      examples(sample, output, true).pipe(Effect.provide(fileSystemLayer)),
    )
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
    await Effect.runPromise(examples(sample, output, false).pipe(Effect.provide(fileSystemLayer)))
    const emitted = fs.readFileSync(output, 'utf8')
    const generated = examplesCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Example\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-entry file declares exactly one Example const that matches the generator output', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-examples-'))
    const dir = tmpDir
    const output = path.join(dir, 'examples.ts')
    const sample = { Hello: { value: 'hi' } }
    await Effect.runPromise(examples(sample, output, true).pipe(Effect.provide(fileSystemLayer)))
    const emitted = fs.readFileSync(path.join(dir, 'examples', 'hello.ts'), 'utf8')
    const generated = examplesCode({ Hello: sample.Hello })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Example\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})

describe('examples — a referenced schema named like another component kind', () => {
  const section = {
    Failure: { value: { error: { $ref: '#/components/schemas/ErrorResponse' } } },
  } as const

  it.each([
    { mode: 'non-split', split: false, file: 'examples.ts', specifier: './schemas' },
    { mode: 'split', split: true, file: 'examples/failure.ts', specifier: '../schemas' },
  ])('$mode: imports ErrorResponseSchema from the schemas', async ({ split, file, specifier }) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-examples-'))
    const output = path.join(tmpDir, 'examples.ts')
    await Effect.runPromise(examples(section, output, split).pipe(Effect.provide(fileSystemLayer)))
    const emitted = fs.readFileSync(path.join(tmpDir, file), 'utf8')
    expect(emitted).toContain(`import { ErrorResponseSchema } from '${specifier}'`)
    expect(emitted).not.toContain('responses')
  })
})
