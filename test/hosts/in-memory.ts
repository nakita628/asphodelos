import { app } from './users-app.js'

/**
 * Routes `fetch` to the host app in memory, and answers with what puts it back.
 *
 * The generated client is created with a URL and calls `fetch`; the runtime tests want the app's
 * `requestLog` rather than a socket, so for their duration every request goes to `app.handle`, as
 * `treaty(app)` would send it. Nothing listens on the URL the client names.
 */
export function serveInMemory() {
  // The generated clients read their address from this variable; in memory the address is never
  // used, but the file asserts it is set.
  process.env.ASPHODELOS_TEST_API_URL ??= 'http://localhost'
  const previous = globalThis.fetch
  const inMemory: typeof fetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
      Promise.resolve(
        app.handle(
          input instanceof Request
            ? input
            : new Request(typeof input === 'string' ? input : input.href, init),
        ),
      ),
    { preconnect: previous.preconnect },
  )
  globalThis.fetch = inMemory
  return () => {
    globalThis.fetch = previous
  }
}
