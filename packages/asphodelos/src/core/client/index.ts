import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import { readFile } from '../../fsp/index.js'

/** What the client is created with; see `client.baseUrl` in the config. */
export type BaseUrl =
  | { readonly env: string; readonly source: 'import.meta.env' | 'process.env' }
  | { readonly import: string; readonly value: string }

/**
 * The base URL as code: an environment variable, read where it is used and asserted to be set —
 * with `sameOrigin`, only without a window, so a browser bundle that has no such variable never
 * reads it — or a value a module exports, used as written. Never a URL in the file.
 */
function baseUrlCode(baseUrl: BaseUrl, sameOrigin: boolean) {
  const [imports, expression] =
    'import' in baseUrl
      ? [
          [`import { ${String(baseUrl.value.split('.')[0])} } from '${baseUrl.import}'`],
          baseUrl.value,
        ]
      : [[], `${baseUrl.source}.${baseUrl.env}!`]
  const origin = sameOrigin
    ? `const origin = typeof window === 'undefined' ? ${expression} : window.location.origin`
    : `const origin = ${expression}`
  return { imports, origin }
}

/**
 * Generates the Eden Treaty client of the generated app.
 *
 * The client is typed by `typeof app`, through a type-only import of the app entry: the type is
 * worked out from the app as it stands, user code included, and the import is erased before a
 * browser bundle could pull the server in. `treaty` wants an origin — a relative path is read as
 * a host — so with `sameOrigin` the browser is given its own, `window.location.origin`, and
 * `baseUrl` serves the code that runs without a window. Either way the origin is a `const` of
 * its own, so what the client is created with is read off one line.
 */
export function client(
  output: string,
  options: {
    /** The specifier the client file imports the app entry by. */
    readonly appImport: string
    readonly baseUrl: BaseUrl
    readonly sameOrigin: boolean
    /** The `index.ts` beside the client that re-exports it, when the client is to have one. */
    readonly barrel?: string
  },
) {
  return Effect.gen(function* () {
    const { imports, origin } = baseUrlCode(options.baseUrl, options.sameOrigin)
    const code = [
      ["import { treaty } from '@elysiajs/eden'", ...imports].join('\n'),
      `import type { app } from '${options.appImport}'`,
      origin,
      'export const client = treaty<typeof app>(origin)',
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
