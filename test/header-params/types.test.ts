// The TypeScript side of the same matrix: the static type the generated model gives each header,
// which is what a handler written against the generated controller sees. A runtime test cannot
// tell `number` from `any`, so these assertions are compile-time and the test only has to compile.
import { describe, expect, it } from 'bun:test'

import { assertType } from '../types/assert.js'
import type { Equal, HasKey } from '../types/assert.js'
import type { DefaultsModel } from './__generated__/modules/defaults/model.js'
import type { HeadersModel } from './__generated__/modules/headers/model.js'
import type { OptionalModel } from './__generated__/modules/optional/model.js'
import type { RequiredModel } from './__generated__/modules/required/model.js'

type Headers = HeadersModel['headerParamsHeaders']
type Optional = OptionalModel['headerOptionalHeaders']
type Defaults = DefaultsModel['headerDefaultsHeaders']
type Required = RequiredModel['headerRequiredHeaders']

describe('header parameter types', () => {
  it('types every shape as the value it arrives as, optional unless required', () => {
    assertType<Equal<Headers['x-integer'], number | undefined>>(true)
    assertType<Equal<Headers['x-int64'], number | undefined>>(true)
    assertType<Equal<Headers['x-number'], number | undefined>>(true)
    assertType<Equal<Headers['x-boolean'], boolean | undefined>>(true)
    assertType<Equal<Headers['x-string'], string | undefined>>(true)
    assertType<Equal<Headers['x-email'], string | undefined>>(true)
    assertType<Equal<Headers['x-date'], Date | undefined>>(true)
    assertType<Equal<Headers['x-datetime'], Date | undefined>>(true)
    assertType<Equal<Headers['x-time'], string | undefined>>(true)
    assertType<Equal<Headers['x-ids'], number[] | undefined>>(true)
    assertType<Equal<Headers['x-tags'], string[] | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types an enum as the union of its members, and a const as its one value', () => {
    assertType<Equal<Optional['x-senum'], 'asc' | 'desc' | undefined>>(true)
    assertType<Equal<Optional['x-ienum'], 1 | 2 | 3 | undefined>>(true)
    assertType<Equal<Optional['x-sconst'], 'fixed' | undefined>>(true)
    assertType<Equal<Optional['x-oneof'], number | 'all' | undefined>>(true)
    assertType<Equal<Optional['x-inull'], number | null | undefined>>(true)
    expect(true).toBe(true)
  })

  // A mixed-case declaration is keyed by its lower-case name, the one the handler sees.
  it('keys a header by its lower-case name', () => {
    assertType<HasKey<Optional, 'x-request-id'>>(true)
    assertType<Equal<HasKey<Optional, 'X-Request-Id'>, false>>(true)
    assertType<Equal<Optional['x-rate-limit'], number | undefined>>(true)
    assertType<Equal<Optional['accept-version'], number | undefined>>(true)
    assertType<Equal<Optional['x_underscore'], number | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types an object header by its properties', () => {
    assertType<Equal<Optional['x-obj'], { a?: number; b?: string } | undefined>>(true)
    expect(true).toBe(true)
  })

  // A default makes the value present at run time, but the generated type stays optional.
  it('types a defaulted header as optional', () => {
    assertType<Equal<Defaults['x-int-def'], number | undefined>>(true)
    assertType<Equal<Defaults['x-enum-def'], 'asc' | 'desc' | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types a required header without undefined', () => {
    assertType<Equal<Required['x-id'], number>>(true)
    assertType<Equal<Required['x-flag'], boolean>>(true)
    assertType<Equal<Required['x-name'], string>>(true)
    assertType<Equal<Required['x-note'], number | undefined>>(true)
    expect(true).toBe(true)
  })
})
