import { afterAll, afterEach, beforeAll, describe, expect, it } from 'bun:test'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

import {
  getPostUsersMutationKey,
  getPostUsersMutationOptions,
  usePostUsers,
} from '../__generated__/tanstack-query/hooks.js'
import { serveInMemory } from '../hosts/in-memory.js'
import { requestLog } from '../hosts/users-app.js'

/**
 * The generated TanStack Query mutation hooks, rendered with @testing-library/react against the
 * host app.
 *
 * A generated hook always runs the generated `mutationFn`. What a caller passes is layered on
 * top: a `mutationKey` of their own replaces the generated one, their callbacks still fire, and
 * defaults registered with `setMutationDefaults` under their key still apply.
 */
function makeClient() {
  return new QueryClient({ defaultOptions: { mutations: { retry: false } } })
}

function makeWrapper(queryClient: QueryClient) {
  return ({ children }: { readonly children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const generatedKey = getPostUsersMutationKey()

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

describe('generated useMutation hooks', () => {
  // The second argument of the hook is a QueryClient. With it, the hook works outside any
  // QueryClientProvider, and the mutation lands in that client's cache.
  it('forwards an explicit queryClient, so no provider is needed', async () => {
    const queryClient = makeClient()
    const { result } = renderHook(() => usePostUsers(undefined, queryClient))
    const created = await act(() => result.current.mutateAsync({ body: { name: 'Frank' } }))
    expect(created).toStrictEqual({ id: '99', name: 'Frank' })
    const cached = queryClient.getMutationCache().find({ mutationKey: generatedKey, exact: true })
    expect(cached?.state.data).toStrictEqual({ id: '99', name: 'Frank' })
  })

  // The key getter and the options factory must return the same key, or a caller filtering the
  // cache by the getter would find nothing. The key is [prefix, path, method].
  it('the mutation key getter and the options factory agree on the key', () => {
    expect(getPostUsersMutationOptions().mutationKey).toStrictEqual(generatedKey)
    expect(generatedKey).toStrictEqual(['users', '/users', 'POST'])
  })

  it('runs the factory mutationFn under the generated mutationKey by default', async () => {
    const queryClient = makeClient()
    const { result } = renderHook(() => usePostUsers(), { wrapper: makeWrapper(queryClient) })
    const created = await act(() => result.current.mutateAsync({ body: { name: 'Carol' } }))
    expect(created).toStrictEqual({ id: '99', name: 'Carol' })
    await waitFor(() => {
      expect(result.current.data).toStrictEqual({ id: '99', name: 'Carol' })
    })
    expect(requestLog).toStrictEqual(['POST /users'])
    const cached = queryClient.getMutationCache().find({ mutationKey: generatedKey, exact: true })
    expect(cached?.state.data).toStrictEqual({ id: '99', name: 'Carol' })
  })

  // A mutationKey passed by the caller replaces the generated one: the result is cached under
  // the custom key and nothing under the generated key. The request is still the generated one.
  it("a caller's mutationKey overrides the generated key while the factory mutationFn still runs", async () => {
    const queryClient = makeClient()
    const { result } = renderHook(
      () => usePostUsers({ mutation: { mutationKey: ['custom', 'users'] } }),
      { wrapper: makeWrapper(queryClient) },
    )
    const created = await act(() => result.current.mutateAsync({ body: { name: 'Dave' } }))
    expect(created).toStrictEqual({ id: '99', name: 'Dave' })
    await waitFor(() => {
      expect(result.current.data).toStrictEqual({ id: '99', name: 'Dave' })
    })
    expect(requestLog).toStrictEqual(['POST /users'])
    const cache = queryClient.getMutationCache()
    expect(cache.find({ mutationKey: ['custom', 'users'], exact: true })?.state.data).toStrictEqual(
      { id: '99', name: 'Dave' },
    )
    expect(cache.find({ mutationKey: generatedKey, exact: true })).toBeUndefined()
  })

  // Defaults registered under the custom key apply to the hook, and the callback passed to the
  // hook fires as well, first.
  it("a caller's mutationKey reaches setMutationDefaults, and the caller's callbacks still fire", async () => {
    const queryClient = makeClient()
    const seen: string[] = []
    queryClient.setMutationDefaults(['custom', 'users'], {
      onSettled: () => {
        seen.push('default:onSettled')
      },
    })
    const { result } = renderHook(
      () =>
        usePostUsers({
          mutation: {
            mutationKey: ['custom', 'users'],
            onSuccess: (data) => {
              seen.push(`hook:onSuccess:${data.name}`)
            },
          },
        }),
      { wrapper: makeWrapper(queryClient) },
    )
    await act(() => result.current.mutateAsync({ body: { name: 'Erin' } }))
    expect(seen).toStrictEqual(['hook:onSuccess:Erin', 'default:onSettled'])
  })
})
