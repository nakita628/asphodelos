#!/usr/bin/env bun
import { spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import path from 'node:path'

/**
 * Regenerates `__generated__` from `specs/` by running the CLI over every case.
 *
 * The packaged CLI from `dist`, not the source entry: each case's config imports `asphodelos` by
 * name, so this exercises the published `exports` map too — a packaging regression fails here
 * rather than in someone's project. Each case runs with its own directory as the working
 * directory, which is what makes the relative paths in its config resolve.
 */
const testRoot = path.resolve(import.meta.dir, '..')
const cli = path.resolve(testRoot, '..', 'packages', 'asphodelos', 'dist', 'cli.mjs')
if (!existsSync(cli)) {
  process.stderr.write(`missing ${cli} — build the package first: bun run build\n`)
  process.exit(1)
}

const cases = readdirSync(path.join(testRoot, 'cases'))
  .filter((name) => existsSync(path.join(testRoot, 'cases', name, 'asphodelos.config.ts')))
  .toSorted()

function generate(name: string) {
  return new Promise<{ name: string; ok: boolean; output: string }>((resolve) => {
    const child = spawn('bun', [cli], { cwd: path.join(testRoot, 'cases', name) })
    const chunks: Buffer[] = []
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.on('close', (status) => {
      resolve({ name, ok: status === 0, output: Buffer.concat(chunks).toString() })
    })
  })
}

const results = await Promise.all(cases.map(generate))
const failed = results.filter((result) => !result.ok)
for (const result of failed) {
  process.stderr.write(`\n${result.name}:\n${result.output}\n`)
}
process.stdout.write(
  `generated ${String(results.length - failed.length)}/${String(results.length)} cases\n`,
)
if (failed.length > 0) process.exit(1)
