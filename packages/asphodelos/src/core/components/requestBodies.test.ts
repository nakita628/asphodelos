import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { requestBodiesCode } from '../../generator/components/index.js'
import { runGenerator, runGeneratorError } from '../../testing/index.js'
import { requestBodies } from './requestBodies.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('requestBodies — no-op paths', () => {
  it('returns error when requestBodies is undefined', async () => {
    const result = await runGeneratorError(requestBodies(undefined, '/ignored.ts', false, false))
    expect(result.message).toStrictEqual('No requestBodies found')
  })

  it('returns success message when requestBodies is empty', async () => {
    const result = await runGenerator(requestBodies({}, '/ignored.ts', false, false))
    expect(result).toStrictEqual('No requestBodies found')
  })
})

describe('requestBodies — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-requestBodies-'))
    const dir = tmpDir
    const output = path.join(dir, 'requestBodies.ts')
    const sample = {
      CreateUser: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        },
      },
      UpdateUser: {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { name: { type: 'string' } } },
          },
        },
      },
    } as const
    const result = await runGenerator(requestBodies(sample, output, false, false))
    expect(result).toStrictEqual(`Generated requestBodies code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('requestBodies — split mode', () => {
  it('writes one file per entry plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-requestBodies-'))
    const dir = tmpDir
    const output = path.join(dir, 'requestBodies.ts')
    const sample = {
      CreateUser: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        },
      },
      UpdateUser: {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { name: { type: 'string' } } },
          },
        },
      },
    } as const
    const result = await runGenerator(requestBodies(sample, output, true, false))
    const outDir = path.join(dir, 'requestBodies')
    expect(result).toStrictEqual(
      `Generated requestBodies code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'createUser.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'updateUser.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('requestBodies — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same RequestBody const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-requestBodies-'))
    const dir = tmpDir
    const output = path.join(dir, 'requestBodies.ts')
    const sample = {
      CreateUser: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        },
      },
      UpdateUser: {
        content: {
          'application/json': {
            schema: { type: 'object', properties: { name: { type: 'string' } } },
          },
        },
      },
    } as const
    await runGenerator(requestBodies(sample, output, false, false))
    const emitted = fs.readFileSync(output, 'utf-8')
    const generated = requestBodiesCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)RequestBodySchema\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-entry file declares exactly one RequestBody const that matches the generator output', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-requestBodies-'))
    const dir = tmpDir
    const output = path.join(dir, 'requestBodies.ts')
    const sample = {
      CreateUser: {
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { name: { type: 'string' } },
              required: ['name'],
            },
          },
        },
      },
    } as const
    await runGenerator(requestBodies(sample, output, true, false))
    const emitted = fs.readFileSync(path.join(dir, 'requestBodies', 'createUser.ts'), 'utf-8')
    const generated = requestBodiesCode({ CreateUser: sample.CreateUser })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)RequestBodySchema\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})
