import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { callbacksCode } from '../../generator/components/index.js'
import { runGenerator, runGeneratorError } from '../../testing/index.js'
import { callbacks } from './callbacks.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('callbacks — no-op paths', () => {
  it('returns error when callbacks is undefined', async () => {
    const result = await runGeneratorError(callbacks(undefined, '/ignored.ts', false))
    expect(result.message).toStrictEqual('No callbacks found')
  })

  it('returns success message when callbacks is empty', async () => {
    const result = await runGenerator(callbacks({}, '/ignored.ts', false))
    expect(result).toStrictEqual('No callbacks found')
  })
})

describe('callbacks — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-callbacks-'))
    const dir = tmpDir
    const output = path.join(dir, 'callbacks.ts')
    const sample = {
      Cb1: {
        '{$request.body#/url}': { post: { responses: { '200': { description: 'ok' } } } },
      },
      Cb2: {
        '{$request.body#/url}': { post: { responses: { '200': { description: 'ok' } } } },
      },
    }
    const result = await runGenerator(callbacks(sample, output, false))
    expect(result).toStrictEqual(`Generated callbacks code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('callbacks — split mode', () => {
  it('writes one file per entry plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-callbacks-'))
    const dir = tmpDir
    const output = path.join(dir, 'callbacks.ts')
    const sample = {
      Cb1: {
        '{$request.body#/url}': { post: { responses: { '200': { description: 'ok' } } } },
      },
      Cb2: {
        '{$request.body#/url}': { post: { responses: { '200': { description: 'ok' } } } },
      },
    }
    const result = await runGenerator(callbacks(sample, output, true))
    const outDir = path.join(dir, 'callbacks')
    expect(result).toStrictEqual(
      `Generated callbacks code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'cb1.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'cb2.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('callbacks — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same Callback const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-callbacks-'))
    const dir = tmpDir
    const output = path.join(dir, 'callbacks.ts')
    const sample = {
      Cb1: {
        '{$request.body#/url}': { post: { responses: { '200': { description: 'ok' } } } },
      },
      Cb2: {
        '{$request.body#/url}': { post: { responses: { '200': { description: 'ok' } } } },
      },
    }
    await runGenerator(callbacks(sample, output, false))
    const emitted = fs.readFileSync(output, 'utf-8')
    const generated = callbacksCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Callback\s*=/g
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-entry file declares exactly one Callback const that matches the generator output', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-callbacks-'))
    const dir = tmpDir
    const output = path.join(dir, 'callbacks.ts')
    const sample = {
      Cb1: {
        '{$request.body#/url}': { post: { responses: { '200': { description: 'ok' } } } },
      },
    }
    await runGenerator(callbacks(sample, output, true))
    const emitted = fs.readFileSync(path.join(dir, 'callbacks', 'cb1.ts'), 'utf-8')
    const generated = callbacksCode({ Cb1: sample.Cb1 })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Callback\s*=/g
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})
