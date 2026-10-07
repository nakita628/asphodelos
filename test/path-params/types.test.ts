// The TypeScript side of the same matrix: the static type the generated model gives each path
// parameter, which is what a handler written against the generated controller sees. A runtime test
// cannot tell `number` from `any`, so these assertions are compile-time and the test only has to
// compile.
import { describe, expect, it } from 'bun:test'

import { assertType } from '../types/assert.js'
import type { Equal, HasKey } from '../types/assert.js'
import type { BooleanModel } from './__generated__/modules/boolean/model.js'
import type { DateModel } from './__generated__/modules/date/model.js'
import type { IntegerModel } from './__generated__/modules/integer/model.js'
import type { NamedModel } from './__generated__/modules/named/model.js'
import type { OrgsModel } from './__generated__/modules/orgs/model.js'
import type { OverrideModel } from './__generated__/modules/override/model.js'
import type { ParamrefModel } from './__generated__/modules/paramref/model.js'
import type { PasswordModel } from './__generated__/modules/password/model.js'
import type { SchemarefModel } from './__generated__/modules/schemaref/model.js'
import type { SconstModel } from './__generated__/modules/sconst/model.js'
import type { SenumModel } from './__generated__/modules/senum/model.js'
import type { SharedModel } from './__generated__/modules/shared/model.js'
import type { UuidModel } from './__generated__/modules/uuid/model.js'

describe('path parameter types', () => {
  // A path parameter is always required, so no shape carries `undefined`.
  it('types every shape as the value it arrives as', () => {
    assertType<Equal<IntegerModel['integerParamParams'], { value: number }>>(true)
    assertType<Equal<BooleanModel['booleanParamParams'], { value: boolean }>>(true)
    assertType<Equal<UuidModel['uuidParamParams'], { value: string }>>(true)
    assertType<Equal<DateModel['dateParamParams'], { value: Date }>>(true)
    assertType<Equal<PasswordModel['passwordParamParams'], { value: string }>>(true)
    expect(true).toBe(true)
  })

  it('types an enum as the union of its members, and a const as its one value', () => {
    assertType<Equal<SenumModel['senumParamParams'], { value: 'asc' | 'desc' }>>(true)
    assertType<Equal<SconstModel['sconstParamParams'], { value: 'fixed' }>>(true)
    expect(true).toBe(true)
  })

  it('types several parameters in one path each as its own shape', () => {
    assertType<
      Equal<OrgsModel['multiParamParams'], { orgId: number; repoId: string; issueId: number }>
    >(true)
    expect(true).toBe(true)
  })

  it('keeps a name that is not an identifier as the key it is', () => {
    assertType<HasKey<NamedModel['namedParamParams'], 'user-id'>>(true)
    assertType<Equal<NamedModel['namedParamParams'], { 'user-id': number; post_id: boolean }>>(true)
    expect(true).toBe(true)
  })

  it('types a parameter declared through a component by the component', () => {
    assertType<Equal<ParamrefModel['paramrefParamParams'], { id: number }>>(true)
    assertType<Equal<SchemarefModel['schemarefParamParams'], { value: number }>>(true)
    expect(true).toBe(true)
  })

  it('types path-item level parameters on every operation, with the override winning', () => {
    assertType<Equal<SharedModel['sharedGetParamParams'], { id: number }>>(true)
    assertType<Equal<SharedModel['sharedDeleteParamParams'], { id: number }>>(true)
    assertType<Equal<OverrideModel['overrideParamParams'], { id: string }>>(true)
    expect(true).toBe(true)
  })
})
