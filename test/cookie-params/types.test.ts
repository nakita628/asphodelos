// The TypeScript side of the same matrix: the static type the generated model gives each cookie,
// which is what a handler written against the generated controller sees. A runtime test cannot
// tell `number` from `any`, so these assertions are compile-time and the test only has to compile.
import { describe, expect, it } from 'bun:test'

import { assertType } from '../types/assert.js'
import type { Equal, HasKey } from '../types/assert.js'
import type { CookiesModel } from './__generated__/modules/cookies/model.js'
import type { DefaultsModel } from './__generated__/modules/defaults/model.js'
import type { OptionalModel } from './__generated__/modules/optional/model.js'
import type { RequiredModel } from './__generated__/modules/required/model.js'

type Cookies = CookiesModel['cookieParamsCookie']
type Optional = OptionalModel['cookieOptionalCookie']
type Defaults = DefaultsModel['cookieDefaultsCookie']
type Required = RequiredModel['cookieRequiredCookie']

describe('cookie parameter types', () => {
  it('types every shape as the value it arrives as, optional unless required', () => {
    assertType<Equal<Cookies['integer'], number | undefined>>(true)
    assertType<Equal<Cookies['int64'], number | undefined>>(true)
    assertType<Equal<Cookies['number'], number | undefined>>(true)
    assertType<Equal<Cookies['boolean'], boolean | undefined>>(true)
    assertType<Equal<Cookies['string'], string | undefined>>(true)
    assertType<Equal<Cookies['date'], Date | undefined>>(true)
    assertType<Equal<Cookies['time'], string | undefined>>(true)
    assertType<Equal<Cookies['ids'], number[] | undefined>>(true)
    assertType<Equal<Cookies['tags'], string[] | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types an enum as the union of its members, and a const as its one value', () => {
    assertType<Equal<Optional['senum'], 'asc' | 'desc' | undefined>>(true)
    assertType<Equal<Optional['ienum'], 1 | 2 | 3 | undefined>>(true)
    assertType<Equal<Optional['sconst'], 'fixed' | undefined>>(true)
    assertType<Equal<Optional['oneof'], number | 'all' | undefined>>(true)
    assertType<Equal<Optional['inull'], number | null | undefined>>(true)
    expect(true).toBe(true)
  })

  it('keeps a name that is not an identifier as the key it is', () => {
    assertType<HasKey<Optional, 'session-id'>>(true)
    assertType<HasKey<Optional, 'user.id'>>(true)
    assertType<Equal<Optional['session-id'], number | undefined>>(true)
    assertType<Equal<Optional['int_opt'], number | undefined>>(true)
    assertType<Equal<Optional['Int_Opt'], string | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types an object cookie by its properties', () => {
    assertType<Equal<Optional['profile'], { a?: number; b?: string } | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types a defaulted cookie as optional', () => {
    assertType<Equal<Defaults['int_def'], number | undefined>>(true)
    assertType<Equal<Defaults['enum_def'], 'asc' | 'desc' | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types a required cookie without undefined', () => {
    assertType<Equal<Required['id'], number>>(true)
    assertType<Equal<Required['flag'], boolean>>(true)
    assertType<Equal<Required['name'], string>>(true)
    assertType<Equal<Required['note'], number | undefined>>(true)
    expect(true).toBe(true)
  })
})
