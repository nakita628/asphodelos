#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Runs `tsc -p cases/<name>` for every case.
 *
 * This is what compiles the generated hooks against the real `@tanstack/*` and `swr` type
 * definitions. A hook whose generics are wrong compiles fine in isolation and fails here, which
 * is the only place five of the seven client libraries are checked at all — they are typechecked
 * rather than executed, because their runtimes need a framework this suite does not host.
 */
const testRoot = path.resolve(import.meta.dir, '..')
const tsc = path.resolve(testRoot, 'node_modules', '.bin', 'tsc')

const cases = readdirSync(path.join(testRoot, 'cases'))
  .filter((name) => existsSync(path.join(testRoot, 'cases', name, 'tsconfig.json')))
  .toSorted()

function typecheck(name: string) {
  return new Promise<{ name: string; ok: boolean; output: string }>((resolve) => {
    const child = spawn(tsc, ['-p', path.join(testRoot, 'cases', name)], { cwd: testRoot })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('close', (status) => {
      resolve({ name, ok: status === 0, output: Buffer.concat(chunks).toString() })
    })
  })
}

const results = await Promise.all(cases.map(typecheck))
const failed = results.filter((result) => !result.ok)
for (const result of failed) {
  process.stderr.write(`\n${result.name}:\n${result.output}\n`)
}
process.stdout.write(
  `typechecked ${String(results.length - failed.length)}/${String(results.length)} cases\n`,
)
if (failed.length > 0) process.exit(1)
