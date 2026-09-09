import { afterEach, describe, expect, it } from 'bun:test'

import { QueryClient } from '@tanstack/react-query'

import {
  getUserQueryOptions,
  getUsersKey,
  listItemsInfiniteQueryOptions,
  listItemsQueryOptions,
  listUsersQueryOptions,
} from '../__generated__/tanstack-query/hooks'
import { requestLog } from '../hosts/users-app'

/**
 * The generated TanStack Query helpers, driven against the host app.
 *
 * The generator's own suite compares emitted source to a string, which says the helper was
 * written but nothing about whether it works: whether the query function resolves, whether the
 * key it builds shares a cache entry with the one next to it, whether an error reaches the cache
 * as an error. Those are properties of the real `QueryClient`, so the real one answers them here.
 *
 * Keys are asserted through their effects — what an invalidation reaches, how many entries two
 * calls produce — rather than by comparing arrays, because an array is only ever a means to those.
 */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

afterEach(() => {
  requestLog.length = 0
})

describe('generated queryOptions', () => {
  it('resolves with the parsed body on 200', async () => {
    const queryClient = makeClient()
    expect(await queryClient.fetchQuery(listUsersQueryOptions())).toStrictEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ])
  })

  it('threads a path parameter through to the request', async () => {
    const queryClient = makeClient()
    expect(await queryClient.fetchQuery(getUserQueryOptions({ id: '2' }))).toStrictEqual({
      id: '2',
      name: 'Bob',
    })
    expect(requestLog).toContain('GET /users/2')
  })

  it('rejects on 404, and the error reaches the cache as an error', async () => {
    const queryClient = makeClient()
    const options = getUserQueryOptions({ id: '404' })
    const captured = await queryClient.fetchQuery(options).then(
      () => null,
      (error: unknown) => error,
    )

    expect(captured).not.toBeNull()
    expect(queryClient.getQueryState(options.queryKey)?.status).toBe('error')
  })
})

describe('query key behaviour, asserted through effects', () => {
  it('invalidating the resource prefix reaches every query under it, and nothing else', async () => {
    const queryClient = makeClient()
    const list = listUsersQueryOptions()
    const single = getUserQueryOptions({ id: '1' })
    const items = listItemsQueryOptions({ query: { page: '0' } })
    await queryClient.fetchQuery(list)
    await queryClient.fetchQuery(single)
    await queryClient.fetchQuery(items)

    await queryClient.invalidateQueries({ queryKey: getUsersKey(), refetchType: 'none' })

    expect(queryClient.getQueryState(list.queryKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(single.queryKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(items.queryKey)?.isInvalidated).toBe(false)
  })

  it('a path-parameter difference creates its own cache entry with its own data', async () => {
    const queryClient = makeClient()
    const first = getUserQueryOptions({ id: '1' })
    const second = getUserQueryOptions({ id: '2' })
    await queryClient.fetchQuery(first)
    await queryClient.fetchQuery(second)

    expect(queryClient.getQueryCache().getAll()).toHaveLength(2)
    // `getQueryData` cannot infer the payload from a key alone, so the read is typed here.
    type User = { readonly id: string; readonly name: string }
    expect(queryClient.getQueryData<User>(first.queryKey)).toStrictEqual({
      id: '1',
      name: 'Alice',
    })
    expect(queryClient.getQueryData<User>(second.queryKey)).toStrictEqual({
      id: '2',
      name: 'Bob',
    })
  })

  it('a second call with the same arguments is served from the cache, not the host', async () => {
    const queryClient = makeClient()
    const options = { ...listUsersQueryOptions(), staleTime: Number.POSITIVE_INFINITY }
    await queryClient.fetchQuery(options)
    const after = requestLog.length
    await queryClient.fetchQuery(options)

    expect(requestLog.length).toBe(after)
  })
})

describe('generated infiniteQueryOptions', () => {
  const pagination = {
    initialPageParam: 0,
    getNextPageParam: (lastPage: { readonly nextPage?: number }) => lastPage.nextPage ?? null,
    buildInit: (pageParam: unknown) => ({ query: { page: String(pageParam) } }),
  }

  it('accumulates pages through getNextPageParam and buildInit', async () => {
    const queryClient = makeClient()
    const data = await queryClient.fetchInfiniteQuery({
      ...listItemsInfiniteQueryOptions({ query: { page: '0' } }, pagination),
      pages: 3,
    })

    expect(data.pages).toStrictEqual([
      { items: ['a', 'b'], nextPage: 1 },
      { items: ['c', 'd'], nextPage: 2 },
      { items: ['e'] },
    ])
    expect(data.pageParams).toStrictEqual([0, 1, 2])
  })

  it('is cached separately from the plain query for the same endpoint', async () => {
    const queryClient = makeClient()
    await queryClient.fetchQuery(listItemsQueryOptions({ query: { page: '0' } }))
    await queryClient.fetchInfiniteQuery(
      listItemsInfiniteQueryOptions({ query: { page: '0' } }, pagination),
    )

    expect(queryClient.getQueryCache().getAll()).toHaveLength(2)
  })
})
