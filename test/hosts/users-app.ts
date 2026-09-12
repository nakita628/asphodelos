import { Elysia, t } from 'elysia'

/**
 * The app every generated hook talks to.
 *
 * Hand-written rather than generated: the point of these tests is what the generated *client*
 * does, so the server has to be a fixed reference the client is measured against. Its routes
 * match specs/users.yaml.
 *
 * `requestLog` is the side channel the tests read to tell "the hook did not fetch" apart from
 * "the hook fetched and the cache answered".
 */
export const requestLog: string[] = []

const seed: readonly { id: string; name: string }[] = [
  { id: '1', name: 'Alice' },
  { id: '2', name: 'Bob' },
]

const PAGES: readonly { items: string[]; nextPage?: number }[] = [
  { items: ['a', 'b'], nextPage: 1 },
  { items: ['c', 'd'], nextPage: 2 },
  { items: ['e'] },
]

export const app = new Elysia()
  .get('/users', () => {
    requestLog.push('GET /users')
    return [...seed]
  })
  .post(
    '/users',
    ({ body, status }) => {
      requestLog.push('POST /users')
      if (body.name === '') return status(400, { message: 'name is required' })
      return status(201, { id: '99', name: body.name })
    },
    {
      body: t.Object({ name: t.String() }),
      response: {
        201: t.Object({ id: t.String(), name: t.String() }),
        400: t.Object({ message: t.String() }),
      },
    },
  )
  .get(
    '/users/:id',
    ({ params, status }) => {
      requestLog.push(`GET /users/${params.id}`)
      const found = seed.find((user) => user.id === params.id)
      return found ?? status(404, { message: 'not found' })
    },
    {
      response: {
        200: t.Object({ id: t.String(), name: t.String() }),
        404: t.Object({ message: t.String() }),
      },
    },
  )
  .delete('/users/:id', ({ status }) => {
    requestLog.push('DELETE /users/:id')
    return status(204)
  })
  .get(
    '/items',
    ({ query }) => {
      requestLog.push(`GET /items?page=${query.page ?? ''}`)
      const page = Number.parseInt(query.page ?? '0', 10)
      return PAGES[page] ?? { items: [] }
    },
    {
      // Declared so the client infers the shape the spec promises rather than the literal types
      // of the seed data — a caller writing `getNextPageParam` should see `nextPage?: number`.
      response: {
        200: t.Object({ items: t.Array(t.String()), nextPage: t.Optional(t.Number()) }),
      },
    },
  )

export type App = typeof app
