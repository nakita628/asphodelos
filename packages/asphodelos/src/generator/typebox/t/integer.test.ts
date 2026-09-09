import { describe, expect, it } from 'bun:test'

import { integer } from './integer.js'

describe('integer', () => {
  it('auto-caps unbounded maximum at MAX_SAFE_INTEGER', () => {
    expect(integer({ type: 'integer' })).toBe('t.Integer({maximum:9007199254740991})')
  })

  it('emits min/max (user-supplied maximum is preserved verbatim)', () => {
    expect(integer({ type: 'integer', minimum: 1, maximum: 100 })).toBe(
      't.Integer({minimum:1,maximum:100})',
    )
  })

  it('auto-caps when only exclusiveMinimum is set (still no upper bound)', () => {
    expect(integer({ type: 'integer', exclusiveMinimum: 0 })).toBe(
      't.Integer({maximum:9007199254740991,exclusiveMinimum:0})',
    )
  })

  it('does NOT add maximum when exclusiveMaximum is user-supplied', () => {
    expect(integer({ type: 'integer', exclusiveMaximum: 100 })).toBe(
      't.Integer({exclusiveMaximum:100})',
    )
  })

  it('auto-caps int32 at 2^31-1', () => {
    expect(integer({ type: 'integer', format: 'int32' })).toBe(
      't.Integer({format:"int32",maximum:2147483647})',
    )
  })

  it('auto-caps int64 at MAX_SAFE_INTEGER (JS Number ceiling)', () => {
    expect(integer({ type: 'integer', format: 'int64' })).toBe(
      't.Integer({format:"int64",maximum:9007199254740991})',
    )
  })

  it('emits t.Numeric() when format is "numeric"', () => {
    expect(integer({ type: 'integer', format: 'numeric' })).toBe(
      't.Numeric({format:"numeric",maximum:9007199254740991})',
    )
  })

  it('emits t.Numeric() with user-supplied bounds when format is "numeric"', () => {
    expect(integer({ type: 'integer', format: 'numeric', minimum: 1, maximum: 100 })).toBe(
      't.Numeric({format:"numeric",minimum:1,maximum:100})',
    )
  })

  it('emits per-constraint error callback for x-minimum-message + x-multipleOf-message', () => {
    expect(
      integer({
        type: 'integer',
        minimum: 1,
        multipleOf: 2,
        'x-minimum-message': 'at least 1',
        'x-multipleOf-message': 'must be even',
      }),
    ).toBe(
      't.Integer({minimum:1,maximum:9007199254740991,multipleOf:2,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===25)return "at least 1";if(type===26)return "must be even";return undefined},"x-minimum-message":"at least 1","x-multipleOf-message":"must be even"})',
    )
  })

  it('normalizes OAS 3.0 boolean exclusiveMinimum to the numeric bound', () => {
    expect(integer({ type: 'integer', minimum: 0, exclusiveMinimum: true })).toBe(
      't.Integer({maximum:9007199254740991,exclusiveMinimum:0})',
    )
  })

  it('normalizes OAS 3.0 boolean exclusiveMaximum to the numeric bound', () => {
    expect(integer({ type: 'integer', maximum: 100, exclusiveMaximum: true })).toBe(
      't.Integer({exclusiveMaximum:100})',
    )
  })

  it('drops OAS 3.0 exclusiveMinimum:false and keeps the inclusive minimum', () => {
    expect(integer({ type: 'integer', minimum: 0, exclusiveMinimum: false })).toBe(
      't.Integer({minimum:0,maximum:9007199254740991})',
    )
  })
})
