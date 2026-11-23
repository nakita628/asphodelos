import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import { readFile } from '../../fsp/index.js'

/** What the client is created with; see `client.baseUrl` in the config. */
export type BaseUrl =
  | { readonly env: string; readonly source: 'import.meta.env' | 'process.env' }
  | { readonly import: string; readonly value: string }

/**
 * Treaty reads its origin this way before it appends a path: a scheme is added when there is
 * none — `http://` for a local host, `https://` otherwise — and a trailing `/` is dropped. The
 * origin is exported as treaty reads it, so a hook that calls `fetch` with it sends where the
 * client does. A missing origin is passed on as it is, so importing the client still succeeds
 * where the variable is unset and only a request fails, as it did before.
 */
const NORMALIZE = `function normalizeOrigin(origin: string) {
  if (!origin) return origin
  const url = origin.includes('://')
    ? origin
    : \`\${['localhost', '127.0.0.1', '0.0.0.0'].some((host) => origin.includes(host)) ? 'http' : 'https'}://\${origin}\`
  return url.endsWith('/') ? url.slice(0, -1) : url
}`

/** The names the client file declares itself; an export of the same name is imported under an alias. */
const DECLARED = new Set(['treaty', 'app', 'client', 'clientOrigin', 'normalizeOrigin'])

function importCode(baseUrl: { readonly import: string; readonly value: string }) {
  const [name = '', ...rest] = baseUrl.value.split('.')
  if (!DECLARED.has(name)) {
    return [[`import { ${name} } from '${baseUrl.import}'`], baseUrl.value] as const
  }
  const alias = 'baseUrl'
  return [
    [`import { ${name} as ${alias} } from '${baseUrl.import}'`],
    [alias, ...rest].join('.'),
  ] as const
}

/**
 * The base URL as code: an environment variable, read where it is used and asserted to be set —
 * with `sameOrigin`, only without a window, so a browser bundle that has no such variable never
 * reads it — or a URL string a module exports, read as written. Never a URL in the file.
 */
function baseUrlCode(baseUrl: BaseUrl, sameOrigin: boolean) {
  const [imports, expression] =
    'import' in baseUrl ? importCode(baseUrl) : [[], `${baseUrl.source}.${baseUrl.env}!`]
  const value = sameOrigin
    ? `typeof window === 'undefined' ? ${expression} : window.location.origin`
    : expression
  return {
    imports,
    origin: `${NORMALIZE}\n\nexport const clientOrigin = normalizeOrigin(${value})`,
  }
}

/**
 * Generates the Eden Treaty client of the generated app.
 *
 * The client is typed by `typeof app`, through a type-only import of the app entry: the type is
 * worked out from the app as it stands, user code included, and the import is erased before a
 * browser bundle could pull the server in. `treaty` wants an origin — a relative path is read as
 * a host — so with `sameOrigin` the browser is given its own, `window.location.origin`, and
 * `baseUrl` serves the code that runs without a window. Either way the origin is a `const` of
 * its own, `clientOrigin`, read the way treaty reads it, so what the client is created with is
 * read off one declaration. It is exported beside the client: the hooks of a path Eden cannot
 * type call `fetch` with it.
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
      'export const client = treaty<typeof app>(clientOrigin)',
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
