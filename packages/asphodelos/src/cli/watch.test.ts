import { afterAll, afterEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import * as NodeServices from '@effect/platform-node/NodeServices'
import { Console, Effect, Fiber, Stdio } from 'effect'

import { asphodelos } from './index.js'

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

const configSource = (
  body: string,
) => `import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig(${body})
`

/** A project directory entered for the length of the case, with a spec unless `spec` is null. */
function project(spec: string | null = SPEC(['ping']), config?: string) {
  const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-watch-'))
  workdirs.push(dir)
  if (spec !== null) writeFileSync(path.join(dir, 'openapi.yaml'), spec)
  if (config !== undefined) writeFileSync(path.join(dir, 'asphodelos.config.ts'), config)
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
    asphodelos().pipe(
      Effect.provideService(Console.Console, recorder),
      Effect.provide(Stdio.layerTest({ args: Effect.succeed(argv) })),
      Effect.provide(NodeServices.layer),
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

/** Interrupts the watcher once a case is done with it, whatever the case concluded. */
async function stop(watch: ReturnType<typeof startWatch>) {
  await Effect.runPromise(Fiber.interrupt(watch.fiber))
}

afterEach(() => {
  if (cwdBefore) process.chdir(cwdBefore)
})

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

const CONFIG = configSource(`{ input: 'openapi.yaml', output: 'src/index.ts' }`)

// Each case waits on real generation rounds — oxfmt and a full write — so the budget is a
// starvation allowance, not an expectation.
describe('asphodelos --watch', () => {
  it('generates once on start, then again when the spec changes', async () => {
    const dir = project(SPEC(['ping']), CONFIG)
    const watch = startWatch()
    try {
      const started = await until(() =>
        watch.lines.some((line) => line.includes('Generated 1 module(s) (ping)')),
      )
      expect(started, watch.output()).toBe(true)
      // The watcher reports what it watches once it is set up, which the first pass does not
      // wait for; the line is awaited rather than expected to be there already.
      expect(
        await until(() => watch.output().includes(`👀 Watching ${dir} and asphodelos.config.ts`)),
        watch.output(),
      ).toBe(true)

      const regenerated = await writeUntil(
        path.join(dir, 'openapi.yaml'),
        SPEC(['ping', 'pong']),
        () => watch.lines.some((line) => line.includes('(ping, pong)')),
      )
      expect(regenerated, watch.output()).toBe(true)
    } finally {
      await stop(watch)
    }
  }, 60_000)

  it('picks up a config change, and follows the input it now points at', async () => {
    const dir = project(SPEC(['ping']), CONFIG)
    writeFileSync(path.join(dir, 'other.yaml'), SPEC(['alpha', 'beta']))
    const watch = startWatch()
    try {
      await until(() => watch.lines.some((line) => line.includes('Generated 1 module(s) (ping)')))

      const followed = await writeUntil(
        path.join(dir, 'asphodelos.config.ts'),
        configSource(`{ input: 'other.yaml', output: 'src/index.ts' }`),
        () => watch.lines.some((line) => line.includes('(alpha, beta)')),
      )
      expect(followed, watch.output()).toBe(true)
    } finally {
      await stop(watch)
    }
  }, 60_000)

  // The directory to watch comes from the config, so a config that moves `input` has to move the
  // watcher with it rather than leaving it on the old directory.
  it('follows input to another directory when the config moves it', async () => {
    const dir = project(null, configSource(`{ input: 'a/openapi.yaml', output: 'src/index.ts' }`))
    mkdirSync(path.join(dir, 'a'))
    mkdirSync(path.join(dir, 'b'))
    writeFileSync(path.join(dir, 'a', 'openapi.yaml'), SPEC(['ping']))
    writeFileSync(path.join(dir, 'b', 'openapi.yaml'), SPEC(['pong']))
    const watch = startWatch()
    try {
      expect(await until(() => watch.output().includes(`👀 Watching ${path.join(dir, 'a')}`))).toBe(
        true,
      )

      expect(
        await writeUntil(
          path.join(dir, 'asphodelos.config.ts'),
          configSource(`{ input: 'b/openapi.yaml', output: 'src/index.ts' }`),
          () => watch.output().includes(`👀 Watching ${path.join(dir, 'b')}`),
        ),
        watch.output(),
      ).toBe(true)

      // Editing the document in the directory the config now names has to rerun. The round
      // restarted to follow it, so this is a second watcher with its own window.
      expect(
        await writeUntil(path.join(dir, 'b', 'openapi.yaml'), SPEC(['pong', 'pang']), () =>
          watch.lines.some((line) => line.includes('(pong, pang)')),
        ),
        watch.output(),
      ).toBe(true)
    } finally {
      await stop(watch)
    }
  }, 60_000)

  it('reports a broken spec and keeps watching, so the next save recovers', async () => {
    const dir = project(SPEC(['ping']), CONFIG)
    const watch = startWatch()
    try {
      await until(() => watch.lines.some((line) => line.includes('Generated 1 module(s) (ping)')))

      // Mid-edit a spec is routinely unparseable; that must not end the watcher.
      const reported = await writeUntil(
        path.join(dir, 'openapi.yaml'),
        'openapi: [not a document\n',
        () => watch.lines.some((line) => line.startsWith('❌')),
      )
      expect(reported, watch.output()).toBe(true)

      const recovered = await writeUntil(
        path.join(dir, 'openapi.yaml'),
        SPEC(['ping', 'pong']),
        () => watch.lines.some((line) => line.includes('(ping, pong)')),
      )
      expect(recovered, watch.output()).toBe(true)
    } finally {
      await stop(watch)
    }
  }, 60_000)

  // A command asked to stay up and react to edits has to treat the first pass as a pass like any
  // other; otherwise one typo in the config ends the session.
  it('stays up when the config does not validate at startup', async () => {
    const dir = project(
      SPEC(['ping']),
      configSource(`{ input: 'openapi.yaml', prefix: 'api', output: 'src/index.ts' }`),
    )
    const watch = startWatch()
    try {
      expect(await until(() => watch.output().includes('👀 Watching'))).toBe(true)
      expect(watch.output()).toContain("prefix: must start with '/'")
      expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(false)

      expect(
        await writeUntil(
          path.join(dir, 'asphodelos.config.ts'),
          configSource(`{ input: 'openapi.yaml', prefix: '/api', output: 'src/index.ts' }`),
          () => existsSync(path.join(dir, 'src/index.ts')),
        ),
        watch.output(),
      ).toBe(true)
    } finally {
      await stop(watch)
    }
  }, 60_000)

  // The config is fine here and only the document is broken, so the directory to watch is
  // already known. Watching the config alone would leave the fix — an edit to the document —
  // unseen, and the session would sit on the first error forever.
  it('watches the input when the first pass fails on the document', async () => {
    const dir = project('openapi: [not a document\n', CONFIG)
    const watch = startWatch()
    try {
      expect(await until(() => watch.output().includes('👀 Watching'))).toBe(true)
      expect(watch.output()).toContain('❌')
      expect(watch.output()).toContain(`👀 Watching ${dir} and asphodelos.config.ts`)
      expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(false)

      expect(
        await writeUntil(path.join(dir, 'openapi.yaml'), SPEC(['ping']), () =>
          existsSync(path.join(dir, 'src/index.ts')),
        ),
        watch.output(),
      ).toBe(true)
    } finally {
      await stop(watch)
    }
  }, 60_000)

  // A watcher on a removed directory stays silent even after the directory is back, so the
  // session has to notice the removal and pick the directory up again when it returns —
  // switching branches does exactly this to a spec directory.
  it('picks the input back up after its directory is removed and recreated', async () => {
    const dir = project(
      null,
      configSource(`{ input: 'spec/openapi.yaml', output: 'src/index.ts' }`),
    )
    const spec = path.join(dir, 'spec')
    mkdirSync(spec)
    writeFileSync(path.join(spec, 'openapi.yaml'), SPEC(['ping']))
    const watch = startWatch()
    try {
      expect(await until(() => watch.output().includes(`👀 Watching ${spec} and`))).toBe(true)

      rmSync(spec, { recursive: true })
      expect(await until(() => watch.output().includes(`waiting for ${spec}`))).toBe(true)

      mkdirSync(spec)
      writeFileSync(path.join(spec, 'openapi.yaml'), SPEC(['ping']))
      expect(await until(() => watch.output().split(`👀 Watching ${spec} and`).length === 3)).toBe(
        true,
      )

      expect(
        await writeUntil(path.join(spec, 'openapi.yaml'), SPEC(['ping', 'pong']), () =>
          watch.lines.some((line) => line.includes('(ping, pong)')),
        ),
        watch.output(),
      ).toBe(true)
    } finally {
      await stop(watch)
    }
  }, 90_000)

  // The config can name a directory nobody has created yet. There is nothing to watch there, but
  // the session still has to start watching it the moment it appears.
  it('starts watching an input directory that is created after startup', async () => {
    const dir = project(
      null,
      configSource(`{ input: 'spec/openapi.yaml', output: 'src/index.ts' }`),
    )
    const spec = path.join(dir, 'spec')
    const watch = startWatch()
    try {
      expect(await until(() => watch.output().includes(`waiting for ${spec}`))).toBe(true)
      expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(false)

      mkdirSync(spec)
      expect(await until(() => watch.output().includes(`👀 Watching ${spec} and`))).toBe(true)

      expect(
        await writeUntil(path.join(spec, 'openapi.yaml'), SPEC(['ping']), () =>
          existsSync(path.join(dir, 'src/index.ts')),
        ),
        watch.output(),
      ).toBe(true)
    } finally {
      await stop(watch)
    }
  }, 60_000)

  // A `$ref` can point at a file anywhere on disk, so the directory the document sits in does
  // not cover every edit that changes the output.
  it('reruns when a file referenced from outside the input directory changes', async () => {
    const dir = project(
      null,
      configSource(`{
  input: 'spec/openapi.yaml',
  output: 'src/index.ts',
  components: { schemas: { output: 'src/schemas.ts' } },
}`),
    )
    const shared = path.join(dir, 'shared', 'item.yaml')
    mkdirSync(path.join(dir, 'spec'))
    mkdirSync(path.join(dir, 'shared'))
    writeFileSync(shared, 'type: object\nproperties:\n  id: { type: string }\n')
    writeFileSync(
      path.join(dir, 'spec', 'openapi.yaml'),
      `${SPEC(['ping'])}components:
  schemas:
    Item: { $ref: '../shared/item.yaml' }
`,
    )
    const watch = startWatch()
    try {
      expect(await until(() => watch.output().includes('👀 Watching'))).toBe(true)
      expect(watch.output()).toContain(
        `👀 Watching ${path.join(dir, 'spec')}, ${shared} and asphodelos.config.ts`,
      )

      expect(
        await writeUntil(shared, 'type: object\nproperties:\n  renamed: { type: number }\n', () =>
          readFileSync(path.join(dir, 'src/schemas.ts'), 'utf-8').includes('renamed'),
        ),
        watch.output(),
      ).toBe(true)
    } finally {
      await stop(watch)
    }
  }, 60_000)

  it('ignores a change to a file that is neither the config nor a spec', async () => {
    const dir = project(SPEC(['ping']), CONFIG)
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
      await stop(watch)
    }
  }, 60_000)

  it('refuses to watch in argv mode, because a one-shot has no second pass', async () => {
    project(SPEC(['ping']))

    const watch = startWatch(['openapi.yaml', '-o', 'src/index.ts', '--watch'])
    const exit = await Effect.runPromise(Fiber.await(watch.fiber))

    expect(exit._tag).toBe('Failure')
    expect(watch.output()).toContain('--watch runs a config file')
  }, 60_000)
})
