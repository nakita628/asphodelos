import {
  createCreateUser,
  createListItemsInfinite,
  createListUsers,
  listItemsInfiniteQueryOptions,
} from '../__generated__/solid-query/hooks.js'
import { assertType } from './assert.js'
import type { Equal, HasKey, IsAssignable, NotAny } from './assert.js'
import { pagination } from './infinite.js'

/** The options slot of the plain query hook, as the caller sees it. */
type QuerySlot = ReturnType<NonNullable<Parameters<typeof createListUsers>[1]>>
/** The options slot of the infinite hook, as the caller sees it. */
type InfiniteSlot = ReturnType<NonNullable<Parameters<typeof createListItemsInfinite>[2]>>
/** The options slot of the mutation hook, as the caller sees it. */
type MutationSlot = ReturnType<NonNullable<Parameters<typeof createCreateUser>[0]>>

export function assertions() {
  const factory = listItemsInfiniteQueryOptions(undefined, pagination)
  assertType<NotAny<typeof factory.queryKey>>(true)

  const infinite = createListItemsInfinite(undefined, pagination, () => ({ staleTime: 1000 }))
  assertType<Equal<NonNullable<typeof infinite.data>['pages'][number]['items'], string[]>>(true)
  assertType<Equal<NonNullable<typeof infinite.data>['pageParams'][number], number>>(true)

  // Solid's option types are `Accessor<...>`. The slot must take the unwrapped object: typed as
  // the accessor it would demand `() => () => ({...})`, whose spread drops every option.
  const mutation = createCreateUser(() => ({
    onSuccess: (user) => {
      assertType<Equal<typeof user.id, string>>(true)
    },
  }))
  // The hook spreads its own `mutationKey` / `mutationFn` after the caller's options, so a
  // caller's would be silently overwritten: the options slot must not offer them.
  assertType<Equal<HasKey<MutationSlot, 'mutationKey'>, false>>(true)
  assertType<Equal<HasKey<MutationSlot, 'mutationFn'>, false>>(true)
  // The options stay typed: a right-typed value is accepted, a wrong-typed one is not.
  assertType<IsAssignable<{ staleTime: 1000 }, InfiniteSlot>>(true)
  assertType<Equal<IsAssignable<{ staleTime: 'soon' }, InfiniteSlot>, false>>(true)
  return { factory, infinite, mutation }
}

// The hook supplies `queryKey` / `queryFn`, so the options slot must not demand them: the library
// types `queryKey` as required, which forced callers to pass a key the hook then overwrote.
export function queryOptionsAssertions() {
  const disabled = createListUsers(undefined, () => ({ enabled: false }))

  // `select` binds the hook's TData through the slot — without the Omit it could not.
  const selected = createListUsers(undefined, () => ({ select: (users) => users.length }))
  assertType<Equal<typeof selected.data, number | undefined>>(true)

  // The options stay typed: a right-typed value is accepted, a wrong-typed one is not.
  assertType<IsAssignable<{ staleTime: 1000 }, QuerySlot>>(true)
  assertType<Equal<IsAssignable<{ staleTime: 'soon' }, QuerySlot>, false>>(true)
  return { disabled, selected }
}
