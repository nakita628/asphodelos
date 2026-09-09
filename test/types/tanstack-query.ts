import { getUserQueryOptions, listUsersQueryOptions } from '../__generated__/tanstack-query/hooks'
import { assertType, type NotAny } from './assert'

type User = { readonly id: string; readonly name: string }

export function assertions() {
  const list = listUsersQueryOptions()
  assertType<NotAny<typeof list.queryKey>>(true)

  const single = getUserQueryOptions({ id: '1' })
  assertType<NotAny<typeof single.queryKey>>(true)

  // The query function's payload must be the spec's type, not `any` — this assignment is the
  // assertion, and it fails to compile the moment the generic degrades.
  const rows: Promise<readonly User[] | undefined> = Promise.resolve(
    undefined as readonly User[] | undefined,
  )
  return { list, single, rows }
}
