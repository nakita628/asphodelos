import { Elysia, t } from 'elysia'

/**
 * The app every generated hook talks to.
 *
 * Hand-written rather than generated: the point of these tests is what the generated *client*
 * does, so the server has to be a fixed reference the client is measured against. Its routes
 * match specs/users.yaml, schemas included, so the Eden client types each request the way the
 * document promises.
 *
 * `requestLog` is the side channel the tests read to tell "the hook did not fetch" apart from
 * "the hook fetched and the cache answered". `abortLog` records, for each slow request, whether
 * it had been aborted by the time it answered.
 */
export const requestLog: string[] = []

export const abortLog: boolean[] = []

const seed: readonly { id: string; name: string }[] = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
]

const PAGES: readonly (readonly string[])[] = [['a', 'b'], ['c', 'd'], ['e']]

const User = t.Object({ id: t.String(), name: t.String() })
const ApiError = t.Object({ error: t.String() })

export const app = new Elysia()
  .get('/users', () => {
    requestLog.push('GET /users')
    return [...seed]
  })
  .post(
    '/users',
    ({ body, status }) => {
      requestLog.push('POST /users')
      if (body.name === '') return status(400, { error: 'name is required' })
      return status(201, { id: '99', name: body.name })
    },
    {
      // The document's `minLength: 1` is checked by hand so the 400 is the host's own answer, the
      // way the spec describes it, rather than Elysia's validation error.
      body: t.Object({ name: t.String() }),
      response: { 201: User, 400: ApiError },
    },
  )
  .get(
    '/users/:id',
    ({ params, status }) => {
      requestLog.push(`GET /users/${params.id}`)
      const found = seed.find((user) => user.id === params.id)
      return found ?? status(404, { error: 'Not Found' })
    },
    {
      headers: t.Object({ 'x-trace': t.Optional(t.String()) }),
      response: { 200: User, 404: ApiError },
    },
  )
  .delete('/users/:id', ({ params, status }) => {
    requestLog.push(`DELETE /users/${params.id}`)
    return status(204)
  })
  .get(
    '/items',
    ({ query }) => {
      requestLog.push(`GET /items?page=${query.page}`)
      const items = [...(PAGES[query.page] ?? [])]
      const nextPage = query.page + 1 < PAGES.length ? query.page + 1 : undefined
      return nextPage === undefined ? { items } : { items, nextPage }
    },
    {
      query: t.Object({ page: t.Integer({ minimum: 0 }) }),
      // Declared so the client infers the shape the spec promises rather than the literal types
      // of the seed data — a caller writing `getNextPageParam` should see `nextPage?: number`.
      response: {
        200: t.Object({ items: t.Array(t.String()), nextPage: t.Optional(t.Integer()) }),
      },
    },
  )
  .get('/slow', async ({ request }) => {
    requestLog.push('GET /slow')
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    abortLog.push(request.signal.aborted)
    return { ok: true }
  })

export type App = typeof app
