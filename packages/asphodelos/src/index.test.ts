import { describe, expect, it } from 'bun:test'
import { execSync } from 'node:child_process'
import path from 'node:path'

describe('asphodelos CLI binary', () => {
  const entry = path.resolve(import.meta.dir, 'index.ts')

  it('--help prints help text and exits 0', () => {
    const out = execSync(`bun run ${entry} --help`, { encoding: 'utf-8' })
    expect(out.startsWith('Usage: asphodelos')).toBe(true)
    expect(out.includes('-h, --help')).toBe(true)
  })

  it('-h prints help text and exits 0', () => {
    const out = execSync(`bun run ${entry} -h`, { encoding: 'utf-8' })
    expect(out.startsWith('Usage: asphodelos')).toBe(true)
  })

  it('exits non-zero when no config and missing -o', () => {
    expect(() =>
      execSync(`bun run ${entry} petstore.yaml`, {
        encoding: 'utf-8',
        cwd: '/tmp',
        stdio: 'pipe',
      }),
    ).toThrow()
  })
})
