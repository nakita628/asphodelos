import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import { copyFileSync, readFileSync, rmSync } from 'node:fs'
import path from 'node:path'

import type { treaty } from '@elysiajs/eden'

import { resumeHappyDom, suspendHappyDom } from '../happydom.js'
import type { app } from '../hosts/users-app.js'

/**
 * The generated Eden Treaty client, driven over HTTP against the host app.
 *
 * `sameOrigin` splits the client in two: in a browser it talks to the page's own origin, and
 * anywhere else to the base URL. Each half is tried where it applies — the first under happy-dom,
 * whose window is given the server's URL; the second with happy-dom's globals set aside — against
 * one server, started in a process of its own (see hosts/users-server.ts) on a port chosen by the
 * system. The base URL comes from the environment, so each test sets it to say what it expects:
 * the server, or an address nothing listens on.
 *
 * The generated files are loaded by path rather than imported: the generated app they are typed
 * by is a scaffold whose handlers are not written, and tsc would follow a static import into it.
 * The client is typed by the host app instead, whose routes are the document's.
 */
const generated = path.join(import.meta.dir, '__generated__', 'src')

type Client = ReturnType<typeof treaty<typeof app>>

/** Loads a generated module, as Bun does: through the alias its imports name. */
async function load(file: string) {
  const module = (await import(path.join(generated, file))) as { readonly client: Client }
  return module.client
}

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

/** Points happy-dom's window at `url`, as if the page had been served from there. */
function setWindowUrl(url: string) {
  const happyDOM = Reflect.get(globalThis, 'happyDOM') as { setURL: (url: string) => void }
  happyDOM.setURL(url)
}

beforeAll(async () => {
  const started = await startServer()
  server.child = started.child
  server.origin = started.origin
}, 30_000)

afterAll(() => {
  server.child?.kill()
})

describe('the generated client', () => {
  // The alias is the config's `pathAlias`; tsconfig.json maps it, and this file compiling against
  // the generated one is what shows the two agree.
  it('imports the app entry through the alias, and the hooks import the client through it', () => {
    expect(readFileSync(path.join(generated, 'client.ts'), 'utf8')).toContain(
      "import type { app } from '@/index'",
    )
    expect(readFileSync(path.join(generated, 'hooks.ts'), 'utf8')).toContain(
      "import { client } from '@/client'",
    )
  })

  // The base URL names an address nothing listens on, so an answer can only have come from the
  // page's origin — which is the server's, and same-origin, so happy-dom's fetch has no CORS to
  // enforce.
  it("in a browser, sends its requests to the page's own origin", async () => {
    process.env[ENV] = 'http://localhost:1'
    setWindowUrl(server.origin)
    const client = await load('client.ts')
    const { data, error } = await client.users.get()
    expect(error).toBeNull()
    expect(data).toStrictEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ])
  })

  // A module is evaluated once per process, and the origin is decided when it is; the half
  // without a window is read from a copy of the file, with the browser's globals set aside.
  it('without a window, sends its requests to the base URL', async () => {
    process.env[ENV] = server.origin
    const copy = path.join(generated, 'client.server.ts')
    copyFileSync(path.join(generated, 'client.ts'), copy)
    suspendHappyDom()
    try {
      const client = await load(path.basename(copy))
      const { data, error } = await client.users({ id: '2' }).get()
      expect(error).toBeNull()
      expect(data).toStrictEqual({ id: '2', name: 'Bob' })
    } finally {
      resumeHappyDom()
      rmSync(copy, { force: true })
    }
  })

  // The hooks import the client as `@/client`, a value import Bun has to resolve, through the
  // `paths` of the nearest tsconfig.
  it('the hooks load, resolving their import of the client through the alias', async () => {
    const hooks: unknown = await import(path.join(generated, 'hooks.ts'))
    expect(
      typeof hooks === 'object' && hooks !== null && 'useUsers' in hooks
        ? typeof hooks.useUsers
        : 'missing',
    ).toBe('function')
  })
})
