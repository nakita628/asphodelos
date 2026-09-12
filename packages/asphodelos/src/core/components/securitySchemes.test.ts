import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { securitySchemesCode } from '../../generator/components/index.js'
import { runGenerator, runGeneratorError } from '../../testing/index.js'
import { securitySchemes } from './securitySchemes.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('securitySchemes — no-op paths', () => {
  it('returns error when securitySchemes is undefined', async () => {
    const result = await runGeneratorError(securitySchemes(undefined, '/ignored.ts', false))
    expect(result.message).toStrictEqual('No securitySchemes found')
  })

  it('returns success message when securitySchemes is empty', async () => {
    const result = await runGenerator(securitySchemes({}, '/ignored.ts', false))
    expect(result).toStrictEqual('No securitySchemes found')
  })
})

describe('securitySchemes — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-securitySchemes-'))
    const dir = tmpDir
    const output = path.join(dir, 'securitySchemes.ts')
    const sample = {
      ApiKey: { type: 'apiKey', name: 'X-Api-Key', in: 'header' },
      Bearer: { type: 'http', scheme: 'bearer' },
    }
    const result = await runGenerator(securitySchemes(sample, output, false))
    expect(result).toStrictEqual(`Generated securitySchemes code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('securitySchemes — split mode', () => {
  it('writes one file per entry plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-securitySchemes-'))
    const dir = tmpDir
    const output = path.join(dir, 'securitySchemes.ts')
    const sample = {
      ApiKey: { type: 'apiKey', name: 'X-Api-Key', in: 'header' },
      Bearer: { type: 'http', scheme: 'bearer' },
    }
    const result = await runGenerator(securitySchemes(sample, output, true))
    const outDir = path.join(dir, 'securitySchemes')
    expect(result).toStrictEqual(
      `Generated securitySchemes code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'apiKey.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'bearer.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('securitySchemes — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same SecurityScheme const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-securitySchemes-'))
    const dir = tmpDir
    const output = path.join(dir, 'securitySchemes.ts')
    const sample = {
      ApiKey: { type: 'apiKey', name: 'X-Api-Key', in: 'header' },
      Bearer: { type: 'http', scheme: 'bearer' },
    }
    await runGenerator(securitySchemes(sample, output, false))
    const emitted = fs.readFileSync(output, 'utf-8')
    const generated = securitySchemesCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)SecurityScheme\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-entry file declares exactly one SecurityScheme const that matches the generator output', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-securitySchemes-'))
    const dir = tmpDir
    const output = path.join(dir, 'securitySchemes.ts')
    const sample = {
      ApiKey: { type: 'apiKey', name: 'X-Api-Key', in: 'header' },
    }
    await runGenerator(securitySchemes(sample, output, true))
    const emitted = fs.readFileSync(path.join(dir, 'securitySchemes', 'apiKey.ts'), 'utf-8')
    const generated = securitySchemesCode({ ApiKey: sample.ApiKey })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)SecurityScheme\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})
