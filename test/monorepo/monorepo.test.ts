import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { QueryClient } from '@tanstack/react-query'

import { resumeHappyDom, suspendHappyDom } from '../happydom.js'

/**
 * The generated client and hooks across three packages, the way a workspace lays them out: the
 * app in apps/elysia, the client in apps/eden, the hooks in apps/react. Generation runs once, from
 * the config beside this file; what is asserted is how the packages reach each other — by name,
 * never by a path into another package — and that the hooks, loaded through those names, fetch
 * from the host app over HTTP.
 *
 * The generated files are loaded by path rather than imported, so tsc follows the names through
 * tsconfig.json rather than a static import into the scaffolded app.
 */
const apps = path.join(import.meta.dir, 'apps')

const read = (file: string) => readFileSync(path.join(apps, file), 'utf8')

const ENV = 'ASPHODELOS_TEST_API_URL'

const server: { child?: ChildProcess; origin: string } = { origin: '' }

/** Starts the host app in its own process and answers with its origin once it says its port. */
function startServer() {
  return new Promise<{ child: ChildProcess; origin: string }>((resolve, reject) => {
    const child = spawn('bun', [path.join(import.meta.dir, '..', 'hosts', 'users-server.ts')], {
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    const out = { text: '' }
    child.stdout?.on('data', (chunk: Buffer) => {
      out.text += chunk.toString()
      const port = /^port (?<port>\d+)$/mu.exec(out.text)?.groups?.port
      if (port !== undefined) resolve({ child, origin: `http://localhost:${port}` })
    })
    child.on('exit', (code) => {
      reject(new Error(`the host server exited with ${String(code)} before saying its port`))
    })
  })
}

beforeAll(async () => {
  const started = await startServer()
  server.child = started.child
  server.origin = started.origin
}, 30_000)

afterAll(() => {
  server.child?.kill()
})

describe('a client in a package of its own', () => {
  it('imports the app by the name of its package, and is re-exported by the index.ts beside it', () => {
    expect(read('eden/__generated__/src/client.ts')).toContain(
      "import type { app } from '@repo/elysia'",
    )
    expect(read('eden/__generated__/src/index.ts')).toBe("export * from './client'\n")
  })

  it('is imported by the hooks of another package by the name of its own', () => {
    expect(read('react/__generated__/src/hooks.ts')).toContain(
      "import { client } from '@repo/eden'",
    )
  })

  // `@repo/eden` is resolved through the tsconfig beside the generated files, as Bun resolves a
  // workspace package; the client reads the base URL from the environment, so the request lands
  // on the host app. The browser's globals are set aside: happy-dom's fetch would refuse the
  // server as another origin, and this client is the one for code without a window.
  it('the hooks, loaded through the package names, fetch from the server', async () => {
    process.env[ENV] = server.origin
    suspendHappyDom()
    try {
      const hooks = (await import(
        path.join(apps, 'react', '__generated__', 'src', 'hooks.ts')
      )) as {
        readonly getUsersQueryOptions: () => {
          readonly queryKey: readonly unknown[]
          readonly queryFn: (context: { readonly signal: AbortSignal }) => Promise<unknown>
        }
      }
      const users = await new QueryClient().query(hooks.getUsersQueryOptions())
      expect(users).toStrictEqual([
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ])
    } finally {
      resumeHappyDom()
    }
  })
})
