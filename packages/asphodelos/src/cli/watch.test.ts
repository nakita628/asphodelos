import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { Console, Effect, Fiber } from 'effect'

import { fileSystemLayer } from '../fsp/index.js'
import { asphodelos, hasWatchFlag } from './index.js'

/**
 * Its own file: every case here forks a watcher that has to be interrupted, which does not fit
 * the run-to-completion shape of the rest of the CLI suite.
 *
 * The watcher resolves the config and the spec against `process.cwd()` and never returns, so each
 * case runs inside its own directory and interrupts the fiber before the directory is restored —
 * a round that outlived the test would regenerate into whatever directory came next.
 */
const PKG_ROOT = path.resolve(import.meta.dir, '../..')

const workdirs: string[] = []
let cwdBefore: string | undefined

const SPEC = (paths: readonly string[]) => `openapi: 3.1.0
info: { title: Watch API, version: 1.0.0 }
paths:
${paths
  .map(
    (name) =>
      `  /${name}: { get: { operationId: ${name}, responses: { '200': { description: OK } } } }`,
  )
  .join('\n')}
`

function project(paths: readonly string[], config?: string) {
  const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-watch-'))
  workdirs.push(dir)
  writeFileSync(path.join(dir, 'openapi.yaml'), SPEC(paths))
  writeFileSync(
    path.join(dir, 'asphodelos.config.ts'),
    config ??
      `import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig({ input: 'openapi.yaml', output: 'src/index.ts' })
`,
  )
  cwdBefore ??= process.cwd()
  process.chdir(dir)
  return dir
}

/** Forks the watcher with a console it can be read back from. */
function startWatch(argv: readonly string[] = ['--watch']) {
  const lines: string[] = []
  const recorder: Console.Console = Object.assign(Object.create(console), {
    log: (...args: readonly unknown[]) => {
      lines.push(args.map(String).join(' '))
    },
    error: (...args: readonly unknown[]) => {
      lines.push(args.map(String).join(' '))
    },
  })
  const fiber = Effect.runFork(
    asphodelos(argv).pipe(
      Effect.provideService(Console.Console, recorder),
      Effect.provide(fileSystemLayer),
    ),
  )
  return { fiber, lines, output: () => lines.join('\n') }
}

/** Polls until `check` holds, so a case waits on the watcher rather than on a clock. */
async function until(check: () => boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25)
    })
  }
  return false
}

/** Waits until the watcher has stopped logging, so a case can measure from a quiet baseline. */
async function quiet(lines: readonly string[], forMs = 800) {
  let seen = -1
  while (seen !== lines.length) {
    seen = lines.length
    await new Promise<void>((resolve) => {
      setTimeout(resolve, forMs)
    })
  }
  return lines.length
}

/** How long a written edit is given to reach the watcher before it is written again. */
const REWRITE_AFTER = 2000

/**
 * Writes `content` to `file` until `check` holds, and answers whether it ever did.
 *
 * The first round is logged before anything is being watched: registering the OS watcher is
 * several async hops behind the message, and an edit that lands in that window is not delivered
 * late, it is never delivered at all. Writing once and waiting would therefore be a coin flip.
 *
 * So the edit is repeated rather than assumed. Every attempt is a real edit and a real round,
 * which is what these cases are about; the repeat only costs anything when the first write lost
 * the race.
 */
async function writeUntil(file: string, content: string, check: () => boolean, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    writeFileSync(file, content)
    if (await until(check, REWRITE_AFTER)) return true
  }
  return false
}

afterEach(() => {
  if (cwdBefore) process.chdir(cwdBefore)
})

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

describe('hasWatchFlag', () => {
  it('accepts both spellings, and only those', () => {
    expect(hasWatchFlag(['--watch'])).toBe(true)
    expect(hasWatchFlag(['-w'])).toBe(true)
    expect(hasWatchFlag(['openapi.yaml', '-o', 'src/index.ts', '-w'])).toBe(true)
    expect(hasWatchFlag(['openapi.yaml', '-o', 'src/index.ts'])).toBe(false)
    expect(hasWatchFlag([])).toBe(false)
  })
})

