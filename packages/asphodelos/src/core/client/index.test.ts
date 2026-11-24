import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Effect } from 'effect'

import { fileSystemLayer } from '../../fsp/index.js'
import { client } from './index.js'

/** Generates `src/client.ts` with `options` on top of the plainest ones, and answers with its text. */
const generateAndRead = async (options: Partial<Parameters<typeof client>[1]> = {}) => {
  const cwd = process.cwd()
  const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-client-'))
  process.chdir(dir)
  try {
    await Effect.runPromise(
      client('src/client.ts', {
        appImport: './index',
        baseUrl: { env: 'API_URL', source: 'process.env' },
        sameOrigin: false,
        ...options,
      }).pipe(Effect.provide(fileSystemLayer)),
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
  // The app is imported for its type only, so a browser bundle that imports the client never
  // pulls the server in; the address is the environment's, asserted to be set.
  it('writes a treaty client typed by a type-only import of the app entry', async () => {
    const code = await generateAndRead()
    expect(code).toBe(`import { treaty } from '@elysiajs/eden'
import type { app } from './index'

function normalizeOrigin(origin: string) {
  if (!origin) return origin
  const url = origin.includes('://')
    ? origin
    : \`\${['localhost', '127.0.0.1', '0.0.0.0'].some((host) => origin.includes(host)) ? 'http' : 'https'}://\${origin}\`
  return url.endsWith('/') ? url.slice(0, -1) : url
}

export const clientOrigin = normalizeOrigin(process.env.API_URL!)

export const client = treaty<typeof app>(clientOrigin)
`)
  })

  it('imports the app entry by the specifier it is given', async () => {
    const code = await generateAndRead({ appImport: '@/src/index' })
    expect(code).toContain("import type { app } from '@/src/index'")
  })

  // In a browser the client talks to the page's own origin; the variable is read only without a
  // window, so a browser bundle that has no such variable never reads it.
  it('sameOrigin: the browser uses its own origin and everything else the environment', async () => {
    const code = await generateAndRead({ sameOrigin: true })
    expect(code).toContain(
      "export const clientOrigin = normalizeOrigin(\n  typeof window === 'undefined' ? process.env.API_URL! : window.location.origin,\n)",
    )
    expect(code).toContain('export const client = treaty<typeof app>(clientOrigin)')
  })

  it('baseUrl from import.meta.env: reads the variable, asserted to be set', async () => {
    const code = await generateAndRead({
      baseUrl: { env: 'VITE_API_URL', source: 'import.meta.env' },
    })
    expect(code).toContain(
      'export const clientOrigin = normalizeOrigin(import.meta.env.VITE_API_URL!)',
    )
  })

  // A module that exports the value answers for it: the export is imported and the value used
  // as written, nothing checked here.
  it('baseUrl from a module: imports the export and uses the value as written', async () => {
    const code = await generateAndRead({ baseUrl: { import: '@/env', value: 'env.API_URL' } })
    expect(code).toContain("import { treaty } from '@elysiajs/eden'\nimport { env } from '@/env'")
    expect(code).toContain(
      'export const clientOrigin = normalizeOrigin(env.API_URL)\n\nexport const client = treaty<typeof app>(clientOrigin)',
    )
    expect(code).not.toContain('API_URL!')
    const bare = await generateAndRead({ baseUrl: { import: '../env', value: 'apiUrl' } })
    expect(bare).toContain("import { apiUrl } from '../env'")
    expect(bare).toContain('export const clientOrigin = normalizeOrigin(apiUrl)')
  })

  // Treaty adds a scheme to an origin that has none and drops a trailing slash before it appends a
  // path; the exported origin is read the same way, so a hook that calls fetch with it sends where
  // the client does. An origin imported under that very name does not clash with it.
  it('exports the origin as treaty reads it, under a name of its own', async () => {
    const code = await generateAndRead({ baseUrl: { import: './env', value: 'origin' } })
    expect(code).toContain("import { origin } from './env'")
    expect(code).toContain('export const clientOrigin = normalizeOrigin(origin)')
    const source = code.slice(code.indexOf('function normalizeOrigin'), code.indexOf('\n}\n') + 2)
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-origin-'))
    const file = path.join(dir, 'normalize.ts')
    writeFileSync(file, `export ${source}\n`)
    const { normalizeOrigin } = (await import(file)) as {
      normalizeOrigin: (origin: string) => string
    }
    rmSync(dir, { recursive: true, force: true })
    expect(normalizeOrigin('localhost:3000')).toBe('http://localhost:3000')
    expect(normalizeOrigin('127.0.0.1:3000/')).toBe('http://127.0.0.1:3000')
    expect(normalizeOrigin('api.example.com')).toBe('https://api.example.com')
    expect(normalizeOrigin('https://api.example.com/')).toBe('https://api.example.com')
    expect(normalizeOrigin('http://api.example.com/v1')).toBe('http://api.example.com/v1')
    // An unset variable reaches treaty as it did before: importing the client does not throw.
    expect(normalizeOrigin(undefined as unknown as string)).toBeUndefined()
  })

  // The file declares `treaty`, `client`, `clientOrigin` and `normalizeOrigin` itself, so an export
  // of one of those names is imported under an alias and does not declare it twice.
  it('baseUrl from a module: an export named like a declaration of the file is aliased', async () => {
    const code = await generateAndRead({ baseUrl: { import: './env', value: 'clientOrigin.url' } })
    expect(code).toContain("import { clientOrigin as baseUrl } from './env'")
    expect(code).toContain('export const clientOrigin = normalizeOrigin(baseUrl.url)')
    const plain = await generateAndRead({ baseUrl: { import: './env', value: 'normalizeOrigin' } })
    expect(plain).toContain("import { normalizeOrigin as baseUrl } from './env'")
    expect(plain).toContain('export const clientOrigin = normalizeOrigin(baseUrl)')
  })
})
