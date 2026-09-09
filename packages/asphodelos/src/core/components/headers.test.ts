import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { headersCode } from '../../generator/components/index.js'
import { runGenerator, runGeneratorError } from '../../testing/index.js'
import { headers } from './headers.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('headers — no-op paths', () => {
  it('returns error when headers is undefined', async () => {
    const result = await runGeneratorError(headers(undefined, '/ignored.ts', false, false))
    expect(result.message).toStrictEqual('No headers found')
  })

  it('returns success message when headers is empty', async () => {
    const result = await runGenerator(headers({}, '/ignored.ts', false, false))
    expect(result).toStrictEqual('No headers found')
  })
})

describe('headers — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-headers-'))
    const dir = tmpDir
    const output = path.join(dir, 'headers.ts')
    const sample = {
      AuthHeader: { schema: { type: 'string' } },
      RateLimitHeader: { schema: { type: 'integer' } },
    } as const
    const result = await runGenerator(headers(sample, output, false, false))
    expect(result).toStrictEqual(`Generated headers code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('headers — split mode', () => {
  it('writes one file per entry plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-headers-'))
    const dir = tmpDir
    const output = path.join(dir, 'headers.ts')
    const sample = {
      AuthHeader: { schema: { type: 'string' } },
      RateLimitHeader: { schema: { type: 'integer' } },
    } as const
    const result = await runGenerator(headers(sample, output, true, false))
    const outDir = path.join(dir, 'headers')
    expect(result).toStrictEqual(
      `Generated headers code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'authHeader.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'rateLimitHeader.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('headers — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same Header const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-headers-'))
    const dir = tmpDir
    const output = path.join(dir, 'headers.ts')
    const sample = {
      AuthHeader: { schema: { type: 'string' } },
      RateLimitHeader: { schema: { type: 'integer' } },
    } as const
    await runGenerator(headers(sample, output, false, false))
    const emitted = fs.readFileSync(output, 'utf-8')
    const generated = headersCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)HeaderSchema\s*=/g
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-entry file declares exactly one Header const that matches the generator output', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-headers-'))
    const dir = tmpDir
    const output = path.join(dir, 'headers.ts')
    const sample = {
      AuthHeader: { schema: { type: 'string' } },
    } as const
    await runGenerator(headers(sample, output, true, false))
    const emitted = fs.readFileSync(path.join(dir, 'headers', 'authHeader.ts'), 'utf-8')
    const generated = headersCode({ AuthHeader: sample.AuthHeader })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)HeaderSchema\s*=/g
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})
