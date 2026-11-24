import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Effect } from 'effect'

import { fileSystemLayer } from '../../fsp/index.js'
import { requestBodiesCode } from '../../generator/components/index.js'
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
    const result = await Effect.runPromise(
      requestBodies(undefined, '/ignored.ts', false, false).pipe(
        Effect.provide(fileSystemLayer),
        Effect.flip,
      ),
    )
    expect(result.message).toStrictEqual('No requestBodies found')
  })

  it('returns success message when requestBodies is empty', async () => {
    const result = await Effect.runPromise(
      requestBodies({}, '/ignored.ts', false, false).pipe(Effect.provide(fileSystemLayer)),
    )
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
    const result = await Effect.runPromise(
      requestBodies(sample, output, false, false).pipe(Effect.provide(fileSystemLayer)),
    )
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
    const result = await Effect.runPromise(
      requestBodies(sample, output, true, false).pipe(Effect.provide(fileSystemLayer)),
    )
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
    await Effect.runPromise(
      requestBodies(sample, output, false, false).pipe(Effect.provide(fileSystemLayer)),
    )
    const emitted = fs.readFileSync(output, 'utf8')
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
    await Effect.runPromise(
      requestBodies(sample, output, true, false).pipe(Effect.provide(fileSystemLayer)),
    )
    const emitted = fs.readFileSync(path.join(dir, 'requestBodies', 'createUser.ts'), 'utf8')
    const generated = requestBodiesCode({ CreateUser: sample.CreateUser })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)RequestBodySchema\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})

describe('requestBodies — a referenced schema named like another component kind', () => {
  const section = {
    NewUser: {
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/CreateUserRequestBody' } },
      },
    },
  } as const

  it.each([
    { mode: 'non-split', split: false, file: 'requestBodies.ts', specifier: './schemas' },
    { mode: 'split', split: true, file: 'requestBodies/newUser.ts', specifier: '../schemas' },
  ])(
    '$mode: imports CreateUserRequestBodySchema from the schemas',
    async ({ split, file, specifier }) => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-request-bodies-'))
      const output = path.join(tmpDir, 'requestBodies.ts')
      await Effect.runPromise(
        requestBodies(section, output, split, false).pipe(Effect.provide(fileSystemLayer)),
      )
      expect(fs.readFileSync(path.join(tmpDir, file), 'utf8')).toStrictEqual(
        `import { CreateUserRequestBodySchema } from '${specifier}'\n\nexport const NewUserRequestBodySchema = CreateUserRequestBodySchema\n`,
      )
    },
  )
})
