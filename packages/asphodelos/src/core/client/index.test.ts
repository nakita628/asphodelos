import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { runGenerator } from '../../testing/index.js'
import { client } from './index.js'

const LOCALHOST = 'http://localhost:3000'

/** Generates `src/client.ts` with `options` on top of the plainest ones, and answers with its text. */
const generateAndRead = async (options: Partial<Parameters<typeof client>[1]> = {}) => {
  const cwd = process.cwd()
  const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-client-'))
  process.chdir(dir)
  try {
    await runGenerator(
      client('src/client.ts', {
        appImport: './index',
        baseUrl: LOCALHOST,
        fallback: LOCALHOST,
        sameOrigin: false,
        ...options,
      }),
    )
    return readFileSync(path.join(dir, 'src/client.ts'), 'utf8')
  } finally {
    process.chdir(cwd)
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('client generator', () => {
  // The app is imported for its type only, so a browser bundle that imports the client never
  // pulls the server in; the URL stands in the file as written.
  it('writes a treaty client typed by a type-only import of the app entry', async () => {
    const code = await generateAndRead()
    expect(code).toBe(`import { treaty } from '@elysiajs/eden'
import type { app } from './index'

export const client = treaty<typeof app>('http://localhost:3000')
`)
  })

  it('imports the app entry by the specifier it is given', async () => {
    const code = await generateAndRead({ appImport: '@/src/index' })
    expect(code).toContain("import type { app } from '@/src/index'")
  })

  // In a browser the client talks to the page's own origin; `baseUrl` serves the code that runs
  // without a window, so a server render and the browser share one client file.
  it('sameOrigin: the browser uses its own origin and everything else the base URL', async () => {
    const code = await generateAndRead({ sameOrigin: true })
    expect(code).toContain(
      "const origin = typeof window === 'undefined' ? 'http://localhost:3000' : window.location.origin",
    )
    expect(code).toContain('export const client = treaty<typeof app>(origin)')
  })

  // An environment variable is read once, into `baseUrl`, and an unset one falls back to the
  // address the app entry listens on rather than to a relative path treaty would read as a host.
  it('baseUrl from the environment: reads the variable once, with the fallback in its place', async () => {
    const code = await generateAndRead({
      baseUrl: { env: 'VITE_API_URL', source: 'import.meta.env' },
      fallback: 'http://localhost:4000',
    })
    expect(code).toContain(
      "const baseUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:4000'",
    )
    expect(code).toContain('export const client = treaty<typeof app>(baseUrl)')
  })

  it('baseUrl from process.env, with sameOrigin, reads the variable only without a window', async () => {
    const code = await generateAndRead({
      baseUrl: { env: 'API_URL', source: 'process.env' },
      sameOrigin: true,
    })
    expect(code).toContain("const baseUrl = process.env.API_URL ?? 'http://localhost:3000'")
    expect(code).toContain(
      "const origin = typeof window === 'undefined' ? baseUrl : window.location.origin",
    )
  })

  // An environment a module exports answers for its own values, so nothing stands in for them.
  it('baseUrl from an imported environment: imports the module and reads the property', async () => {
    const code = await generateAndRead({
      baseUrl: { env: 'API_URL', import: '@/env', name: 'env' },
    })
    expect(code).toContain("import { treaty } from '@elysiajs/eden'\nimport { env } from '@/env'")
    expect(code).toContain('export const client = treaty<typeof app>(env.API_URL)')
    expect(code).not.toContain('const baseUrl')
  })
})
