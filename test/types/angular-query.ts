import {
  injectListItemsInfinite,
  injectListUsers,
  listItemsInfiniteQueryOptions,
} from '../__generated__/angular-query/hooks.js'
import { assertType } from './assert.js'
import type { Equal, IsAssignable, NotAny } from './assert.js'
import { pagination } from './infinite.js'

/** The options slot of the plain query hook, as the caller sees it. */
type QuerySlot = NonNullable<Parameters<typeof injectListUsers>[1]>
/** The options slot of the infinite hook, as the caller sees it. */
type InfiniteSlot = NonNullable<Parameters<typeof injectListItemsInfinite>[2]>

export function assertions() {
  const factory = listItemsInfiniteQueryOptions(undefined, pagination)
  assertType<NotAny<typeof factory.queryKey>>(true)

  // `data` is the page list. The regression this pins typed it as a single page, so
  // `data().pages` failed to compile even though it is what the query returns at runtime.
  const infinite = injectListItemsInfinite(undefined, pagination, { staleTime: 1000 })
  type Data = NonNullable<ReturnType<typeof infinite.data>>
  assertType<Equal<Data['pages'][number]['items'], string[]>>(true)
  assertType<Equal<Data['pageParams'][number], number>>(true)

  // The options stay typed: a right-typed value is accepted, a wrong-typed one is not.
  assertType<IsAssignable<{ staleTime: 1000 }, InfiniteSlot>>(true)
  assertType<Equal<IsAssignable<{ staleTime: 'soon' }, InfiniteSlot>, false>>(true)
  return { factory, infinite }
}

// The hook supplies `queryKey` / `queryFn`, so the options slot must not demand them: the library
// types `queryKey` as required, which forced callers to pass a key the hook then overwrote.
export function queryOptionsAssertions() {
  const disabled = injectListUsers(undefined, { enabled: false })

  // `select` binds the hook's TData through the slot — without the Omit it could not.
  const selected = injectListUsers(undefined, { select: (users) => users.length })
  assertType<Equal<ReturnType<typeof selected.data>, number | undefined>>(true)

  // The options stay typed: a right-typed value is accepted, a wrong-typed one is not.
  assertType<IsAssignable<{ staleTime: 1000 }, QuerySlot>>(true)
  assertType<Equal<IsAssignable<{ staleTime: 'soon' }, QuerySlot>, false>>(true)
  return { disabled, selected }
}
