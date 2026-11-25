import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  // pulls the server in; the address is the environment's, asserted to be set, and handed to
  // treaty as it is: treaty adds the scheme it lacks and drops a trailing slash itself.
  it('writes a treaty client typed by a type-only import of the app entry', async () => {
    const code = await generateAndRead()
    expect(code).toBe(`import { treaty } from '@elysiajs/eden'
import type { app } from './index'

export const client = treaty<typeof app>(process.env.API_URL!)
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
      "export const client = treaty<typeof app>(\n  typeof window === 'undefined' ? process.env.API_URL! : window.location.origin,\n)",
    )
  })

  it('baseUrl from import.meta.env: reads the variable, asserted to be set', async () => {
    const code = await generateAndRead({
      baseUrl: { env: 'VITE_API_URL', source: 'import.meta.env' },
    })
    expect(code).toContain(
      'export const client = treaty<typeof app>(import.meta.env.VITE_API_URL!)',
    )
  })

  // A module that exports the value answers for it: the export is imported and the value used
  // as written, nothing checked here.
  it('baseUrl from a module: imports the export and uses the value as written', async () => {
    const code = await generateAndRead({ baseUrl: { import: '@/env', value: 'env.API_URL' } })
    expect(code).toContain("import { treaty } from '@elysiajs/eden'\nimport { env } from '@/env'")
    expect(code).toContain('export const client = treaty<typeof app>(env.API_URL)')
    expect(code).not.toContain('API_URL!')
    const bare = await generateAndRead({ baseUrl: { import: '../env', value: 'apiUrl' } })
    expect(bare).toContain("import { apiUrl } from '../env'")
    expect(bare).toContain('export const client = treaty<typeof app>(apiUrl)')
  })

  // The file declares nothing but the client: no origin of its own beside it, nothing that reads
  // the origin the way treaty does.
  it('declares the client alone', async () => {
    const code = await generateAndRead({ baseUrl: { import: './env', value: 'origin' } })
    expect(code).toContain("import { origin } from './env'")
    expect(code).toContain('export const client = treaty<typeof app>(origin)')
    expect(code).not.toMatch(/^(?:export\s+)?(?:async\s+)?function\s/mu)
    expect(code.match(/^(?:export\s+)?(?:const|let)\s/gmu)).toStrictEqual(['export const '])
  })

  // The file declares `treaty`, `app` and `client` itself, so an export of one of those names is
  // imported under an alias and does not declare it twice.
  it('baseUrl from a module: an export named like a declaration of the file is aliased', async () => {
    const code = await generateAndRead({ baseUrl: { import: './env', value: 'client.url' } })
    expect(code).toContain("import { client as baseUrl } from './env'")
    expect(code).toContain('export const client = treaty<typeof app>(baseUrl.url)')
    const plain = await generateAndRead({ baseUrl: { import: './env', value: 'treaty' } })
    expect(plain).toContain("import { treaty as baseUrl } from './env'")
    expect(plain).toContain('export const client = treaty<typeof app>(baseUrl)')
  })
})
