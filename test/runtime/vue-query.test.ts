import { afterEach, describe, expect, it } from 'bun:test'

import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query'
import { createApp, effectScope, nextTick, ref } from 'vue'

import {
  getPostUsersMutationKey,
  getUsersIdQueryKey,
  usePostUsers,
  useUsersId,
} from '../__generated__/vue-query/hooks.js'
import { requestLog } from '../hosts/users-app.js'

/**
 * The generated Vue Query hooks, run against the host app inside a Vue app context, so that
 * `useQueryClient` resolves the way it does in a component.
 *
 * What is specific to Vue: a path parameter may be a `Ref`, and the query re-keys itself when
 * the ref changes.
 */

// Vue hands the query's data out through a readonly proxy, so it is compared structurally
// (`toEqual`) rather than by identity of its class.

/** Long enough for a request to the in-process host to settle. */
const settle = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 50)
  })

/**
 * Runs `setup` the way a component would: with the query client injectable and a scope to
 * dispose.
 */
function withApp<T>(setup: () => T) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const app = createApp({})
  app.use(VueQueryPlugin, { queryClient })
  const scope = effectScope()
  const result = app.runWithContext(() => scope.run(setup))
  if (result === undefined) {
    throw new Error('setup returned nothing')
  }
  return {
    queryClient,
    result,
    dispose: () => {
      scope.stop()
    },
  }
}

afterEach(() => {
  requestLog.length = 0
})

describe('generated useQuery hooks (vue)', () => {
  // The path parameter is a Ref. Changing the ref changes the key, which fetches the other user;
  // both results stay in the cache under their own keys. The key getter accepts the Ref as well
  // as a plain object.
  it('re-keys and refetches when a Ref parameter changes', async () => {
    const params = ref({ id: '1' })
    const { queryClient, result: query, dispose } = withApp(() => useUsersId(params))
    await settle()
    expect(query.data.value).toEqual({ id: '1', name: 'Alice' })

    params.value = { id: '2' }
    await nextTick()
    await settle()
    expect(query.data.value).toEqual({ id: '2', name: 'Bob' })
    expect(requestLog).toStrictEqual(['GET /users/1', 'GET /users/2'])
    // Both keys are cached side by side; the key getter itself stays a plain array.
    const first = queryClient.getQueryData(getUsersIdQueryKey({ id: '1' }))
    const second = queryClient.getQueryData(getUsersIdQueryKey(params))
    expect(first).toStrictEqual({ id: '1', name: 'Alice' })
    expect(second).toStrictEqual({ id: '2', name: 'Bob' })
    dispose()
  })

  // The third argument of the hook is a QueryClient. With it, the hook works with no
  // VueQueryPlugin installed, and the query lands in that client's cache.
  it('forwards the queryClient argument, so no app-level provider is needed', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const scope = effectScope()
    const query = scope.run(() => useUsersId({ id: '1' }, undefined, queryClient))
    await settle()
    expect(query?.data.value).toEqual({ id: '1', name: 'Alice' })
    expect(queryClient.getQueryCache().getAll()).toHaveLength(1)
    scope.stop()
  })
})

describe('generated useMutation hooks (vue)', () => {
  it('runs the factory mutationFn under the generated mutationKey by default', async () => {
    const { queryClient, result: mutation, dispose } = withApp(() => usePostUsers())
    const created = await mutation.mutateAsync({ body: { name: 'Carol' } })
    expect(created).toStrictEqual({ id: '99', name: 'Carol' })
    expect(requestLog).toStrictEqual(['POST /users'])
    const cached = queryClient
      .getMutationCache()
      .find({ mutationKey: getPostUsersMutationKey(), exact: true })
    expect(cached?.state.data).toStrictEqual({ id: '99', name: 'Carol' })
    dispose()
  })

  // A mutationKey passed by the caller replaces the generated one: the result is cached under
  // the custom key and nothing under the generated key. The request is still the generated one.
  it("a caller's mutationKey overrides the generated key while the factory mutationFn still runs", async () => {
    const {
      queryClient,
      result: mutation,
      dispose,
    } = withApp(() => usePostUsers({ mutation: { mutationKey: ['custom', 'users'] } }))
    const created = await mutation.mutateAsync({ body: { name: 'Dave' } })
    expect(created).toStrictEqual({ id: '99', name: 'Dave' })
    expect(requestLog).toStrictEqual(['POST /users'])
    const cache = queryClient.getMutationCache()
    expect(cache.find({ mutationKey: ['custom', 'users'], exact: true })?.state.data).toStrictEqual(
      { id: '99', name: 'Dave' },
    )
    expect(cache.find({ mutationKey: getPostUsersMutationKey(), exact: true })).toBeUndefined()
    dispose()
  })
})
