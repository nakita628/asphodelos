import {
  listItemsInfiniteQueryOptions,
  useListItemsInfinite,
  useListUsers,
  useSuspenseListUsers,
} from '../__generated__/preact-query/hooks'
import { type Equal, type HasKey, type IsAssignable, type NotAny, assertType } from './assert'
import { pagination } from './infinite'

/** The options slot of the plain query hook, as the caller sees it. */
type QuerySlot = NonNullable<Parameters<typeof useListUsers>[1]>
/** The options slot of the infinite hook, as the caller sees it. */
type InfiniteSlot = NonNullable<Parameters<typeof useListItemsInfinite>[2]>

export function assertions() {
  const factory = listItemsInfiniteQueryOptions(undefined, pagination)
  assertType<NotAny<typeof factory.queryKey>>(true)

  const infinite = useListItemsInfinite(undefined, pagination, { staleTime: 1_000 })
  assertType<Equal<NonNullable<typeof infinite.data>['pages'][number]['items'], string[]>>(true)
  assertType<Equal<NonNullable<typeof infinite.data>['pageParams'][number], number>>(true)
  // The options stay typed: a right-typed value is accepted, a wrong-typed one is not.
  assertType<IsAssignable<{ staleTime: 1_000 }, InfiniteSlot>>(true)
  assertType<Equal<IsAssignable<{ staleTime: 'soon' }, InfiniteSlot>, false>>(true)
  return { factory, infinite }
}

// The hook supplies `queryKey` / `queryFn`, so the options slot must not demand them: the library
// types `queryKey` as required, which forced callers to pass a key the hook then overwrote.
export function queryOptionsAssertions() {
  const disabled = useListUsers(undefined, { enabled: false })

  // `select` binds the hook's TData through the slot — without the Omit it could not.
  const selected = useListUsers(undefined, { select: (users) => users.length })
  assertType<Equal<typeof selected.data, number | undefined>>(true)

  // The options stay typed: a right-typed value is accepted, a wrong-typed one is not.
  assertType<IsAssignable<{ staleTime: 1_000 }, QuerySlot>>(true)
  assertType<Equal<IsAssignable<{ staleTime: 'soon' }, QuerySlot>, false>>(true)

  const suspense = useSuspenseListUsers(undefined, { select: (users) => users.length })
  assertType<Equal<typeof suspense.data, number>>(true)
  return { disabled, selected, suspense }
}