// Each case waits on real generation rounds — oxfmt and a full write — so the budget is a
// starvation allowance, not an expectation.
describe('asphodelos --watch', () => {
  it('generates once on start, then again when the spec changes', async () => {
    const dir = project(['ping'])
    const watch = startWatch()
    try {
      const started = await until(() =>
        watch.lines.some((line) => line.includes('Generated 1 module(s) (ping)')),
      )
      expect(started).toBe(true)

      const regenerated = await writeUntil(
        path.join(dir, 'openapi.yaml'),
        SPEC(['ping', 'pong']),
        () => watch.lines.some((line) => line.includes('(ping, pong)')),
      )
      expect(regenerated).toBe(true)
    } finally {
      await Effect.runPromise(Fiber.interrupt(watch.fiber))
    }

    expect(watch.output()).toContain('👀 asphodelos --watch')
  }, 60_000)

  it('picks up a config change, and follows the input it now points at', async () => {
    const dir = project(['ping'])
    writeFileSync(path.join(dir, 'other.yaml'), SPEC(['alpha', 'beta']))
    const watch = startWatch()
    try {
      await until(() => watch.lines.some((line) => line.includes('Generated 1 module(s) (ping)')))

      const followed = await writeUntil(
        path.join(dir, 'asphodelos.config.ts'),
        `import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig({ input: 'other.yaml', output: 'src/index.ts' })
`,
        () => watch.lines.some((line) => line.includes('(alpha, beta)')),
      )
      expect(followed).toBe(true)
    } finally {
      await Effect.runPromise(Fiber.interrupt(watch.fiber))
    }
  }, 60_000)

  it('reports a broken spec and keeps watching, so the next save recovers', async () => {
    const dir = project(['ping'])
    const watch = startWatch()
    try {
      await until(() => watch.lines.some((line) => line.includes('Generated 1 module(s) (ping)')))

      // Mid-edit a spec is routinely unparseable; that must not end the watcher.
      const reported = await writeUntil(
        path.join(dir, 'openapi.yaml'),
        'openapi: [not a document\n',
        () => watch.lines.some((line) => line.startsWith('❌')),
      )
      expect(reported).toBe(true)

      const recovered = await writeUntil(
        path.join(dir, 'openapi.yaml'),
        SPEC(['ping', 'pong']),
        () => watch.lines.some((line) => line.includes('(ping, pong)')),
      )
      expect(recovered).toBe(true)
    } finally {
      await Effect.runPromise(Fiber.interrupt(watch.fiber))
    }
  }, 60_000)

  it('ignores a change to a file that is neither the config nor a spec', async () => {
    const dir = project(['ping'])
    const watch = startWatch()
    try {
      await until(() => watch.lines.some((line) => line.includes('Generated 1 module(s) (ping)')))
      // Measured from a quiet baseline rather than from the first round: the watcher is
      // registered a few async hops after that round is logged, and the writes that set the
      // project up can still be in the queue when it is.
      const before = await quiet(watch.lines)

      writeFileSync(path.join(dir, 'README.md'), '# not a spec\n')
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 1200)
      })
      expect(watch.lines.slice(before)).toStrictEqual([])
    } finally {
      await Effect.runPromise(Fiber.interrupt(watch.fiber))
    }
  }, 60_000)

  it('watches in argv mode too, with no config file present', async () => {
    const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-watch-argv-'))
    workdirs.push(dir)
    writeFileSync(path.join(dir, 'openapi.yaml'), SPEC(['ping']))
    cwdBefore ??= process.cwd()
    process.chdir(dir)

    const watch = startWatch(['openapi.yaml', '-o', 'src/index.ts', '--watch'])
    try {
      const started = await until(() =>
        watch.lines.some((line) => line.includes('Generated 1 module(s) (ping)')),
      )
      expect(started).toBe(true)

      const regenerated = await writeUntil(
        path.join(dir, 'openapi.yaml'),
        SPEC(['ping', 'pong']),
        () => watch.lines.some((line) => line.includes('(ping, pong)')),
      )
      expect(regenerated).toBe(true)
    } finally {
      await Effect.runPromise(Fiber.interrupt(watch.fiber))
    }
  }, 60_000)
})
