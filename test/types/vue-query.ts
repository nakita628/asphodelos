import type { Ref } from 'vue'

import {
  useCreateUser,
  useListItemsInfinite,
  useListUsers,
} from '../__generated__/vue-query/hooks.js'
import { assertType } from './assert.js'
import type { Equal, HasKey, IsAssignable } from './assert.js'
import { pagination } from './infinite.js'

/** The options slot of the plain query hook, as the caller sees it. */
type QuerySlot = NonNullable<Parameters<typeof useListUsers>[1]>
/** The options slot of the infinite hook, as the caller sees it. */
type InfiniteSlot = Parameters<typeof useListItemsInfinite>[2]
/** The options slot of the mutation hook, as the caller sees it. */
type MutationSlot = NonNullable<Parameters<typeof useCreateUser>[0]>

export function assertions() {
  // Vue takes the page-param functions through `queryOptions` (its `MaybeRefDeep<TPageParam>`
  // rejects a generic page param), and only `buildInit` through `pagination`. `queryKey` is the
  // hook's own, so it is not demanded here.
  const infinite = useListItemsInfinite(
    undefined,
    { buildInit: pagination.buildInit },
    {
      initialPageParam: pagination.initialPageParam,
      getNextPageParam: pagination.getNextPageParam,
    },
  )
  type Data = NonNullable<(typeof infinite.data)['value']>
  assertType<Equal<Data['pages'][number]['items'], string[]>>(true)

  // The page-param functions have no other way in, so they must stay required.
  // The page-param functions have no other way in, so getNextPageParam stays required.
  assertType<Equal<IsAssignable<{ initialPageParam: 0 }, InfiniteSlot>, false>>(true)
  return { infinite }
}

// The hook supplies `queryKey` / `queryFn`, so the options slot must not demand them: the library
// types `queryKey` as required, which forced callers to pass a key the hook then overwrote.
export function queryOptionsAssertions() {
  const disabled = useListUsers(undefined, { enabled: false })

  // `select` binds the hook's TData through the slot — without the Omit it could not.
  const selected = useListUsers(undefined, { select: (users) => users.length })
  assertType<Equal<(typeof selected.data)['value'], number | undefined>>(true)

  // The options stay typed: a right-typed value is accepted, a wrong-typed one is not.
  assertType<IsAssignable<{ staleTime: 1000 }, QuerySlot>>(true)
  assertType<Equal<IsAssignable<{ staleTime: 'soon' }, QuerySlot>, false>>(true)
  return { disabled, selected }
}

// The hook spreads its own `mutationKey` / `mutationFn` after the caller's options, so a caller's
// would be silently overwritten: the options slot must not offer them.
export function mutationOptionsAssertions() {
  const mutation = useCreateUser({
    onSuccess: (user) => {
      assertType<Equal<typeof user.id, string>>(true)
    },
  })
  assertType<Equal<HasKey<MutationSlot, 'mutationKey'>, false>>(true)
  assertType<Equal<HasKey<MutationSlot, 'mutationFn'>, false>>(true)
  assertType<Equal<IsAssignable<{ mutationKey: readonly ['users'] }, MutationSlot>, false>>(true)

  // Vue's own type also takes a ref or a getter, but the hook spreads the value, which empties
  // both: only the plain object may reach it.
  type Options = { onSuccess: () => void }
  assertType<Equal<IsAssignable<Ref<Options>, MutationSlot>, false>>(true)
  assertType<Equal<IsAssignable<() => Options, MutationSlot>, false>>(true)
  return { mutation }
}
