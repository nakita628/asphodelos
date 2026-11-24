import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Effect } from 'effect'

import { fileSystemLayer } from '../../fsp/index.js'
import { schemasCode } from '../../generator/components/index.js'
import { schemas } from './schemas.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('schemas — no-op paths', () => {
  it('returns error when schemas is undefined', async () => {
    const result = await Effect.runPromise(
      schemas(undefined, '/ignored.ts', false, false).pipe(
        Effect.provide(fileSystemLayer),
        Effect.flip,
      ),
    )
    expect(result.message).toStrictEqual('No schemas found')
  })

  it('returns success message when schemas is empty', async () => {
    const result = await Effect.runPromise(
      schemas({}, '/ignored.ts', false, false).pipe(Effect.provide(fileSystemLayer)),
    )
    expect(result).toStrictEqual('No schemas found')
  })
})

describe('schemas — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-schemas-'))
    const output = path.join(tmpDir, 'schemas.ts')
    const sample = {
      User: { type: 'object', properties: { id: { type: 'string' } } },
      Post: { type: 'object', properties: { title: { type: 'string' } } },
    } as const
    const result = await Effect.runPromise(
      schemas(sample, output, false, false).pipe(Effect.provide(fileSystemLayer)),
    )
    expect(result).toStrictEqual(`Generated schemas code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('schemas — split mode', () => {
  it('writes one file per SCC plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-schemas-'))
    const output = path.join(tmpDir, 'schemas.ts')
    const sample = {
      User: { type: 'object', properties: { id: { type: 'string' } } },
      Post: { type: 'object', properties: { title: { type: 'string' } } },
    } as const
    const result = await Effect.runPromise(
      schemas(sample, output, true, false).pipe(Effect.provide(fileSystemLayer)),
    )
    const outDir = path.join(tmpDir, 'schemas')
    expect(result).toStrictEqual(
      `Generated schemas code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'user.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'post.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('schemas — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same Schema const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-schemas-'))
    const output = path.join(tmpDir, 'schemas.ts')
    const sample = {
      User: { type: 'object', properties: { id: { type: 'string' } } },
      Post: { type: 'object', properties: { title: { type: 'string' } } },
    } as const
    await Effect.runPromise(
      schemas(sample, output, false, false).pipe(Effect.provide(fileSystemLayer)),
    )
    const emitted = fs.readFileSync(output, 'utf8')
    const generated = schemasCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Schema\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-SCC file declares exactly the Schema const for that SCC member', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-schemas-'))
    const output = path.join(tmpDir, 'schemas.ts')
    const sample = {
      User: { type: 'object', properties: { id: { type: 'string' } } },
    } as const
    await Effect.runPromise(
      schemas(sample, output, true, false).pipe(Effect.provide(fileSystemLayer)),
    )
    const emitted = fs.readFileSync(path.join(tmpDir, 'schemas', 'user.ts'), 'utf8')
    const generated = schemasCode({ User: sample.User })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Schema\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})

describe('schemas — split mode, a sibling named like another component kind', () => {
  it('imports a schema named `ErrorResponse` from its own file only', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-schemas-'))
    const output = path.join(tmpDir, 'schemas.ts')
    const sample = {
      Wrapper: {
        type: 'object',
        properties: { error: { $ref: '#/components/schemas/ErrorResponse' } },
      },
      ErrorResponse: { type: 'object', properties: { message: { type: 'string' } } },
    } as const
    await Effect.runPromise(
      schemas(sample, output, true, false).pipe(Effect.provide(fileSystemLayer)),
    )
    const emitted = fs.readFileSync(path.join(tmpDir, 'schemas', 'wrapper.ts'), 'utf8')
    expect(emitted).toStrictEqual(
      `import { t } from 'elysia'\nimport { ErrorResponseSchema } from './errorResponse'\n\nexport const WrapperSchema = t.Object({ error: t.Optional(ErrorResponseSchema) })\n`,
    )
  })
})

// Keys that differ only in case share a pascal-cased name. The names are resolved over the whole
// document, as in a single file, so every file exports a const of its own, is written under a
// name of its own, and the barrel exports each name once.
describe('schemas — split mode, keys that differ only in case', () => {
  const generate = async (sample: Parameters<typeof schemas>[0]) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-schemas-'))
    await Effect.runPromise(
      schemas(sample, path.join(tmpDir, 'schemas.ts'), true, true).pipe(
        Effect.provide(fileSystemLayer),
      ),
    )
    const dir = path.join(tmpDir, 'schemas')
    return Object.fromEntries(
      fs
        .readdirSync(dir)
        .toSorted()
        .map((file) => [file, fs.readFileSync(path.join(dir, file), 'utf8')] as const),
    )
  }

  it('writes `User` and `user` to files of their own, under consts of their own', async () => {
    const files = await generate({
      User: { type: 'object', properties: { id: { type: 'string' } } },
      user: { type: 'object', properties: { id: { type: 'integer' } } },
    })
    expect(Object.keys(files)).toStrictEqual(['index.ts', 'user.ts', 'user2.ts'])
    expect(files['user.ts']).toContain(
      'export const UserSchema = t.Object({ id: t.Optional(t.String()) })',
    )
    expect(files['user.ts']).toContain('export type User = Static<typeof UserSchema>')
    expect(files['user2.ts']).toContain('export const User2Schema = t.Object({')
    expect(files['user2.ts']).toContain('export type User2 = Static<typeof User2Schema>')
    expect(files['index.ts']).toBe("export * from './user'\nexport * from './user2'\n")
  })

  it('exports `UserProfile` and `user_profile` under different names', async () => {
    const files = await generate({
      UserProfile: { type: 'string' },
      user_profile: { type: 'number' },
    })
    expect(Object.keys(files)).toStrictEqual(['index.ts', 'userProfile.ts', 'userProfile2.ts'])
    expect(files['userProfile.ts']).toContain('export const UserProfileSchema = t.String()')
    expect(files['userProfile2.ts']).toContain('export const UserProfile2Schema = t.Number()')
  })

  it('imports a colliding key from its file, by the const written for it', async () => {
    const files = await generate({
      User: { type: 'string' },
      user: { type: 'number' },
      Pet: {
        type: 'object',
        properties: {
          owner: { $ref: '#/components/schemas/User' },
          account: { $ref: '#/components/schemas/user' },
        },
      },
    })
    expect(files['pet.ts']).toContain("import { UserSchema } from './user'")
    expect(files['pet.ts']).toContain("import { User2Schema } from './user2'")
    expect(files['pet.ts']).toContain('owner: t.Optional(UserSchema)')
    expect(files['pet.ts']).toContain('account: t.Optional(User2Schema)')
  })
})
