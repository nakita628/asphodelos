import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { GlobalRegistrator } from '@happy-dom/global-registrator'
import { asphodelosVite } from 'asphodelos/vite-plugin'
import { createServer } from 'vite'
import type { ViteDevServer } from 'vite'

/**
 * The packaged Vite plugin inside a real Vite dev server.
 *
 * The package's own suite drives the plugin through a stand-in for the dev server, which proves
 * its logic against the slice of Vite it was written for and nothing about whether real Vite still
 * offers that slice: that `ssrLoadModule` loads a TypeScript config importing `asphodelos` by name
 * and loads it again after an edit, that the watcher reports a changed document, that the plugin
 * is reachable through the published `asphodelos/vite-plugin` export at all.
 *
 * The project is written into `__generated__` at run time rather than kept under `cases/`: the
 * documents are edited as the case runs, and the CLI pass that regenerates every case must not
 * have produced the output this case expects the plugin to produce.
 */
const testRoot = path.resolve(import.meta.dir, '..')
const projectDir = path.join(testRoot, '__generated__', 'vite-plugin')
const specPath = path.join(projectDir, 'openapi.yaml')
const configPath = path.join(projectDir, 'asphodelos.config.ts')
const originalCwd = process.cwd()

function writeConfig(swrOutput: string) {
  writeFileSync(
    configPath,
    `import { defineConfig } from 'asphodelos'

export default defineConfig({
  input: 'openapi.yaml',
  output: 'app/index.ts',
  swr: { split: true, output: '${swrOutput}', import: '../client' },
})
`,
  )
}

async function waitFor(check: () => boolean, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return true
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 50)
    })
  }
  return false
}

const logged: string[] = []
const reloads: string[] = []
const consoleLog = console.log
let server: ViteDevServer | undefined

beforeAll(async () => {
  // The suite preloads happy-dom for the React hooks, and its timers are the browser's: Vite calls
  // `.unref()` on what `setTimeout` returns. A dev server is a Node program, so it gets Node's.
  await GlobalRegistrator.unregister()
  rmSync(projectDir, { recursive: true, force: true })
  mkdirSync(projectDir, { recursive: true })
  writeFileSync(specPath, readFileSync(path.join(testRoot, 'specs', 'users.yaml'), 'utf8'))
  writeConfig('hooks')
  // The plugin resolves the config and every output against the working directory, the way the
  // CLI does, so the dev server is started from inside the project.
  process.chdir(projectDir)
  console.log = (...args: readonly unknown[]) => {
    logged.push(args.map(String).join(' '))
  }
  server = await createServer({
    root: projectDir,
    configFile: false,
    logLevel: 'silent',
    server: { middlewareMode: true, ws: false },
    plugins: [asphodelosVite()],
  })
  const send = server.ws.send.bind(server.ws)
  server.ws.send = ((payload: { type: string }) => {
    reloads.push(payload.type)
    send(payload)
  }) as typeof server.ws.send
}, 120_000)

afterAll(async () => {
  await server?.close()
  console.log = consoleLog
  process.chdir(originalCwd)
  GlobalRegistrator.register()
})

describe('asphodelosVite in a Vite dev server', () => {
  it('generates the config outputs when the server starts', async () => {
    expect(await waitFor(() => existsSync(path.join(projectDir, 'hooks/index.ts')))).toBe(true)
    await waitFor(() => logged.some((line) => line.startsWith('✅ swr')))

    expect(existsSync(path.join(projectDir, 'app/index.ts'))).toBe(true)
    expect(existsSync(path.join(projectDir, 'app/modules/users/index.ts'))).toBe(true)
    expect(existsSync(path.join(projectDir, 'hooks/listUsers.ts'))).toBe(true)
  }, 120_000)

  it('regenerates and reloads when the document changes', async () => {
    reloads.length = 0
    writeFileSync(
      specPath,
      readFileSync(specPath, 'utf8').replace(
        'paths:\n',
        `paths:
  /health:
    get:
      operationId: getHealth
      responses:
        '200':
          description: OK
`,
      ),
    )

    expect(await waitFor(() => existsSync(path.join(projectDir, 'hooks/getHealth.ts')))).toBe(true)
    expect(await waitFor(() => reloads.includes('full-reload'))).toBe(true)
    expect(existsSync(path.join(projectDir, 'app/modules/health/index.ts'))).toBe(true)
  }, 120_000)

  it('reloads an edited config and cleans up the output it no longer names', async () => {
    writeConfig('swr')

    expect(await waitFor(() => existsSync(path.join(projectDir, 'swr/index.ts')))).toBe(true)
    expect(await waitFor(() => !existsSync(path.join(projectDir, 'hooks/listUsers.ts')))).toBe(true)
    expect(logged).toContain(`🧹 removed ${path.join(projectDir, 'hooks/listUsers.ts')}`)
    // The app entry holds the user's code, so a config edit never takes it away.
    expect(existsSync(path.join(projectDir, 'app/index.ts'))).toBe(true)
  }, 120_000)
})
