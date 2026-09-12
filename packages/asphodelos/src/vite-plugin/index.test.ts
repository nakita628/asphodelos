import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { asphodelosVite } from './index.js'

/**
 * The plugin is the one place an Effect meets Vite's Promise/callback world, so nothing here
 * asserts on an Effect: it drives the hooks the way Vite does and checks what reached the disk,
 * what was logged and what was sent to the browser.
 *
 * The hooks resolve `asphodelos.config.ts` against `process.cwd()`, so each case runs inside its
 * own directory. Every pass runs in the background of the hook that queued it, which is why the
 * helpers below wait for a log line rather than for a promise the plugin never hands back.
 */
const PKG_ROOT = path.resolve(import.meta.dir, '../..')

/** Every case waits on real generation passes, which slow down when the whole suite shares a machine. */
const TIMEOUT_MS = 30_000

const workdirs: string[] = []
let cwdBefore: string | undefined

/** Collects what the plugin prints, since its hooks report through the console. */
function captureConsole() {
  const lines: string[] = []
  const log = console.log
  const error = console.error
  console.log = (...args: readonly unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  console.error = (...args: readonly unknown[]) => {
    lines.push(args.map(String).join(' '))
  }
  return {
    lines,
    restore: () => {
      console.log = log
      console.error = error
    },
  }
}

const OPENAPI = `openapi: 3.1.0
info: { title: Plugin API, version: 1.0.0 }
paths:
  /ping:
    get:
      operationId: ping
      responses: { '200': { description: OK } }
`

const CONFIG = `import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig({ input: 'openapi.yaml', output: 'src/index.ts' })
`

/** A project directory with a spec and, unless told otherwise, a valid config. */
function project(config = CONFIG) {
  const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-vite-plugin-'))
  workdirs.push(dir)
  writeFileSync(path.join(dir, 'openapi.yaml'), OPENAPI)
  if (config !== '') writeFileSync(path.join(dir, 'asphodelos.config.ts'), config)
  process.chdir(dir)
  return dir
}

/**
 * The slice of Vite's dev server the plugin actually touches, plus what it was asked to do.
 *
 * `load` stands in for the config module when a case needs to change it between passes: the
 * runtime caches a module by path, so importing the edited file again would answer with the old
 * one.
 */
function fakeServer(load?: () => unknown) {
  const watched: string[] = []
  const sent: string[] = []
  let watcherCallback: ((eventType: string, filePath: string) => void) | undefined
  return {
    watched,
    sent,
    fire: (filePath: string) => watcherCallback?.('change', filePath),
    server: {
      watcher: {
        add: (paths: string | readonly string[]) => {
          watched.push(...(typeof paths === 'string' ? [paths] : paths))
        },
        on: (_event: 'all', callback: (eventType: string, filePath: string) => void) => {
          watcherCallback = callback
        },
      },
      ws: {
        send: (payload: { type: string }) => {
          sent.push(payload.type)
        },
      },
      // Vite resolves the config through its own module graph; returning null is the
      // "not in the graph yet" case, which makes the plugin invalidate everything.
      pluginContainer: { resolveId: () => Promise.resolve(null) },
      moduleGraph: {
        invalidateModule: () => {},
        invalidateAll: () => {},
        getModuleById: () => null,
      },
      ssrLoadModule: async (moduleId: string): Promise<unknown> =>
        load ? { default: load() } : import(moduleId.split('?')[0] ?? moduleId),
    },
  }
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    setTimeout(resolve, ms)
  })
}

/** Waits for a condition the background pass is expected to reach. */
async function waitFor(check: () => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await sleep(25)
  }
  return false
}

/**
 * Waits until nothing new has been logged for a beat.
 *
 * A case that returns as soon as its assertion holds would leave the rest of that pass to log
 * after the console has been restored — into whichever test file happens to be running next. The
 * beat is longer than the plugin's debounce, so a queued pass has started by the time it ends.
 */
async function settle(lines: readonly string[], quietMs = 400) {
  let seen = -1
  while (seen !== lines.length) {
    seen = lines.length
    await sleep(quietMs)
  }
}

/** How many passes have started: each one opens with the banner. */
function passes(lines: readonly string[]) {
  return lines.filter((line) => line === '🌸 asphodelos').length
}

/**
 * How many passes have finished generating: each one reports the `elysia` job, which every config
 * runs, or the document that stopped it.
 *
 * What a case waits on, rather than the banner: a pass that has started may be between emptying
 * a split directory and refilling it.
 */
