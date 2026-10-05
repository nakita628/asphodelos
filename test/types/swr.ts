// swr: the hook's generics must reach the caller, not degrade to `any` or the library default.
import type { Key } from 'swr'

import {
  getGetUsersIdKey,
  getGetUsersKey,
  useGetUsers,
  useImmutableGetUsers,
  useInfiniteGetItems,
  usePostUsers,
} from '../__generated__/swr/hooks.js'
import { assertType } from './assert.js'
import type { Equal, HasKey, IsAssignable, NotAny } from './assert.js'

/** The `swr` slot of the plain query hook, as the caller sees it. */
type SwrSlot = NonNullable<NonNullable<Parameters<typeof useGetUsers>[0]>['swr']>
/** The `mutation` slot of the mutation hook, as the caller sees it. */
type MutationSlot = NonNullable<NonNullable<Parameters<typeof usePostUsers>[0]>['mutation']>

type ApiError = { readonly code: number }

export function assertions() {
  // A key builder that lost its parameter type would accept anything, which is exactly the
  // regression a runtime test cannot see: the request still goes out, to the wrong URL.
  const listKey = getGetUsersKey()
  const singleKey = getGetUsersIdKey({ id: '1' })
  assertType<NotAny<typeof listKey>>(true)
  assertType<NotAny<typeof singleKey>>(true)

  // TError reaches the returned error, not just the configuration callbacks.
  const query = useGetUsers<ApiError>()
  assertType<Equal<typeof query.error, ApiError | undefined>>(true)
  assertType<Equal<typeof query.data, { id: string; name: string }[] | undefined>>(true)
  // The hook answers with the key it used, so a caller can mutate the cache by it.
  assertType<IsAssignable<typeof query.swrKey, Key>>(true)
  return { listKey, singleKey, query }
}

export function immutableAssertions() {
  // The immutable hook shares the plain hook's data type; a fetcher typed `any` would still run.
  const immutable = useImmutableGetUsers()
  assertType<Equal<typeof immutable.data, { id: string; name: string }[] | undefined>>(true)
  return { immutable }
}

// `swr` is the SWR configuration plus the two members the hook reads itself: `swrKey`, which
// replaces the generated key, and `enabled`, which turns it into `null`.
export function optionsAssertions() {
  assertType<Equal<HasKey<SwrSlot, 'swrKey'>, true>>(true)
  assertType<Equal<HasKey<SwrSlot, 'enabled'>, true>>(true)
  assertType<IsAssignable<{ dedupingInterval: 0 }, SwrSlot>>(true)
  assertType<Equal<IsAssignable<{ dedupingInterval: 'never' }, SwrSlot>, false>>(true)

  // The mutation slot is the SWR mutation configuration plus `swrKey`; `trigger` takes the
  // request body one level in, beside the request options.
  assertType<Equal<HasKey<MutationSlot, 'swrKey'>, true>>(true)
  const mutation = usePostUsers<ApiError>()
  assertType<IsAssignable<{ body: { name: string } }, Parameters<typeof mutation.trigger>[0]>>(true)
  assertType<Equal<typeof mutation.error, ApiError | undefined>>(true)
  return { mutation }
}

// The infinite hook's `getRequestArgs` receives the page index, and its data is the page list.
export function infiniteAssertions() {
  const infinite = useInfiniteGetItems({
    options: { query: { page: 0 } },
    pagination: {
      getRequestArgs: (options, index) => ({
        ...options,
        query: { ...options.query, page: index },
      }),
    },
  })
  assertType<Equal<NonNullable<typeof infinite.data>[number]['items'], string[]>>(true)
  return { infinite }
}
