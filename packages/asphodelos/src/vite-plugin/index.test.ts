import { afterAll, afterEach, beforeEach, describe, expect, it } from 'bun:test'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { asphodelosVite } from './index.js'

/**
 * The plugin is the one place an Effect meets Vite's Promise/callback world, so nothing here
 * asserts on an Effect: it drives the hooks the way Vite does and checks what reached the disk
 * and what was logged.
 *
 * The hooks resolve `asphodelos.config.ts` against `process.cwd()`, so each case runs inside its
 * own directory. Generation happens in the background of `configureServer`, which is why the
 * helpers below wait for a file rather than for a promise the plugin never hands back.
 */
const PKG_ROOT = path.resolve(import.meta.dir, '../..')

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

/** A project directory with a spec and, unless told otherwise, a valid config. */
function project(
  config = `import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig({ input: 'openapi.yaml', output: 'src/index.ts' })
`,
) {
  const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-vite-plugin-'))
  workdirs.push(dir)
  writeFileSync(path.join(dir, 'openapi.yaml'), OPENAPI)
  if (config !== '') writeFileSync(path.join(dir, 'asphodelos.config.ts'), config)
  process.chdir(dir)
  return dir
}

/** The slice of Vite's dev server the plugin actually touches, plus what it was asked to do. */
function fakeServer() {
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
      ssrLoadModule: async (moduleId: string) => import(moduleId.split('?')[0] ?? moduleId),
    },
  }
}

/**
 * Waits until nothing new has been logged for a beat.
 *
 * `configureServer` starts generation in the background and hands Vite nothing to await, so a
 * case that returns as soon as its assertion holds leaves the rest of that run to log after the
 * console has been restored — into whichever test file happens to be running next.
 */
async function settle(lines: readonly string[], quietMs = 300) {
  let seen = -1
  while (seen !== lines.length) {
    seen = lines.length
    await new Promise<void>((resolve) => {
      setTimeout(resolve, quietMs)
    })
  }
}

/** Waits for the background generation to reach the disk. */
async function waitFor(check: () => boolean, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 25)
    })
  }
  return false
}

beforeEach(() => {
  cwdBefore ??= process.cwd()
})

afterEach(() => {
  if (cwdBefore) process.chdir(cwdBefore)
})

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

describe('asphodelosVite', () => {
  it('exposes the plugin name and the two hooks Vite calls', () => {
    const plugin = asphodelosVite()
    expect(plugin.name).toBe('asphodelos')
    expect(typeof plugin.configureServer).toBe('function')
    expect(typeof plugin.handleHotUpdate).toBe('function')
  })

  it('configureServer: reads the config, generates, watches the spec and reloads the client', async () => {
    const dir = project()
    const { server, watched, sent } = fakeServer()
    const recorder = captureConsole()
    try {
      asphodelosVite().configureServer(server)
      const generated = await waitFor(() => existsSync(path.join(dir, 'src/index.ts')))
      expect(generated).toBe(true)
      await settle(recorder.lines)
    } finally {
      recorder.restore()
    }

    expect(existsSync(path.join(dir, 'src/modules/ping/index.ts'))).toBe(true)
    expect(recorder.lines.join('\n')).toContain('✅ elysia -> src/index.ts')
    // The spec, its directory globs and the config file all have to be watched, or an edit
    // never reaches the generator.
    expect(watched).toContain(path.join(dir, 'openapi.yaml'))
    expect(watched).toContain(path.join(dir, '**/*.yaml'))
    expect(watched).toContain(path.join(dir, 'asphodelos.config.ts'))
    // A full reload is what makes the browser pick the regenerated modules up.
    expect(sent).toContain('full-reload')
  })

  it('configureServer: reports an invalid config and generates nothing', async () => {
    const dir = project(`import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
// @ts-expect-error deliberately invalid: the input extension is not one asphodelos accepts
export default defineConfig({ input: 'openapi.txt' })
`)
    const recorder = captureConsole()
    try {
      asphodelosVite().configureServer(fakeServer().server)
      await waitFor(() => recorder.lines.some((line) => line.includes('❌ config:')))
      await settle(recorder.lines)
    } finally {
      recorder.restore()
    }

    expect(recorder.lines.join('\n')).toContain('❌ config: Invalid config: input:')
    expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(false)
  })

  it('configureServer: reports a config module with no default export', async () => {
    const dir = project('export const notDefault = 1\n')
    const recorder = captureConsole()
    try {
      asphodelosVite().configureServer(fakeServer().server)
      await waitFor(() => recorder.lines.some((line) => line.includes('❌ config:')))
      await settle(recorder.lines)
    } finally {
      recorder.restore()
    }

    expect(recorder.lines.join('\n')).toContain('Config must export default object')
    expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(false)
  })

  it('reports a failing generator per job and keeps the server running', async () => {
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
    const recorder = captureConsole()
    try {
      asphodelosVite().configureServer(fakeServer().server)
      await waitFor(() => recorder.lines.some((line) => line.includes('❌ types')))
      await settle(recorder.lines)
    } finally {
      recorder.restore()
    }

    const log = recorder.lines.join('\n')
    expect(log).toContain('❌ types')
    expect(log).toContain('✅ elysia -> src/index.ts')
    expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(true)
  })

  it('reports a spec that cannot be parsed, without failing the hook', async () => {
    const dir = project(`import { defineConfig } from '${PKG_ROOT}/src/config/index.js'
export default defineConfig({ input: 'missing.yaml', output: 'src/index.ts' })
`)
    const recorder = captureConsole()
    try {
      asphodelosVite().configureServer(fakeServer().server)
      await waitFor(() => recorder.lines.some((line) => line.includes('❌ parseOpenAPI')))
      await settle(recorder.lines)
    } finally {
      recorder.restore()
    }

    expect(recorder.lines.join('\n')).toContain('❌ parseOpenAPI:')
    expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(false)
  })

  it('handleHotUpdate: claims the config file and lets Vite handle everything else', async () => {
    const dir = project()
    const { server } = fakeServer()
    const plugin = asphodelosVite()
    const recorder = captureConsole()
    try {
      // An empty module list is how a plugin tells Vite "handled, do nothing further".
      const claimed = plugin.handleHotUpdate({
        file: path.join(dir, 'asphodelos.config.ts'),
        server,
      })
      expect(claimed).toStrictEqual([])

      // Anything else falls through to Vite's own HMR.
      const passedThrough = plugin.handleHotUpdate({
        file: path.join(dir, 'src/app.tsx'),
        server,
      })
      expect(passedThrough).toBeUndefined()

      await waitFor(() => existsSync(path.join(dir, 'src/index.ts')))
      await settle(recorder.lines)
    } finally {
      recorder.restore()
    }
    expect(existsSync(path.join(dir, 'src/index.ts'))).toBe(true)
  })

  it('watcher: a spec change regenerates, an unrelated file does not', async () => {
    const dir = project()
    const { server, fire } = fakeServer()
    const recorder = captureConsole()
    try {
      asphodelosVite().configureServer(server)
      await waitFor(() => existsSync(path.join(dir, 'src/index.ts')))

      const before = recorder.lines.length
      fire(path.join(dir, 'README.md'))
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 400)
      })
      expect(recorder.lines.length).toBe(before)

      fire(path.join(dir, 'openapi.yaml'))
      // The watcher is debounced by 200ms, so the rerun is not immediate.
      const reran = await waitFor(() => recorder.lines.length > before)
      expect(reran).toBe(true)
      await settle(recorder.lines)
    } finally {
      recorder.restore()
    }
    expect(recorder.lines.join('\n')).toContain('🌸 asphodelos')
  })
})
