import { afterEach, describe, expect, it } from 'bun:test'

import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig, unstable_serialize } from 'swr'

import {
  getUserQueryKey,
  useCreateUser,
  useGetUser,
  useImmutableListUsers,
  useListItems,
  useListUsers,
} from '../__generated__/swr/hooks'
import { requestLog } from '../hosts/users-app'

/**
 * The generated SWR hooks, rendered against the host app.
 *
 * SWR hooks are React hooks, so unlike the TanStack helpers they cannot be called directly —
 * these render them. `bun test` has no DOM of its own; happydom.ts is preloaded to supply one
 * (see bunfig.toml).
 *
 * Each case gets its own cache, so nothing a previous case fetched can answer for it.
 */
function makeWrapper(cache = new Map()) {
  return ({ children }: { readonly children: ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>{children}</SWRConfig>
  )
}

afterEach(() => {
  requestLog.length = 0
})

describe('generated useSWR hooks', () => {
  it('resolves with the parsed body on 200', async () => {
    const { result } = renderHook(() => useListUsers(), { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(result.current.data).toStrictEqual([
      { id: '1', name: 'Alice' },
      { id: '2', name: 'Bob' },
    ])
    expect(result.current.error).toBeUndefined()
  })

  it('threads a path parameter through to the request', async () => {
    const { result } = renderHook(() => useGetUser({ id: '2' }), { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(result.current.data).toStrictEqual({ id: '2', name: 'Bob' })
    expect(requestLog).toContain('GET /users/2')
  })

  it('surfaces a 404 as an error rather than as data', async () => {
    const { result } = renderHook(() => useGetUser({ id: '404' }), { wrapper: makeWrapper() })

    await waitFor(() => {
      expect(result.current.error).toBeDefined()
    })
    expect(result.current.data).toBeUndefined()
  })
})

describe('generated useSWRImmutable hooks', () => {
  it('resolves with the parsed body, like the plain hook', async () => {
    const { result } = renderHook(() => useImmutableListUsers(), { wrapper: makeWrapper() })

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
    const first = renderHook(() => useImmutableListUsers(), { wrapper: makeWrapper(cache) })
    await waitFor(() => {
      expect(first.result.current.data).toBeDefined()
    })
    const after = requestLog.length

    // The plain hook revalidates on mount (deduping is off in this suite); the immutable one
    // must not, or it is just useSWR under another name.
    const second = renderHook(() => useImmutableListUsers(), { wrapper: makeWrapper(cache) })
    expect(second.result.current.data).toStrictEqual(first.result.current.data)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(requestLog.length).toBe(after)

    renderHook(() => useListUsers(), { wrapper: makeWrapper(cache) })
    await waitFor(() => {
      expect(requestLog.length).toBe(after + 1)
    })
  })
})

describe('SWR key behaviour', () => {
  it('a path-parameter difference serializes to a different cache key', () => {
    const first = getUserQueryKey({ id: '1' })
    const second = getUserQueryKey({ id: '2' })

    expect(unstable_serialize(first)).not.toBe(unstable_serialize(second))
    expect(unstable_serialize(first)).toBe(unstable_serialize(getUserQueryKey({ id: '1' })))
  })

  it('two hooks sharing a key share one cache entry, so the host is called once', async () => {
    const cache = new Map()
    const wrapper = makeWrapper(cache)
    renderHook(() => useListUsers(), { wrapper })
    const { result } = renderHook(() => useListUsers(), { wrapper })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(requestLog.filter((entry) => entry === 'GET /users')).toHaveLength(1)
  })
})

describe('generated useSWRMutation hooks', () => {
  it('does not fire until it is triggered, then resolves with the created resource', async () => {
    const { result } = renderHook(() => useCreateUser(), { wrapper: makeWrapper() })

    expect(requestLog).toStrictEqual([])
    // The trigger takes `{ body, options? }`, so the request body is one level in.
    const created = await result.current.trigger({ body: { name: 'Charlie' } })
    expect(created).toStrictEqual({ id: '99', name: 'Charlie' })
    expect(requestLog).toContain('POST /users')
  })

  it('rejects when the host answers 400', async () => {
    const { result } = renderHook(() => useCreateUser(), { wrapper: makeWrapper() })

    const captured = await result.current.trigger({ body: { name: '' } }).then(
      () => null,
      (error: unknown) => error,
    )
    expect(captured).not.toBeNull()
  })
})

describe('a query hook with parameters', () => {
  it('passes the query through and returns the page it names', async () => {
    const { result } = renderHook(() => useListItems({ query: { page: '1' } }), {
      wrapper: makeWrapper(),
    })

    await waitFor(() => {
      expect(result.current.data).toBeDefined()
    })
    expect(result.current.data).toStrictEqual({ items: ['c', 'd'], nextPage: 2 })
  })
})
