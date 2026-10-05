import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import { readFile } from '../../fsp/index.js'

/** What the client is created with; see `client.baseUrl` in the config. */
export type BaseUrl =
  | string
  | { readonly env: string; readonly source: 'import.meta.env' | 'process.env' }
  | { readonly env: string; readonly import: string; readonly name: string }

/**
 * The base URL as code: a URL written into the file is a literal; one read from the environment
 * is read once, into `baseUrl`, with `fallback` in its place when the variable is not set; one
 * read from an environment a module exports is that property, which the module answers for.
 */
function baseUrlCode(baseUrl: BaseUrl, fallback: string) {
  if (typeof baseUrl === 'string') {
    return { imports: [], declarations: [], url: JSON.stringify(baseUrl) }
  }
  if ('import' in baseUrl) {
    return {
      imports: [`import { ${baseUrl.name} } from '${baseUrl.import}'`],
      declarations: [],
      url: `${baseUrl.name}.${baseUrl.env}`,
    }
  }
  return {
    imports: [],
    declarations: [
      `const baseUrl = ${baseUrl.source}.${baseUrl.env} ?? ${JSON.stringify(fallback)}`,
    ],
    url: 'baseUrl',
  }
}

/**
 * Generates the Eden Treaty client of the generated app.
 *
 * The client is typed by `typeof app`, through a type-only import of the app entry: the type is
 * worked out from the app as it stands, user code included, and the import is erased before a
 * browser bundle could pull the server in. `treaty` wants an origin — a relative path is read as
 * a host — so with `sameOrigin` the browser is given its own, `window.location.origin`, and
 * `baseUrl` serves the code that runs without a window.
 */
export function client(
  output: string,
  options: {
    /** The specifier the client file imports the app entry by. */
    readonly appImport: string
    readonly baseUrl: BaseUrl
    /** The URL an environment variable left unset falls back to. */
    readonly fallback: string
    readonly sameOrigin: boolean
    /** The `index.ts` beside the client that re-exports it, when the client is to have one. */
    readonly barrel?: string
  },
) {
  return Effect.gen(function* () {
    const { imports, declarations, url } = baseUrlCode(options.baseUrl, options.fallback)
    const origin = options.sameOrigin
      ? [`const origin = typeof window === 'undefined' ? ${url} : window.location.origin`]
      : []
    const code = [
      ["import { treaty } from '@elysiajs/eden'", ...imports].join('\n'),
      `import type { app } from '${options.appImport}'`,
      ...declarations,
      ...origin,
      `export const client = treaty<typeof app>(${options.sameOrigin ? 'origin' : url})`,
    ].join('\n\n')
    yield* emit(`${code}\n`, path.dirname(output), output)
    if (options.barrel !== undefined) {
      // A barrel that is there already keeps what it exports and gains the client.
      const line = `export * from './${path.basename(output, '.ts')}'`
      const existing = (yield* readFile(options.barrel)) ?? ''
      const lines = existing.split('\n').map((text) => text.trim().replace(/;$/u, ''))
      if (!lines.some((text) => text.replaceAll('"', "'") === line)) {
        yield* emit(
          `${existing.trimEnd()}\n${line}\n`,
          path.dirname(options.barrel),
          options.barrel,
        )
      }
    }
    return `Generated client written to ${output}`
  })
}
