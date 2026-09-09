import { getUserQueryKey, listUsersQueryKey } from '../__generated__/swr/hooks'
import { assertType, type NotAny } from './assert'

export function assertions() {
  // A key builder that lost its parameter type would accept anything, which is exactly the
  // regression a runtime test cannot see: the request still goes out, to the wrong URL.
  const listKey = listUsersQueryKey()
  const singleKey = getUserQueryKey({ id: '1' })
  assertType<NotAny<typeof listKey>>(true)
  assertType<NotAny<typeof singleKey>>(true)
  return { listKey, singleKey }
}
