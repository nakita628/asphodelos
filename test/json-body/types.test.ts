// The TypeScript side of the same matrix: the static type the generated model gives each field,
// which is what a handler written against the generated controller sees.
import { describe, expect, it } from 'bun:test'

import { assertType } from '../types/assert.js'
import type { Equal } from '../types/assert.js'
import type { NumbersModel } from './__generated__/modules/numbers/model.js'
import type { TypesModel } from './__generated__/modules/types/model.js'

type Numbers = NumbersModel['numbersBody']
type Types = TypesModel['typesBody']

describe('JSON body types', () => {
  it('types every integer as a number', () => {
    assertType<Equal<Numbers['id'], number | undefined>>(true)
    assertType<Equal<Numbers['small'], number | undefined>>(true)
    assertType<Equal<Numbers['level'], 1 | 2 | undefined>>(true)
    assertType<Equal<Numbers['version'], 5 | undefined>>(true)
    assertType<Equal<Numbers['cursor'], number | undefined>>(true)
    assertType<Equal<Numbers['maybe'], number | null | undefined>>(true)
    assertType<Equal<Numbers['ids'], number[] | undefined>>(true)
    assertType<Equal<Numbers['ref'], number | undefined>>(true)
    assertType<Equal<Numbers['active'], boolean | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types a list of types as their union', () => {
    assertType<Equal<Types['either'], number | string | undefined>>(true)
    assertType<Equal<Types['flagged'], number | boolean | null | undefined>>(true)
    assertType<Equal<Types['bounded'], number | string | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types a date-time as a Date and a time as a string', () => {
    assertType<Equal<Types['moment'], Date | undefined>>(true)
    assertType<Equal<Types['day'], Date | undefined>>(true)
    assertType<Equal<Types['clock'], string | undefined>>(true)
    expect(true).toBe(true)
  })

  // The undeclared keys are held to `additionalProperties` at run time, but TypeBox gives them
  // no static type: the object is typed by its declared properties alone.
  it('types an object by its declared properties, additionalProperties validated at run time', () => {
    assertType<Equal<NonNullable<Types['labelled']>, { name?: string }>>(true)
    assertType<Equal<NonNullable<Types['strict']>, { a?: number }>>(true)
    expect(true).toBe(true)
  })
})
