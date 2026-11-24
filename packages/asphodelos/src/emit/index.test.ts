import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { Effect } from 'effect'

import { fileSystemLayer } from '../fsp/index.js'
import { emit } from './index.js'

describe('emit', () => {
  const testDir = 'tmp-emit-test'
  beforeEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
    fs.mkdirSync(testDir, { recursive: true })
  })
  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })
  it('should format, create directory, and write file successfully', async () => {
    await Effect.runPromise(
      emit('console.log("Hello, world!")', testDir, `${testDir}/test.ts`).pipe(
        Effect.provide(fileSystemLayer),
      ),
    )
    expect(fs.existsSync(`${testDir}/test.ts`)).toBe(true)
  })
  it('should create nested directories', async () => {
    const nestedDir = `${testDir}/a/b/c`
    await Effect.runPromise(
      emit('const x = 1', nestedDir, `${nestedDir}/out.ts`).pipe(Effect.provide(fileSystemLayer)),
    )
    expect(fs.existsSync(`${nestedDir}/out.ts`)).toBe(true)
  })
  it('should return error when write fails on read-only path', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'emit-readonly-'))
    const readonlyDir = path.join(tmpDir, 'readonly')
    fs.mkdirSync(readonlyDir)
    fs.chmodSync(readonlyDir, 0o444)
    const result = await Effect.runPromise(
      emit('const x = 1', readonlyDir, `${readonlyDir}/sub/out.ts`).pipe(
        Effect.provide(fileSystemLayer),
        Effect.flip,
      ),
    )
    expect(result).toBeDefined()

    fs.chmodSync(readonlyDir, 0o755)
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })
})
