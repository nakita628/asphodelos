#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import { availableParallelism } from 'node:os'
import path from 'node:path'

import { listCases } from './cases.ts'
// Regenerates `__generated__` first, as the test preload does: the output is gitignored, so on a
// clean checkout (CI) there is nothing to typecheck until it is generated, and anywhere else the
// check would otherwise measure the last build instead of this one.
// oxlint-disable-next-line import/no-unassigned-import -- running the preload's generation is the point of this import
import './pretest.ts'

/**
 * Runs `tsc -p` for every case, under `cases/` and at the root.
 *
 * This is what compiles the generated hooks against the real `@tanstack/*` and `swr` type
 * definitions. A hook whose generics are wrong compiles fine in isolation and fails here, which
 * is the only place five of the seven client libraries are checked at all — they are typechecked
 * rather than executed, because their runtimes need a framework this suite does not host.
 */
const testRoot = path.resolve(import.meta.dir, '..')
const tsc = path.resolve(testRoot, 'node_modules', '.bin', 'tsc')

const cases = listCases(testRoot)

function typecheck({ name, dir }: { readonly name: string; readonly dir: string }) {
  return new Promise<{ name: string; ok: boolean; output: string }>((resolve) => {
    const child = spawn(tsc, ['-p', dir], { cwd: testRoot })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      chunks.push(chunk)
    })
    child.on('close', (status, signal) => {
      // A compiler that died without a word — killed for memory, most often — is reported as such,
      // rather than as a case that failed with nothing to say.
      const output = Buffer.concat(chunks).toString()
      const silent = output.length === 0 && status !== 0
      resolve({
        name,
        ok: status === 0,
        output: silent ? `tsc exited with ${signal ?? `status ${String(status)}`}\n` : output,
      })
    })
  })
}

/**
 * Runs the cases a few at a time. Each `tsc` holds a program of its own in memory, and one per
 * case at once is more than a small machine carries: a compiler killed for memory looks like a
 * case that failed for no reason.
 */
async function typecheckAll(all: readonly { readonly name: string; readonly dir: string }[]) {
  const queue = [...all]
  const results: Awaited<ReturnType<typeof typecheck>>[] = []
  async function worker() {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      // oxlint-disable-next-line no-await-in-loop -- one case at a time per worker is the point
      results.push(await typecheck(next))
    }
  }
  const workers = Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)))
  await Promise.all(Array.from({ length: workers }, worker))
  return results
}

const results = await typecheckAll(cases)
const failed = results.filter((result) => !result.ok)
for (const result of failed) {
  process.stderr.write(`\n${result.name}:\n${result.output}\n`)
}
process.stdout.write(
  `typechecked ${String(results.length - failed.length)}/${String(results.length)} cases\n`,
)
if (failed.length > 0) process.exit(1)
