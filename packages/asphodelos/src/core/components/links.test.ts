import { afterEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Effect } from 'effect'

import { fileSystemLayer } from '../../fsp/index.js'
import { linksCode } from '../../generator/components/index.js'
import { links } from './links.js'

let tmpDir: string | undefined
afterEach(() => {
  if (tmpDir) {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    tmpDir = undefined
  }
})

describe('links — no-op paths', () => {
  it('returns error when links is undefined', async () => {
    const result = await Effect.runPromise(
      links(undefined, '/ignored.ts', false).pipe(Effect.provide(fileSystemLayer), Effect.flip),
    )
    expect(result.message).toStrictEqual('No links found')
  })

  it('returns success message when links is empty', async () => {
    const result = await Effect.runPromise(
      links({}, '/ignored.ts', false).pipe(Effect.provide(fileSystemLayer)),
    )
    expect(result).toStrictEqual('No links found')
  })
})

describe('links — non-split mode', () => {
  it('writes a single file containing all entries', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-links-'))
    const dir = tmpDir
    const output = path.join(dir, 'links.ts')
    const sample = {
      GetUser: { operationId: 'getUser' },
      GetPost: { operationId: 'getPost' },
    }
    const result = await Effect.runPromise(
      links(sample, output, false).pipe(Effect.provide(fileSystemLayer)),
    )
    expect(result).toStrictEqual(`Generated links code written to ${output}`)
    expect(fs.existsSync(output)).toBe(true)
  })
})

describe('links — split mode', () => {
  it('writes one file per entry plus an index.ts barrel', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-links-'))
    const dir = tmpDir
    const output = path.join(dir, 'links.ts')
    const sample = {
      GetUser: { operationId: 'getUser' },
      GetPost: { operationId: 'getPost' },
    }
    const result = await Effect.runPromise(
      links(sample, output, true).pipe(Effect.provide(fileSystemLayer)),
    )
    const outDir = path.join(dir, 'links')
    expect(result).toStrictEqual(
      `Generated links code written to ${outDir}/*.ts (index.ts included)`,
    )
    expect(fs.existsSync(path.join(outDir, 'getUser.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'getPost.ts'))).toBe(true)
    expect(fs.existsSync(path.join(outDir, 'index.ts'))).toBe(true)
  })
})

describe('links — caller ≡ generator contract', () => {
  it('non-split: emitted file declares the same Link const names as the generator', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-links-'))
    const dir = tmpDir
    const output = path.join(dir, 'links.ts')
    const sample = {
      GetUser: { operationId: 'getUser' },
      GetPost: { operationId: 'getPost' },
    }
    await Effect.runPromise(links(sample, output, false).pipe(Effect.provide(fileSystemLayer)))
    const emitted = fs.readFileSync(output, 'utf8')
    const generated = linksCode(sample)
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Link\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })

  it('split: per-entry file declares exactly one Link const that matches the generator output', async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-links-'))
    const dir = tmpDir
    const output = path.join(dir, 'links.ts')
    const sample = { GetUser: { operationId: 'getUser' } }
    await Effect.runPromise(links(sample, output, true).pipe(Effect.provide(fileSystemLayer)))
    const emitted = fs.readFileSync(path.join(dir, 'links', 'getUser.ts'), 'utf8')
    const generated = linksCode({ GetUser: sample.GetUser })
    const re = /(?:export\s+)?const\s+([A-Za-z_$][A-Za-z0-9_$]*)Link\s*=/gu
    const emittedNames = new Set([...emitted.matchAll(re)].map((m) => m[1]))
    const generatedNames = new Set([...generated.matchAll(re)].map((m) => m[1]))
    expect(emittedNames).toStrictEqual(generatedNames)
  })
})

describe('links — a referenced schema named like another component kind', () => {
  const section = {
    Next: { operationId: 'listUsers', requestBody: { $ref: '#/components/schemas/SearchParams' } },
  } as const

  it.each([
    { mode: 'non-split', split: false, file: 'links.ts', specifier: './schemas' },
    { mode: 'split', split: true, file: 'links/next.ts', specifier: '../schemas' },
  ])('$mode: imports SearchParamsSchema from the schemas', async ({ split, file, specifier }) => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-links-'))
    const output = path.join(tmpDir, 'links.ts')
    await Effect.runPromise(links(section, output, split).pipe(Effect.provide(fileSystemLayer)))
    const emitted = fs.readFileSync(path.join(tmpDir, file), 'utf8')
    expect(emitted).toContain(`import { SearchParamsSchema } from '${specifier}'`)
    expect(emitted).not.toContain('parameters')
  })
})
