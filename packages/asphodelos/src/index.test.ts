import { describe, expect, it } from 'bun:test'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

/**
 * The bin as a shell meets it: a real process, a real exit status, real streams.
 *
 * `src/cli/index.test.ts` covers what the command does; this covers that the executable wires it
 * up at all — the shebang entry, the runtime layer it provides, and the exit status a shell reads.
 */
const ENTRY = path.resolve(import.meta.dir, 'index.ts')

function run(args: readonly string[], cwd?: string) {
  const result = spawnSync('bun', ['run', ENTRY, ...args], { encoding: 'utf-8', cwd })
  return { status: result.status, stdout: result.stdout, stderr: result.stderr }
}

describe('asphodelos CLI binary', () => {
  for (const flag of ['--help', '-h']) {
    it(`${flag} prints the usage block and exits 0`, () => {
      const result = run([flag])

      expect(result.status).toBe(0)
      expect(result.stdout).toContain('USAGE')
      expect(result.stdout).toContain('asphodelos [flags] [<input>]')
    })
  }

  it('--version prints a version and exits 0', () => {
    const result = run(['--version'])

    expect(result.status).toBe(0)
    expect(result.stdout).toMatch(/asphodelos v\d+\.\d+\.\d+/u)
  })

  it('exits non-zero when there is no config and no arguments', () => {
    expect(run([], '/tmp').status).not.toBe(0)
  })

  it('exits non-zero when an input is given without an output', () => {
    expect(run(['petstore.yaml'], '/tmp').status).not.toBe(0)
  })
})
