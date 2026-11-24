import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { EdenFetchError } from '@elysiajs/eden'
import { MutationObserver, QueryClient } from '@tanstack/react-query'

import {
  getDeleteUsersIdMutationOptions,
  getItemsInfiniteQueryKey,
  getItemsInfiniteQueryOptions,
  getItemsQueryOptions,
  getPostUsersMutationOptions,
  getSlowQueryOptions,
  getUsersIdQueryOptions,
  getUsersKey,
  getUsersQueryOptions,
} from '../__generated__/tanstack-query/hooks.js'
import { serveInMemory } from '../hosts/in-memory.js'
import { abortLog, requestLog } from '../hosts/users-app.js'

/**
 * The generated TanStack Query helpers, driven against the host app with a real `QueryClient`.
 *
 * Three families of helpers are generated per operation: `get<Name>QueryOptions`,
 * `get<Name>InfiniteQueryOptions` and `get<Name>MutationOptions`, each with a key getter. The
 * generator's own suite compares emitted source to a string, which says the helper was written
 * but nothing about whether it works. Keys are asserted through what they do to the cache (what
 * an invalidation reaches, what shares an entry) rather than through their shape alone, because
 * the effect is what a caller depends on.
 */
function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY, staleTime: 0 },
      mutations: { retry: false },
    },
  })
}

/** Polls until `check` passes, the way a component would see the state settle. */
async function waitFor(check: () => void, timeout = 1000) {
  const deadline = Date.now() + timeout
  for (;;) {
    try {
      check()
      return
    } catch (error) {
      if (Date.now() > deadline) throw error
      await new Promise((resolve) => {
        setTimeout(resolve, 10)
      })
    }
  }
}

const pagination = {
  initialPageParam: 0,
  getNextPageParam: (lastPage: { readonly nextPage?: number }) => lastPage.nextPage,
  getRequestArgs: (options: { readonly query: { readonly page: number } }, pageParam: unknown) => ({
    ...options,
    query: { ...options.query, page: Number(pageParam) },
  }),
}

// The host records every request it serves, and whether each slow request was aborted.
const restoreFetch = { restore: () => {} }

beforeAll(() => {
  restoreFetch.restore = serveInMemory()
})

afterEach(() => {
  requestLog.length = 0
  abortLog.length = 0
})

afterAll(() => {
  restoreFetch.restore()
})

describe('generated queryOptions', () => {
  // The result is read into a const before it meets `expect`: bun's `expect(actual?: T)` gives
  // its argument the contextual type `T | undefined`, and a generic factory called inside it
  // would take `undefined` for its `TData` default.
  it('queryFn resolves with the parsed body on 200', async () => {
    const queryClient = makeClient()
    const users = await queryClient.query(getUsersQueryOptions())
    expect(users).toStrictEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ])
  })

  it('threads a path parameter through to the request', async () => {
    const queryClient = makeClient()
    const user = await queryClient.query(getUsersIdQueryOptions({ id: '2' }))
    expect(user).toStrictEqual({ id: '2', name: 'Bob' })
    expect(requestLog).toContain('GET /users/2')
  })

  // A non-2xx response rejects with the client's error, which carries the status and the body,
  // and the query cache records the same error: a component reading the state sees it.
  it('queryFn rejects with the client error on 404 and the error reaches the cache', async () => {
    const queryClient = makeClient()
    const options = getUsersIdQueryOptions({ id: '999' })
    const captured = await queryClient.query(options).then(
      () => null,
      (error: unknown) => error,
    )
    expect(captured).toBeInstanceOf(EdenFetchError)
    expect(captured).toMatchObject({ status: 404, value: { error: 'Not Found' } })
    const state = queryClient.getQueryState(options.queryKey)
    expect(state?.status).toBe('error')
    expect(state?.error).toBeInstanceOf(EdenFetchError)
  })
})

