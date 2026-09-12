import {
  getUserQueryKey,
  listUsersQueryKey,
  useImmutableListUsers,
} from '../__generated__/swr/hooks.js'
import { assertType } from './assert.js'
import type { Equal, NotAny } from './assert.js'

export function assertions() {
  // A key builder that lost its parameter type would accept anything, which is exactly the
  // regression a runtime test cannot see: the request still goes out, to the wrong URL.
  const listKey = listUsersQueryKey()
  const singleKey = getUserQueryKey({ id: '1' })
  assertType<NotAny<typeof listKey>>(true)
  assertType<NotAny<typeof singleKey>>(true)
  return { listKey, singleKey }
}

export function immutableAssertions() {
  // The immutable hook shares the plain hook's data type; a fetcher typed `any` would still run.
  const immutable = useImmutableListUsers()
  assertType<Equal<typeof immutable.data, { id: string; name: string }[] | undefined>>(true)
  return { immutable }
}