function finished(lines: readonly string[]) {
  return lines.filter((line) => /^(?:✅ elysia |❌ elysia:|❌ parseOpenAPI:)/u.test(line)).length
}

let recorder: ReturnType<typeof captureConsole>

beforeEach(() => {
  cwdBefore ??= process.cwd()
  recorder = captureConsole()
})

/**
 * Waits until every pass that has started has finished and nothing more is logged.
 *
 * A debounced pass can start during the quiet beat, so the two waits repeat until both hold.
 */
async function drain(lines: readonly string[]): Promise<void> {
  await waitFor(() => finished(lines) >= passes(lines))
  await settle(lines)
  if (finished(lines) < passes(lines)) await drain(lines)
}

afterEach(async () => {
  // Every pass resolves its paths against the working directory, so one still running when the
  // next case changes directory would write into that case's project.
  await drain(recorder.lines)
  recorder.restore()
  if (cwdBefore) process.chdir(cwdBefore)
})

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

/** Starts the plugin against a fake server and waits for the first pass to finish logging. */
async function start(load?: () => unknown) {
  const fake = fakeServer(load)
  const plugin = asphodelosVite()
  plugin.configureServer(fake.server)
  await waitFor(() => finished(recorder.lines) > 0)
  await settle(recorder.lines)
  return { ...fake, plugin }
}