describe('query key behavior, asserted through effects', () => {
  // getUsersKey() is the prefix of every key under /users. Invalidating it marks the list and
  // the single user, and leaves /items alone.
  it('invalidating the resource prefix reaches every query under it, and nothing else', async () => {
    const queryClient = makeClient()
    const list = getUsersQueryOptions()
    const single = getUsersIdQueryOptions({ id: '1' })
    const items = getItemsQueryOptions({ query: { page: 0 } })
    await queryClient.query(list)
    await queryClient.query(single)
    await queryClient.query(items)

    await queryClient.invalidateQueries({ queryKey: getUsersKey(), refetchType: 'none' })

    expect(queryClient.getQueryState(list.queryKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(single.queryKey)?.isInvalidated).toBe(true)
    expect(queryClient.getQueryState(items.queryKey)?.isInvalidated).toBe(false)
  })

  // A header is not part of the query key: two requests for the same user that differ only in
  // x-trace share one cache entry.
  it('a header-only difference hits the same cache entry', async () => {
    const queryClient = makeClient()
    await queryClient.query(getUsersIdQueryOptions({ id: '1' }, { headers: { 'x-trace': 'a' } }))
    await queryClient.query(getUsersIdQueryOptions({ id: '1' }, { headers: { 'x-trace': 'b' } }))
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
  })

  it('a path-parameter difference creates its own cache entry with its own data', async () => {
    const queryClient = makeClient()
    const first = getUsersIdQueryOptions({ id: '1' })
    const second = getUsersIdQueryOptions({ id: '2' })
    await queryClient.query(first)
    await queryClient.query(second)

    expect(queryClient.getQueryCache().getAll()).toHaveLength(2)
    // The tagged key types the read; it is hoisted for the reason given on the first test.
    const firstData = queryClient.getQueryData(first.queryKey)
    const secondData = queryClient.getQueryData(second.queryKey)
    expect(firstData).toStrictEqual({ id: '1', name: 'Alice' })
    expect(secondData).toStrictEqual({ id: '2', name: 'Bob' })
  })

  it('a second call with the same arguments is served from the cache, not the host', async () => {
    const queryClient = makeClient()
    const options = { ...getUsersQueryOptions(), staleTime: Number.POSITIVE_INFINITY }
    await queryClient.query(options)
    const after = requestLog.length
    await queryClient.query(options)

    expect(requestLog.length).toBe(after)
  })

  // The infinite key carries 'infinite' before the arguments, so an infinite query and a plain
  // query for the same endpoint never collide, and the infinite prefix matches infinite queries
  // only.
  it('infinite and plain queries for the same endpoint are cached independently', async () => {
    const queryClient = makeClient()
    await queryClient.query(getItemsQueryOptions({ query: { page: 0 } }))
    await queryClient.infiniteQuery(
      getItemsInfiniteQueryOptions(pagination, { query: { page: 0 } }),
    )

    expect(queryClient.getQueryCache().getAll()).toHaveLength(2)
    expect(getItemsInfiniteQueryKey({ query: { page: 0 } })).toStrictEqual([
      'items',
      '/items',
      'infinite',
      { query: { page: 0 } },
    ])
    const cache = queryClient.getQueryCache()
    expect(cache.findAll({ queryKey: ['items', '/items', 'infinite'] })).toHaveLength(1)
    expect(
      cache.findAll({ queryKey: getItemsQueryOptions({ query: { page: 0 } }).queryKey }),
    ).toHaveLength(1)
  })
})

describe('generated infiniteQueryOptions', () => {
  // getRequestArgs turns the page parameter into the request options, and getNextPageParam
  // reads the next page from the response. Three pages are fetched; the last has no nextPage,
  // which ends the paging.
  it('pages accumulate through getNextPageParam and getRequestArgs', async () => {
    const queryClient = makeClient()
    const data = await queryClient.infiniteQuery({
      ...getItemsInfiniteQueryOptions(pagination, { query: { page: 0 } }),
      pages: 3,
    })

    expect(data.pages).toStrictEqual([
      { items: ['a', 'b'], nextPage: 1 },
      { items: ['c', 'd'], nextPage: 2 },
      { items: ['e'] },
    ])
    expect(data.pageParams).toStrictEqual([0, 1, 2])
  })

  // allPageParams is typed as number[], the type of initialPageParam, not as unknown[]: the
  // assignment to number[] compiles only if the generic reaches the callback.
  it('getNextPageParam receives allPageParams typed as TPageParam[]', async () => {
    const queryClient = makeClient()
    const seen: number[][] = []
    await queryClient.infiniteQuery({
      ...getItemsInfiniteQueryOptions(
        {
          ...pagination,
          getNextPageParam: (lastPage, _allPages, _lastPageParam, allPageParams) => {
            const params: number[] = [...allPageParams]
            seen.push(params)
            return lastPage.nextPage
          },
        },
        { query: { page: 0 } },
      ),
      pages: 3,
    })
    expect(seen).toStrictEqual([[0], [0, 1]])
  })
})

describe('generated mutationOptions', () => {
  // The generated mutationFn, run through an observer: 201 resolves with the created resource.
  it('mutationFn resolves with the created resource on 201', async () => {
    const observer = new MutationObserver(makeClient(), getPostUsersMutationOptions())
    const created = await observer.mutate({ body: { name: 'Charlie' } })
    expect(created).toStrictEqual({ id: '99', name: 'Charlie' })
    expect(requestLog).toStrictEqual(['POST /users'])
  })

  it('mutationFn rejects with the client error on 400', async () => {
    const observer = new MutationObserver(makeClient(), getPostUsersMutationOptions())
    const captured = await observer.mutate({ body: { name: '' } }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(captured).toBeInstanceOf(EdenFetchError)
    expect(captured).toMatchObject({ status: 400, value: { error: 'name is required' } })
  })

  // The second type argument, TOnMutateResult, types what onMutate returns and what onError and
  // onSettled receive: previous is read with no cast. This is what an optimistic update relies
  // on to roll back.
  it("onMutate's return value reaches onError/onSettled typed as TOnMutateResult", async () => {
    const rolledBack: (readonly string[])[] = []
    const settled: (readonly string[])[] = []
    const observer = new MutationObserver(makeClient(), {
      ...getPostUsersMutationOptions<EdenFetchError, { readonly previous: readonly string[] }>(),
      onMutate() {
        return { previous: ['Alice'] }
      },
      onError(_error, _variables, onMutateResult) {
        const previous: readonly string[] | undefined = onMutateResult?.previous
        if (previous !== undefined) rolledBack.push(previous)
      },
      onSettled(_data, _error, _variables, onMutateResult) {
        const previous: readonly string[] | undefined = onMutateResult?.previous
        if (previous !== undefined) settled.push(previous)
      },
    })
    await observer.mutate({ body: { name: '' } }).then(
      () => null,
      () => null,
    )
    expect(rolledBack).toStrictEqual([['Alice']])
    expect(settled).toStrictEqual([['Alice']])
  })

  // The body is optional when the operation has none, so a DELETE is triggered with `{}`. 204 has
  // no body, so the mutation resolves with an empty value.
  it('mutationFn resolves without data on 204 No Content', async () => {
    const observer = new MutationObserver(
      makeClient(),
      getDeleteUsersIdMutationOptions({ id: '1' }),
    )
    const result = await observer.mutate({})
    expect(result).toBeFalsy()
    expect(requestLog).toStrictEqual(['DELETE /users/1'])
  })
})

describe('fetch cancellation', () => {
  // The generated queryFn passes TanStack Query's AbortSignal to the request. Cancelling the
  // query aborts the request: the host, which records whether its request was aborted, sees true.
  it('queryFn forwards the abort signal to the underlying request', async () => {
    const queryClient = makeClient()
    const options = getSlowQueryOptions()
    const pending = (async () => {
      try {
        return await queryClient.query(options)
      } catch (error: unknown) {
        return error
      }
    })()
    await new Promise((resolve) => {
      setTimeout(resolve, 10)
    })
    await queryClient.cancelQueries({ queryKey: options.queryKey })
    expect(await pending).toBeInstanceOf(Error)
    await waitFor(() => {
      expect(abortLog).toStrictEqual([true])
    })
  })
})
