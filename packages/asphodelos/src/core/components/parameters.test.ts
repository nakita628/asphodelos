import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { parametersCode } from '../../generator/components/index.js'
import { runGenerator, runGeneratorError } from '../../testing/index.js'
import { parameters } from './parameters.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('parameters — no-op paths', () => {
  it('returns error when parameters is undefined', async () => {
    const result = await runGeneratorError(parameters(undefined, '/ignored.ts', false, false))
    expect(result.message).toStrictEqual('No parameters found')
  })

  it('returns success message when parameters is empty', async () => {
    const result = await runGenerator(parameters({}, '/ignored.ts', false, false))
    expect(result).toStrictEqual('No parameters found')
  })
})

describe('parameters — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-parameters-'))
    const dir = tmpDir
    const output = path.join(dir, 'parameters.ts')
    const sample = {
      IdParam: { name: 'id', in: 'path', schema: { type: 'string' } },
      NameParam: { name: 'name', in: 'query', schema: { type: 'string' } },
    } as const
    const result = await runGenerator(parameters(sample, output, false, false))
    expect(result).toStrictEqual(`Generated parameters code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('parameters — split mode', () => {
  it('writes one file per entry plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-parameters-'))
    const dir = tmpDir
    const output = path.join(dir, 'parameters.ts')
    const sample = {
      IdParam: { name: 'id', in: 'path', schema: { type: 'string' } },
      NameParam: { name: 'name', in: 'query', schema: { type: 'string' } },
    } as const
    const result = await runGenerator(parameters(sample, output, true, false))
    const outDir = path.join(dir, 'parameters')
    expect(result).toStrictEqual(
      `Generated parameters code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'idParam.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'nameParam.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('parameters — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same Params const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-parameters-'))
    const dir = tmpDir
    const output = path.join(dir, 'parameters.ts')
    const sample = {
      IdParam: { name: 'id', in: 'path', schema: { type: 'string' } },
      NameParam: { name: 'name', in: 'query', schema: { type: 'string' } },
    } as const
    await runGenerator(parameters(sample, output, false, false))
    const emitted = fs.readFileSync(output, 'utf-8')
    const generated = parametersCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)ParamsSchema\s*=/g
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-entry file declares exactly one Params const that matches the generator output', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-parameters-'))
    const dir = tmpDir
    const output = path.join(dir, 'parameters.ts')
    const sample = {
      IdParam: { name: 'id', in: 'path', schema: { type: 'string' } },
    } as const
    await runGenerator(parameters(sample, output, true, false))
    const emitted = fs.readFileSync(path.join(dir, 'parameters', 'idParam.ts'), 'utf-8')
    const generated = parametersCode({ IdParam: sample.IdParam })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)ParamsSchema\s*=/g
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})