describe('asphodelosVite', () => {
  it('exposes the plugin name, serve-only, and the two hooks Vite calls', () => {
    const plugin = asphodelosVite()
    expect(plugin.name).toBe('asphodelos')
    expect(plugin.apply).toBe('serve')
    expect(typeof plugin.configureServer).toBe('function')
    expect(typeof plugin.handleHotUpdate).toBe('function')
    expect(asphodelosVite()).not.toBe(plugin)
  })

  describe('configureServer', () => {
    it(
      'reads the config, generates, watches the spec and reloads the client',
      async () => {
        const dir = project()
        const { watched, sent } = await start()

        expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(true)
        expect(existsSync(path.join(dir, 'src/modules/ping/index.ts'))).toBe(true)
        expect(recorder.lines).toContain('✅ elysia -> src/index.ts')
        // The spec, its directory globs and the config file all have to be watched, or an edit
        // never reaches the generator.
        expect(watched).toContain(path.join(dir, 'openapi.yaml'))
        expect(watched).toContain(path.join(dir, '**/*.yaml'))
        expect(watched).toContain(path.join(dir, '**/*.tsp'))
        expect(watched).toContain(path.join(dir, 'asphodelos.config.ts'))
        // A full reload is what makes the browser pick the regenerated modules up.
        expect(sent).toStrictEqual(['full-reload'])
      },
      TIMEOUT_MS,
    )

    it(
      'reports an invalid config and generates nothing',
      async () => {
        const dir = project(`import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
// @ts-expect-error deliberately invalid: the input extension is not one asphodelos accepts
export default defineConfig({ input: 'openapi.txt' })
`)
        asphodelosVite().configureServer(fakeServer().server)
        await waitFor(() => recorder.lines.some((line) => line.includes('❌ config:')))

        expect(recorder.lines.join('\n')).toContain('❌ config: Invalid config: input:')
        expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(false)
      },
      TIMEOUT_MS,
    )

    it(
      'reports a config module with no default export',
      async () => {
        const dir = project('export const notDefault = 1\n')
        asphodelosVite().configureServer(fakeServer().server)
        await waitFor(() => recorder.lines.some((line) => line.includes('❌ config:')))

        expect(recorder.lines.join('\n')).toContain('Config must export default object')
        expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(false)
      },
      TIMEOUT_MS,
    )

    it(
      'reports a missing config file by name, not by what the loader throws',
      async () => {
        const dir = project('')
        asphodelosVite().configureServer(fakeServer().server)
        await waitFor(() => recorder.lines.some((line) => line.includes('❌ config:')))

        expect(recorder.lines).toContain(
          `❌ config: Config not found: ${path.join(dir, 'asphodelos.config.ts')}`,
        )
      },
      TIMEOUT_MS,
    )

    it(
      'reports a config module that fails to load',
      async () => {
        project()
        asphodelosVite().configureServer({
          ...fakeServer().server,
          ssrLoadModule: () => Promise.reject(new Error('module load failure')),
        })
        await waitFor(() => recorder.lines.some((line) => line.includes('❌ config:')))

        expect(recorder.lines).toContain('❌ config: module load failure')
      },
      TIMEOUT_MS,
    )

    it(
      'recovers from a broken config on the save that fixes it, without a restart',
      async () => {
        const dir = project()
        const config: { current: unknown } = { current: { input: 'openapi.txt' } }
        const { server, fire } = fakeServer(() => config.current)
        asphodelosVite().configureServer(server)
        await waitFor(() => recorder.lines.some((line) => line.includes('❌ config:')))
        expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(false)

        config.current = { input: 'openapi.yaml', output: 'src/index.ts' }
        fire(path.join(dir, 'asphodelos.config.ts'))
        await waitFor(() => existsSync(path.join(dir, 'src/index.ts')))

        expect(passes(recorder.lines)).toBe(1)
      },
      TIMEOUT_MS,
    )
  })

  describe('generation', () => {
    it(
      'reports a failing generator per job and keeps the server running',
      async () => {
        // `types.output` points at a directory that already exists as a file, so the write fails
        // while `elysia` succeeds — the log has to carry both.
        const dir = project(`import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig({
  input: 'openapi.yaml',
  output: 'src/index.ts',
  types: { output: 'blocked/types.ts' },
})
`)
        writeFileSync(path.join(dir, 'blocked'), 'not a directory')
        await start()

        const log = recorder.lines.join('\n')
        expect(log).toContain('❌ types')
        expect(log).toContain('✅ elysia -> src/index.ts')
        expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(true)
      },
      TIMEOUT_MS,
    )

    it(
      'reports a spec that cannot be parsed, and does not reload',
      async () => {
        const dir = project(`import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig({ input: 'missing.yaml', output: 'src/index.ts' })
`)
        const { sent } = await start()

        expect(recorder.lines.join('\n')).toContain('❌ parseOpenAPI:')
        expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(false)
        expect(sent).toStrictEqual([])
      },
      TIMEOUT_MS,
    )

    it(
      'empties a split directory before refilling it, keeping what is not generated',
      async () => {
        const dir = project()
        const hooks = path.join(dir, 'src/hooks')
        mkdirSync(hooks, { recursive: true })
        writeFileSync(path.join(hooks, 'stale.ts'), '// an operation the document no longer has')
        writeFileSync(path.join(hooks, 'README.md'), 'keep')
        await start(() => ({
          input: 'openapi.yaml',
          output: 'src/index.ts',
          swr: { output: 'src/hooks', split: true, import: '../lib' },
          types: { output: 'src/hooks/types.ts' },
        }))

        expect(recorder.lines).toContain('✅ swr (split) -> src/hooks')
        expect(existsSync(path.join(hooks, 'stale.ts'))).toBe(false)
        expect(existsSync(path.join(hooks, 'index.ts'))).toBe(true)
        expect(existsSync(path.join(hooks, 'README.md'))).toBe(true)
        // A single-file output of another job inside the split directory survives the clean.
        expect(existsSync(path.join(hooks, 'types.ts'))).toBe(true)
      },
      TIMEOUT_MS,
    )
  })

  describe('handleHotUpdate', () => {
    it(
      'claims the config file and lets Vite handle everything else',
      async () => {
        const dir = project()
        const { server } = fakeServer()
        const plugin = asphodelosVite()

        // An empty module list is how a plugin tells Vite "handled, do nothing further".
        expect(
          plugin.handleHotUpdate({ file: path.join(dir, 'asphodelos.config.ts'), server }),
        ).toStrictEqual([])
        // Anything else falls through to Vite's own HMR.
        expect(
          plugin.handleHotUpdate({ file: path.join(dir, 'src/app.tsx'), server }),
        ).toBeUndefined()

        await waitFor(() => existsSync(path.join(dir, 'src/index.ts')))
        expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(true)
      },
      TIMEOUT_MS,
    )

    it(
      'reports a config that stops validating, and keeps the previous one in effect',
      async () => {
        const dir = project()
        const config: { current: unknown } = { current: { input: 'openapi.yaml' } }
        const { server, plugin, fire } = await start(() => config.current)

        config.current = { input: 'broken.txt' }
        plugin.handleHotUpdate({ file: path.join(dir, 'asphodelos.config.ts'), server })
        await waitFor(() => recorder.lines.some((line) => line.includes('❌ config:')))

        // The spec still regenerates under the config that last loaded.
        writeFileSync(path.join(dir, 'openapi.yaml'), `${OPENAPI}# edited\n`)
        fire(path.join(dir, 'openapi.yaml'))
        await waitFor(() => finished(recorder.lines) === 2)
        expect(passes(recorder.lines)).toBe(2)
      },
      TIMEOUT_MS,
    )
  })

  describe('watcher', () => {
    it(
      'regenerates and reloads when the spec changes',
      async () => {
        const dir = project()
        const { fire, sent } = await start()
        sent.length = 0

        writeFileSync(path.join(dir, 'openapi.yaml'), OPENAPI.replace('/ping', '/pong'))
        fire(path.join(dir, 'openapi.yaml'))
        await waitFor(() => sent.length > 0)

        expect(passes(recorder.lines)).toBe(2)
        expect(existsSync(path.join(dir, 'src/modules/pong/index.ts'))).toBe(true)
        expect(sent).toStrictEqual(['full-reload'])
      },
      TIMEOUT_MS,
    )

    it(
      'ignores files that are not documents, or not under the input directory',
      async () => {
        const dir = project()
        mkdirSync(path.join(`${dir}-other`), { recursive: true })
        workdirs.push(`${dir}-other`)
        const { fire } = await start()

        fire(path.join(dir, 'README.md'))
        // A string prefix of the input directory without being inside it.
        fire(path.join(`${dir}-other`, 'openapi.yaml'))
        fire(path.join(dir, 'node_modules/pkg/package.json'))
        fire(path.join(dir, '.cache/spec.json'))
        await sleep(500)

        expect(passes(recorder.lines)).toBe(1)
      },
      TIMEOUT_MS,
    )

    it(
      'skips a pass when the documents read exactly as they did',
      async () => {
        const dir = project()
        const { fire, sent } = await start()
        sent.length = 0

        // Saved without a change: the event arrives, the content is the same.
        writeFileSync(path.join(dir, 'openapi.yaml'), OPENAPI)
        fire(path.join(dir, 'openapi.yaml'))
        await waitFor(() => recorder.lines.some((line) => line.includes('input unchanged')))

        expect(passes(recorder.lines)).toBe(1)
        expect(sent).toStrictEqual([])
      },
      TIMEOUT_MS,
    )

    it(
      'regenerates a deleted output even when the documents are unchanged',
      async () => {
        const dir = project()
        const { fire } = await start()

        rmSync(path.join(dir, 'src/index.ts'))
        fire(path.join(dir, 'openapi.yaml'))
        await waitFor(() => existsSync(path.join(dir, 'src/index.ts')))

        expect(passes(recorder.lines)).toBe(2)
      },
      TIMEOUT_MS,
    )

    it(
      'does not reload when a document edit leaves every output byte-identical',
      async () => {
        const dir = project()
        const { fire, sent } = await start()
        sent.length = 0
        const before = readFileSync(path.join(dir, 'src/index.ts'), 'utf8')

        // A comment changes the bytes, so the pass runs, but not the parsed document.
        writeFileSync(path.join(dir, 'openapi.yaml'), `${OPENAPI}# a comment only\n`)
        fire(path.join(dir, 'openapi.yaml'))
        await waitFor(() => finished(recorder.lines) === 2)
        await settle(recorder.lines)

        expect(readFileSync(path.join(dir, 'src/index.ts'), 'utf8')).toBe(before)
        expect(sent).toStrictEqual([])
      },
      TIMEOUT_MS,
    )

    it(
      'folds a burst of events into one pass',
      async () => {
        const dir = project()
        const { fire } = await start()

        writeFileSync(path.join(dir, 'openapi.yaml'), OPENAPI.replace('/ping', '/pong'))
        for (let index = 0; index < 5; index += 1) fire(path.join(dir, 'openapi.yaml'))
        await waitFor(() => finished(recorder.lines) === 2)
        await settle(recorder.lines)

        expect(passes(recorder.lines)).toBe(2)
      },
      TIMEOUT_MS,
    )
  })

  describe('config changes', () => {
    it(
      'regenerates on a config save even when the documents are unchanged, once per save',
      async () => {
        const dir = project()
        const { fire, plugin, server } = await start()

        // One save reaches the plugin twice: Vite's HMR hook and the raw watcher both report it.
        plugin.handleHotUpdate({ file: path.join(dir, 'asphodelos.config.ts'), server })
        fire(path.join(dir, 'asphodelos.config.ts'))
        await waitFor(() => finished(recorder.lines) === 2)
        await settle(recorder.lines)
        expect(passes(recorder.lines)).toBe(2)

        // The config pass recorded the documents it read, so an unchanged save after it skips.
        fire(path.join(dir, 'openapi.yaml'))
        await waitFor(() => recorder.lines.some((line) => line.includes('input unchanged')))
        expect(passes(recorder.lines)).toBe(2)
      },
      TIMEOUT_MS,
    )

    it(
      'removes an output the config no longer names, never the user code',
      async () => {
        const dir = project()
        const config: { current: unknown } = {
          current: {
            input: 'openapi.yaml',
            output: 'src/index.ts',
            types: { output: 'src/types.ts' },
          },
        }
        const { fire } = await start(() => config.current)
        expect(existsSync(path.join(dir, 'src/types.ts'))).toBe(true)

        config.current = {
          input: 'openapi.yaml',
          output: 'src/app.ts',
          types: { output: 'src/api-types.ts' },
        }
        fire(path.join(dir, 'asphodelos.config.ts'))
        await waitFor(() => recorder.lines.some((line) => line.startsWith('🧹')))

        expect(recorder.lines).toContain(`🧹 removed ${path.join(dir, 'src/types.ts')}`)
        expect(existsSync(path.join(dir, 'src/types.ts'))).toBe(false)
        expect(existsSync(path.join(dir, 'src/api-types.ts'))).toBe(true)
        // The old app entry merges into what the user wrote, so it stays where it was.
        expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(true)
        expect(existsSync(path.join(dir, 'src/app.ts'))).toBe(true)
      },
      TIMEOUT_MS,
    )

    it(
      'keeps the barrel when a single-file output turns into a split directory',
      async () => {
        const dir = project()
        const config: { current: unknown } = {
          current: {
            input: 'openapi.yaml',
            swr: { output: 'src/hooks/index.ts', import: '../lib' },
          },
        }
        const { fire } = await start(() => config.current)

        config.current = {
          input: 'openapi.yaml',
          swr: { output: 'src/hooks', split: true, import: '../lib' },
        }
        fire(path.join(dir, 'asphodelos.config.ts'))
        await waitFor(() => finished(recorder.lines) === 2)
        await settle(recorder.lines)

        expect(recorder.lines.filter((line) => line.startsWith('🧹'))).toStrictEqual([])
        expect(existsSync(path.join(dir, 'src/hooks/index.ts'))).toBe(true)
      },
      TIMEOUT_MS,
    )

    it(
      'queues a document change behind the config pass already in flight',
      async () => {
        const dir = project()
        const gate: { open?: () => void } = {}
        const opened = new Promise<void>((resolve) => {
          gate.open = resolve
        })
        const loads = { count: 0 }
        const fake = fakeServer()
        asphodelosVite().configureServer({
          ...fake.server,
          // The second load — the config change below — holds the queue until the gate opens.
          ssrLoadModule: async () => {
            loads.count += 1
            if (loads.count === 2) await opened
            return { default: { input: 'openapi.yaml' } }
          },
        })
        await waitFor(() => finished(recorder.lines) === 1)
        await settle(recorder.lines)

        fake.fire(path.join(dir, 'asphodelos.config.ts'))
        await waitFor(() => loads.count === 2)
        writeFileSync(path.join(dir, 'openapi.yaml'), OPENAPI.replace('/ping', '/pong'))
        fake.fire(path.join(dir, 'openapi.yaml'))
        await sleep(500)
        // Neither the held config pass nor the document change behind it has run.
        expect(passes(recorder.lines)).toBe(1)

        gate.open?.()
        await waitFor(() => recorder.lines.some((line) => line.includes('input unchanged')))
        // The config pass ran first and generated from the edited document, so the document
        // change that waited behind it finds nothing left to do.
        expect(passes(recorder.lines)).toBe(2)
        expect(
          recorder.lines.findIndex((line) => line.includes('input unchanged')),
        ).toBeGreaterThan(recorder.lines.lastIndexOf('🌸 asphodelos'))
        expect(existsSync(path.join(dir, 'src/modules/pong/index.ts'))).toBe(true)
      },
      TIMEOUT_MS,
    )
  })
})
