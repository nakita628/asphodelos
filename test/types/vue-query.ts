// vue-query: the hook's generics must reach the caller, not degrade to `any` or the library
// default.
import type { QueryClient } from '@tanstack/vue-query'
import type { Ref } from 'vue'

import { useInfiniteItems, usePostUsers, useUsers } from '../__generated__/vue-query/hooks.js'
import type { useUsersId } from '../__generated__/vue-query/hooks.js'
import { assertType } from './assert.js'
import type { Equal, HasKey, IsAssignable, NotAny } from './assert.js'

/** The options slot of the plain query hook, as the caller sees it. */
type QuerySlot = NonNullable<NonNullable<Parameters<typeof useUsers>[0]>['query']>
/** The options slot of the infinite hook, as the caller sees it. */
type InfiniteSlot = Parameters<typeof useInfiniteItems>[1]['query']
/** The options slot of the mutation hook, as the caller sees it. */
type MutationSlot = NonNullable<NonNullable<Parameters<typeof usePostUsers>[0]>['mutation']>

type ApiError = { readonly code: number }
type Rollback = { readonly prev: readonly string[] }

export function assertions() {
  const query = useUsers<{ id: string; name: string }[], ApiError>()
  assertType<NotAny<typeof query.data>>(true)
  assertType<NotAny<typeof query.error>>(true)

  const mutation = usePostUsers<ApiError, Rollback>({
    mutation: {
      onMutate: (): Rollback => ({ prev: [] }),
      // TOnMutateResult must survive to onError, otherwise `result` is `unknown`.
      onError: (_error, _variables, result) => result?.prev,
    },
  })
  assertType<NotAny<typeof mutation.error>>(true)
  // TError must be the caller's type, not the library default.
  const mutationError: ApiError | null = mutation.error.value
  const rows: { id: string; name: string }[] | undefined = query.data.value

  // A path parameter may be a ref or a getter, so the query re-keys itself when it changes.
  assertType<IsAssignable<Ref<{ id: string }>, Parameters<typeof useUsersId>[0]>>(true)
  assertType<IsAssignable<() => { id: string }, Parameters<typeof useUsersId>[0]>>(true)
  return { query, mutation, mutationError, rows }
}

// The hook supplies `queryKey` / `queryFn`, so `options.query` must not demand them: the library
// types `queryKey` as required, which forced callers to pass a key the hook then overwrote.
export function queryOptionsAssertions() {
  const disabled = useUsers({ query: { enabled: false } })

  // `select` binds TData through the slot — without the Omit it could not.
  const names = useUsers<string[]>({ query: { select: (data) => data.map((u) => u.name) } })
  const selected = useUsers({ query: { select: (users) => users.length } })
  assertType<Equal<(typeof selected.data)['value'], number | undefined>>(true)

  // The options stay typed: a right-typed value is accepted, a wrong-typed one is not.
  assertType<IsAssignable<{ staleTime: 1000 }, QuerySlot>>(true)
  assertType<Equal<IsAssignable<{ staleTime: 'soon' }, QuerySlot>, false>>(true)
  assertType<Equal<HasKey<QuerySlot, 'queryKey'>, false>>(true)
  assertType<Equal<HasKey<QuerySlot, 'queryFn'>, false>>(true)

  // Vue has no infiniteQueryOptions helper, so the page-param functions travel in
  // `options.query` and stay required there; only the key and query function are the hook's.
  const infinite = useInfiniteItems(
    {
      getRequestArgs: (options, pageParam) => ({
        ...options,
        query: { ...options.query, page: Number(pageParam) },
      }),
    },
    {
      query: { initialPageParam: 0, getNextPageParam: (lastPage) => lastPage.nextPage },
      options: { query: { page: 0 } },
    },
  )
  type Data = NonNullable<(typeof infinite.data)['value']>
  assertType<Equal<Data['pages'][number]['items'], string[]>>(true)
  // The page-param functions have no other way in, so getNextPageParam stays required.
  assertType<Equal<IsAssignable<{ initialPageParam: 0 }, InfiniteSlot>, false>>(true)
  return { disabled, names, selected, infinite }
}

// The hook supplies `mutationFn` — the contract that types `data` — so the slot leaves it out: a
// caller's would type-check and then be silently overwritten by the factory spread. `mutationKey`
// stays, and the hook honours it. Vue's `UseMutationOptions` is a `MaybeRefDeep | getter` union;
// the slot is its plain-object member, the only one the hook can spread.
export function mutationOptionsAssertions() {
  assertType<Equal<HasKey<MutationSlot, 'mutationFn'>, false>>(true)
  assertType<Equal<HasKey<MutationSlot, 'mutationKey'>, true>>(true)
  type Options = { onSuccess: () => void }
  assertType<Equal<IsAssignable<Ref<Options>, MutationSlot>, false>>(true)
  assertType<Equal<IsAssignable<() => Options, MutationSlot>, false>>(true)

  const keyed = usePostUsers({
    mutation: {
      mutationKey: ['custom', 'users'],
      onSuccess: (user) => {
        assertType<Equal<typeof user.id, string>>(true)
      },
    },
  })
  return { keyed }
}

// The hooks default TError to the client's own error shape for the operation, `{ status, value }`,
// and forward the
// library's trailing argument, so a caller can target another client.
export function tailAssertions() {
  const query = useUsers()
  type DefaultError = NonNullable<(typeof query.error)['value']>
  assertType<Equal<HasKey<DefaultError, 'status'>, true>>(true)
  assertType<Equal<HasKey<DefaultError, 'value'>, true>>(true)
  assertType<Equal<Parameters<typeof useUsers>[1], QueryClient | undefined>>(true)
  return { query }
}
