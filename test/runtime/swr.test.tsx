import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { EdenFetchError } from '@elysiajs/eden'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig, unstable_serialize } from 'swr'

import {
  getGetItemsInfiniteKey,
  getGetUsersIdKey,
  useDeleteUsersId,
  useGetUsers,
  useGetUsersId,
  useImmutableGetUsers,
  useInfiniteGetItems,
  usePostUsers,
} from '../__generated__/swr/hooks.js'
import { serveInMemory } from '../hosts/in-memory.js'
import { requestLog } from '../hosts/users-app.js'

/**
 * The generated SWR hooks, rendered with @testing-library/react against the host app.
 *
 * Three kinds of hooks are generated: `useSWR` hooks for GET operations (with an immutable twin),
 * `useSWRMutation` hooks for the others, and `useSWRInfinite` hooks for paginated ones. SWR hooks
 * are React hooks, so unlike the TanStack helpers they cannot be called directly — these render
 * them. `bun test` has no DOM of its own; happydom.ts is preloaded to supply one (see
 * bunfig.toml). Each case gets its own cache, so nothing a previous case fetched can answer for it.
 */
function makeWrapper(cache = new Map()) {
  return ({ children }: { readonly children: ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
  )
}

const pagination = {
  getRequestArgs: (options: { readonly query: { readonly page: number } }, index: number) => ({
    ...options,
    query: { ...options.query, page: index },
  }),
}

const restoreFetch = { restore: () => {} }

beforeAll(() => {
  restoreFetch.restore = serveInMemory()
})

afterEach(() => {
  requestLog.length = 0
})

afterAll(() => {
  restoreFetch.restore()
})

describe('generated useSWR hooks', () => {
  it('resolves with the parsed body on 200', async () => {
    const { result } = renderHook(() => useGetUsers(), { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(result.current.data).toStrictEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ])
    expect(result.current.error).toBeUndefined()
  })

  // The swr option is typed by the response of the operation: fallbackData must have the shape
  // of the response, and onSuccess receives it typed. fallbackData is shown first, then replaced
  // by the fetched data.
  it('SWRConfiguration is typed by the response, so fallbackData and onSuccess are not any', async () => {
    const seen: { readonly id: string; readonly name: string }[][] = []
    const { result } = renderHook(
      () =>
        useGetUsers({
          swr: {
            fallbackData: [{ id: '0', name: 'Fallback' }],
            onSuccess(data) {
              seen.push([...data])
            },
          },
        }),
      { wrapper: makeWrapper() },
    )
    expect(result.current.data).toStrictEqual([{ id: '0', name: 'Fallback' }])
    await waitFor(() => {
      expect(seen.length).toBe(1)
    })
    expect(seen).toStrictEqual([
      [
        { id: '1', name: 'Alice' },
        { id: '2', name: 'Bob' },
      ],
    ])
  })

  it('threads a path parameter through to the request', async () => {
    const { result } = renderHook(() => useGetUsersId({ id: '2' }), { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(result.current.data).toStrictEqual({ id: '2', name: 'Bob' })
    expect(requestLog).toContain('GET /users/2')
  })

  // The error is the client's own, typed by the operation: its status is read with no cast.
  it('surfaces a 404 as the client error in the error state', async () => {
    const { result } = renderHook(() => useGetUsersId({ id: '999' }), { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(result.current.error).toBeDefined()
    })
    expect(result.current.error).toBeInstanceOf(EdenFetchError)
    const status: number | undefined = result.current.error?.status
    expect(status).toBe(404)
    expect(result.current.data).toBeUndefined()
  })
})

describe('generated useSWRImmutable hooks', () => {
  it('resolves with the parsed body, like the plain hook', async () => {
    const { result } = renderHook(() => useImmutableGetUsers(), { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(result.current.data).toStrictEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ])
  })

  it('a second mount is served from the cache without revalidating', async () => {
    const cache = new Map()
    const first = renderHook(() => useImmutableGetUsers(), { wrapper: makeWrapper(cache) })
    await waitFor(() => {
      expect(first.result.current.data).toBeDefined()
    })
    const after = requestLog.length

    // The plain hook revalidates on mount (deduping is off in this suite); the immutable one
    // must not, or it is just useSWR under another name.
    const second = renderHook(() => useImmutableGetUsers(), { wrapper: makeWrapper(cache) })
    expect(second.result.current.data).toStrictEqual(first.result.current.data)
    await new Promise((resolve) => {
      setTimeout(resolve, 50)
    })
    expect(requestLog.length).toBe(after)

    renderHook(() => useGetUsers(), { wrapper: makeWrapper(cache) })
    await waitFor(() => {
      expect(requestLog.length).toBe(after + 1)
    })
  })
})

describe('SWR key behavior', () => {
  // enabled: false turns the key into null, which is how SWR is told not to fetch. No request
  // reaches the host.
  it('enabled:false yields a null key and never fetches', async () => {
    const before = requestLog.length
    const { result } = renderHook(() => useGetUsers({ swr: { enabled: false } }), {
      wrapper: makeWrapper(),
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 30)
    })
    expect(result.current.swrKey).toBeNull()
    expect(result.current.data).toBeUndefined()
    expect(requestLog.length).toBe(before)
  })

  // swrKey: null is the way SWR itself disables a hook, and it is kept as null rather than
  // replaced by the generated key.
  it('swrKey:null yields a null key and never fetches', async () => {
    const before = requestLog.length
    const { result } = renderHook(() => useGetUsers({ swr: { swrKey: null } }), {
      wrapper: makeWrapper(),
    })
    await new Promise((resolve) => {
      setTimeout(resolve, 30)
    })
    expect(result.current.swrKey).toBeNull()
    expect(result.current.data).toBeUndefined()
    expect(requestLog.length).toBe(before)
  })

  it('a custom swrKey overrides the generated key, and the fetch still happens', async () => {
    const { result } = renderHook(() => useGetUsers({ swr: { swrKey: ['custom', 'users'] } }), {
      wrapper: makeWrapper(),
    })
    expect(result.current.swrKey).toStrictEqual(['custom', 'users'])
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
  })

  it('a path-parameter difference serializes to a different cache key', () => {
    const first = getGetUsersIdKey({ id: '1' })
    const second = getGetUsersIdKey({ id: '2' })

    expect(unstable_serialize(first)).not.toBe(unstable_serialize(second))
    expect(unstable_serialize(first)).toBe(unstable_serialize(getGetUsersIdKey({ id: '1' })))
  })

  // A header is not part of the key: a second hook that differs only in its header has the data
  // at once, without fetching, while a hook for another id starts empty.
  it('a header-only difference shares the cache entry across hook mounts', async () => {
    const cache = new Map()
    const first = renderHook(
      () => useGetUsersId({ id: '1' }, { options: { headers: { 'x-trace': 'a' } } }),
      { wrapper: makeWrapper(cache) },
    )
    await waitFor(() => {
      expect(first.result.current.data).toBeDefined()
    })

    const second = renderHook(
      () => useGetUsersId({ id: '1' }, { options: { headers: { 'x-trace': 'b' } } }),
      { wrapper: makeWrapper(cache) },
    )
    expect(second.result.current.data).toStrictEqual({ id: '1', name: 'Alice' })

    const distinct = renderHook(
      () => useGetUsersId({ id: '2' }, { options: { headers: { 'x-trace': 'a' } } }),
      { wrapper: makeWrapper(cache) },
    )
    expect(distinct.result.current.data).toBeUndefined()
    await waitFor(() => {
      expect(distinct.result.current.data).toBeDefined()
    })
  })

  it('two hooks sharing a key share one cache entry, so the host is called once', async () => {
    const cache = new Map()
    const wrapper = makeWrapper(cache)
    renderHook(() => useGetUsers(), { wrapper })
    const { result } = renderHook(() => useGetUsers(), { wrapper })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(requestLog.filter((entry) => entry === 'GET /users')).toHaveLength(1)
  })
})

describe('generated useSWRMutation hooks', () => {
  it('does not fire until it is triggered, then resolves with the created resource', async () => {
    const { result } = renderHook(() => usePostUsers(), { wrapper: makeWrapper() })

    expect(requestLog).toStrictEqual([])
    // The trigger takes `{ body, options? }`, so the request body is one level in.
    const created = await result.current.trigger({ body: { name: 'Charlie' } })
    expect(created).toStrictEqual({ id: '99', name: 'Charlie' })
    await waitFor(() => {
      expect(result.current.data).toStrictEqual({ id: '99', name: 'Charlie' })
    })
    expect(requestLog).toStrictEqual(['POST /users'])
  })

  // A 400 rejects trigger with the client error, and the same error becomes the error of the
  // hook.
  it('trigger rejects with the client error on 400', async () => {
    const { result } = renderHook(() => usePostUsers(), { wrapper: makeWrapper() })

    const captured = await result.current.trigger({ body: { name: '' } }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(captured).toBeInstanceOf(EdenFetchError)
    expect(captured).toMatchObject({ status: 400 })
    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(EdenFetchError)
    })
  })

  // The body is optional when the operation has none, so a DELETE is triggered with `{}`. 204 has
  // no body, so the trigger resolves with an empty value.
  it('trigger resolves without data on 204 No Content', async () => {
    const { result } = renderHook(() => useDeleteUsersId({ id: '1' }), { wrapper: makeWrapper() })
    expect(await result.current.trigger({})).toBeFalsy()
    expect(requestLog).toStrictEqual(['DELETE /users/1'])
  })

  // With throwOnError: false the rejection is swallowed: trigger resolves with undefined, and
  // the error is only on the hook.
  it('throwOnError: false makes trigger resolve undefined and surface the error on the hook', async () => {
    const { result } = renderHook(() => usePostUsers({ mutation: { throwOnError: false } }), {
      wrapper: makeWrapper(),
    })
    expect(await result.current.trigger({ body: { name: '' } })).toBeUndefined()
    await waitFor(() => {
      expect(result.current.error).toBeInstanceOf(EdenFetchError)
    })
  })
})

describe('generated useSWRInfinite hooks', () => {
  // The generated key loader adds the page index to the key, and getRequestArgs turns the index
  // into the options of the request. Growing the size to 2 fetches the second page.
  it('the key loader appends the page index and getRequestArgs receives it', async () => {
    const { result } = renderHook(
      () => useInfiniteGetItems({ options: { query: { page: 0 } }, pagination }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(result.current.data).toStrictEqual([{ items: ['a', 'b'], nextPage: 1 }])

    void result.current.setSize(2)
    await waitFor(() => {
      expect(result.current.data).toHaveLength(2)
    })
    expect(result.current.data).toStrictEqual([
      { items: ['a', 'b'], nextPage: 1 },
      { items: ['c', 'd'], nextPage: 2 },
    ])
  })

  // enabled: false replaces the key loader with one that returns null for every page, so not
  // even the first page is fetched.
  it('enabled:false never fetches any page', async () => {
    const before = requestLog.length
    const { result } = renderHook(
      () =>
        useInfiniteGetItems({
          swr: { enabled: false },
          options: { query: { page: 0 } },
          pagination,
        }),
      { wrapper: makeWrapper() },
    )
    await new Promise((resolve) => {
      setTimeout(resolve, 30)
    })
    expect(result.current.data).toBeUndefined()
    expect(requestLog.length).toBe(before)
  })

  // A key loader passed by the caller may return null for a page, which stops the paging there:
  // the size grows to 2, and no request is made for the second page.
  it('a custom swrKey loader may return null to stop paging', async () => {
    const { result } = renderHook(
      () =>
        useInfiniteGetItems({
          swr: {
            swrKey: (index) =>
              index === 0
                ? ([...getGetItemsInfiniteKey({ query: { page: 0 } }), index] as const)
                : null,
          },
          options: { query: { page: 0 } },
          pagination,
        }),
      { wrapper: makeWrapper() },
    )
    await waitFor(() => {
      expect(result.current.data).toStrictEqual([{ items: ['a', 'b'], nextPage: 1 }])
    })
    void result.current.setSize(2)
    await waitFor(() => {
      expect(result.current.size).toBe(2)
    })
    expect(result.current.data).toStrictEqual([{ items: ['a', 'b'], nextPage: 1 }])
    expect(requestLog.filter((entry) => entry.includes('page=1'))).toHaveLength(0)
  })
})
