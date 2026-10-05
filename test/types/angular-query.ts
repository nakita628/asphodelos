// angular-query: the hook's generics must reach the caller, not degrade to `any` or the library
// default.
import type { InjectQueryOptions } from '@tanstack/angular-query-experimental'

import {
  injectInfiniteItems,
  injectPostUsers,
  injectUsers,
  injectUsersId,
} from '../__generated__/angular-query/hooks.js'
import { assertType } from './assert.js'
import type { Equal, HasKey, IsAssignable, NotAny } from './assert.js'

/** The options slot of the plain query hook, as the caller sees it. */
type QuerySlot = NonNullable<ReturnType<NonNullable<Parameters<typeof injectUsers>[0]>>['query']>
/** The options slot of the infinite hook, as the caller sees it. */
type InfiniteSlot = NonNullable<ReturnType<Parameters<typeof injectInfiniteItems>[1]>['query']>
/** The options slot of the mutation hook, as the caller sees it. */
type MutationSlot = NonNullable<
  ReturnType<NonNullable<Parameters<typeof injectPostUsers>[0]>>['mutation']
>

type ApiError = { readonly code: number }
type Rollback = { readonly prev: readonly string[] }

export function assertions() {
  const query = injectUsers<{ id: string; name: string }[], ApiError>()
  assertType<NotAny<typeof query.data>>(true)
  assertType<NotAny<typeof query.error>>(true)

  const mutation = injectPostUsers<ApiError, Rollback>(() => ({
    mutation: {
      onMutate: (): Rollback => ({ prev: [] }),
      // TOnMutateResult must survive to onError, otherwise `result` is `unknown`.
      onError: (_error, _variables, result) => result?.prev,
    },
  }))
  assertType<NotAny<typeof mutation.error>>(true)
  // TError must be the caller's type, not the library default.
  const mutationError: ApiError | null = mutation.error()
  const rows: { id: string; name: string }[] | undefined = query.data()

  // A path parameter is a signal-like thunk, like every other input of an Angular Query function.
  const single = injectUsersId(() => ({ id: '1' }))
  assertType<Equal<ReturnType<typeof single.data>, { id: string; name: string } | undefined>>(true)
  return { query, mutation, mutationError, rows, single }
}

// The hook supplies `queryKey` / `queryFn`, so `options.query` must not demand them: the library
// types `queryKey` as required, which forced callers to pass a key the hook then overwrote.
export function queryOptionsAssertions() {
  const disabled = injectUsers(() => ({ query: { enabled: false } }))

  // `select` binds TData through the slot — without the Omit it could not.
  const names = injectUsers<string[]>(() => ({
    query: { select: (data) => data.map((u) => u.name) },
  }))
  const selected = injectUsers(() => ({ query: { select: (users) => users.length } }))
  assertType<Equal<ReturnType<typeof selected.data>, number | undefined>>(true)

  // The options stay typed: a right-typed value is accepted, a wrong-typed one is not.
  assertType<IsAssignable<{ staleTime: 1000 }, QuerySlot>>(true)
  assertType<Equal<IsAssignable<{ staleTime: 'soon' }, QuerySlot>, false>>(true)
  assertType<Equal<HasKey<QuerySlot, 'queryKey'>, false>>(true)
  assertType<Equal<HasKey<QuerySlot, 'queryFn'>, false>>(true)

  // The infinite hook also supplies both page-param functions, from `pagination`.
  const infinite = injectInfiniteItems(
    {
      initialPageParam: 0,
      getNextPageParam: (lastPage) => lastPage.nextPage,
      getRequestArgs: (options, pageParam) => ({
        ...options,
        query: { ...options.query, page: Number(pageParam) },
      }),
    },
    () => ({ query: { staleTime: 1000 }, options: { query: { page: 0 } } }),
  )
  type Data = NonNullable<ReturnType<typeof infinite.data>>
  assertType<Equal<Data['pages'][number]['items'], string[]>>(true)
  assertType<Equal<Data['pageParams'][number], number>>(true)
  assertType<IsAssignable<{ staleTime: 1000 }, InfiniteSlot>>(true)
  assertType<Equal<IsAssignable<{ staleTime: 'soon' }, InfiniteSlot>, false>>(true)
  return { disabled, names, selected, infinite }
}

// The hook supplies `mutationFn` — the contract that types `data` — so the slot leaves it out: a
// caller's would type-check and then be silently overwritten by the factory spread. `mutationKey`
// stays, and the hook honours it: mutations are not cached, so the key only filters and registers.
export function mutationOptionsAssertions() {
  assertType<Equal<HasKey<MutationSlot, 'mutationFn'>, false>>(true)
  assertType<Equal<HasKey<MutationSlot, 'mutationKey'>, true>>(true)
  assertType<IsAssignable<{ retry: 2 }, MutationSlot>>(true)
  assertType<Equal<IsAssignable<{ retry: 'never' }, MutationSlot>, false>>(true)

  const keyed = injectPostUsers(() => ({
    mutation: {
      mutationKey: ['custom', 'users'],
      onSuccess: (user) => {
        assertType<Equal<typeof user.id, string>>(true)
      },
    },
  }))
  return { keyed }
}

// The hooks default TError to the client's own error shape for the operation, `{ status, value }`,
// and forward the
// library's trailing argument — the inject options, in Angular.
export function tailAssertions() {
  const query = injectUsers()
  type DefaultError = NonNullable<ReturnType<typeof query.error>>
  assertType<Equal<HasKey<DefaultError, 'status'>, true>>(true)
  assertType<Equal<HasKey<DefaultError, 'value'>, true>>(true)
  assertType<Equal<Parameters<typeof injectUsers>[1], InjectQueryOptions | undefined>>(true)
  return { query }
}
