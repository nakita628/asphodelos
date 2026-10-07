// The TypeScript side of the same matrix: the static type the generated model gives each query
// parameter, which is what a handler written against the generated controller sees. A runtime test
// cannot tell `number` from `any`, so these assertions are compile-time and the test only has to
// compile.
import { describe, expect, it } from 'bun:test'

import { assertType } from '../types/assert.js'
import type { Equal, HasKey } from '../types/assert.js'
import type { DefaultsModel } from './__generated__/modules/defaults/model.js'
import type { InheritedModel } from './__generated__/modules/inherited/model.js'
import type { LimitsModel } from './__generated__/modules/limits/model.js'
import type { LiteralsModel } from './__generated__/modules/literals/model.js'
import type { OptionalModel } from './__generated__/modules/optional/model.js'
import type { ParamsModel } from './__generated__/modules/params/model.js'
import type { RequiredModel } from './__generated__/modules/required/model.js'

type Params = ParamsModel['queryParamsQuery']
type Literals = LiteralsModel['queryLiteralsQuery']
type Optional = OptionalModel['queryOptionalQuery']
type Defaults = DefaultsModel['queryDefaultsQuery']
type Required = RequiredModel['queryRequiredQuery']
type Limits = LimitsModel['queryLimitsQuery']
type Inherited = InheritedModel['queryInheritedQuery']

describe('query parameter types', () => {
  it('types every shape as the value it arrives as, optional unless required', () => {
    // Numbers of every format, booleans, strings — and dates, which `t.Date()` reads into a Date.
    assertType<Equal<Params['integer'], number | undefined>>(true)
    assertType<Equal<Params['int32'], number | undefined>>(true)
    assertType<Equal<Params['int64'], number | undefined>>(true)
    assertType<Equal<Params['number'], number | undefined>>(true)
    assertType<Equal<Params['double'], number | undefined>>(true)
    assertType<Equal<Params['boolean'], boolean | undefined>>(true)
    assertType<Equal<Params['string'], string | undefined>>(true)
    assertType<Equal<Params['email'], string | undefined>>(true)
    assertType<Equal<Params['uuid'], string | undefined>>(true)
    assertType<Equal<Params['date'], Date | undefined>>(true)
    assertType<Equal<Params['datetime'], Date | undefined>>(true)
    assertType<Equal<Params['time'], string | undefined>>(true)
    assertType<Equal<Params['password'], string | undefined>>(true)
    // Arrays of each.
    assertType<Equal<Params['integer_arr'], number[] | undefined>>(true)
    assertType<Equal<Params['boolean_arr'], boolean[] | undefined>>(true)
    assertType<Equal<Params['string_arr'], string[] | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types an enum as the union of its members, and a const as its one value', () => {
    assertType<Equal<Literals['senum'], 'asc' | 'desc' | undefined>>(true)
    assertType<Equal<Literals['senum_arr'], ('asc' | 'desc')[] | undefined>>(true)
    assertType<Equal<Literals['sconst'], 'fixed' | undefined>>(true)
    assertType<Equal<Literals['numericsenum'], '1' | '02' | 'true' | undefined>>(true)
    expect(true).toBe(true)
  })

  it('keeps a name that is not an identifier as the key it is', () => {
    assertType<HasKey<Optional, 'page-size'>>(true)
    assertType<HasKey<Optional, 'filter[name]'>>(true)
    assertType<HasKey<Optional, '$top'>>(true)
    assertType<HasKey<Optional, 'user.id'>>(true)
    assertType<Equal<Optional['page-size'], number | undefined>>(true)
    // Case is part of the name.
    assertType<Equal<Optional['int_opt'], number | undefined>>(true)
    assertType<Equal<Optional['Int_Opt'], string | undefined>>(true)
    expect(true).toBe(true)
  })

  // A default makes the value present at run time, but the generated type stays optional: the
  // schema wraps it in `t.Optional`, the way a caller sees it.
  it('types a defaulted parameter as optional', () => {
    assertType<Equal<Defaults['int_def'], number | undefined>>(true)
    assertType<Equal<Defaults['enum_def'], 'asc' | 'desc' | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types a required parameter without undefined', () => {
    assertType<Equal<Required['id'], number>>(true)
    assertType<Equal<Required['flag'], boolean>>(true)
    assertType<Equal<Required['name'], string>>(true)
    assertType<Equal<Required['tags'], number[]>>(true)
    // `required: false` written out is optional.
    assertType<Equal<Required['note'], number | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types a constrained value by its type alone', () => {
    assertType<Equal<Limits['range'], number | undefined>>(true)
    assertType<Equal<Limits['pattern'], string | undefined>>(true)
    assertType<Equal<Limits['items'], number[] | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types inherited parameters, with the override winning', () => {
    assertType<Equal<Inherited['tenant'], string>>(true)
    assertType<Equal<Inherited['page'], string | undefined>>(true)
    expect(true).toBe(true)
  })
})
