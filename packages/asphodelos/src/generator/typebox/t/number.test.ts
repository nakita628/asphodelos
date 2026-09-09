import { describe, expect, it } from 'bun:test'

import { number } from './number.js'

describe('number', () => {
  it('emits bare t.Number()', () => {
    expect(number({ type: 'number' })).toBe('t.Number()')
  })

  it('emits min/max constraints', () => {
    expect(number({ type: 'number', minimum: 0, maximum: 100 })).toBe(
      't.Number({minimum:0,maximum:100})',
    )
  })

  it('emits multipleOf', () => {
    expect(number({ type: 'number', multipleOf: 0.5 })).toBe('t.Number({multipleOf:0.5})')
  })

  it('preserves default 0 (falsy)', () => {
    expect(number({ type: 'number', default: 0 })).toBe('t.Number({default:0})')
  })

  it('emits t.Numeric() when format is "numeric"', () => {
    expect(number({ type: 'number', format: 'numeric' })).toBe('t.Numeric({format:"numeric"})')
  })

  it('emits t.Numeric() with bounds when format is "numeric"', () => {
    expect(number({ type: 'number', format: 'numeric', minimum: 0, maximum: 100 })).toBe(
      't.Numeric({format:"numeric",minimum:0,maximum:100})',
    )
  })

  it('emits per-constraint error callback for x-minimum-message + x-maximum-message', () => {
    expect(
      number({
        type: 'number',
        minimum: 0,
        maximum: 100,
        'x-minimum-message': 'must be >= 0',
        'x-maximum-message': 'must be <= 100',
      }),
    ).toBe(
      't.Number({minimum:0,maximum:100,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===39)return "must be >= 0";if(type===38)return "must be <= 100";return undefined},"x-minimum-message":"must be >= 0","x-maximum-message":"must be <= 100"})',
    )
  })

  it('normalizes OAS 3.0 boolean exclusiveMinimum to the numeric bound', () => {
    expect(number({ type: 'number', minimum: 0, exclusiveMinimum: true })).toBe(
      't.Number({exclusiveMinimum:0})',
    )
  })

  it('normalizes OAS 3.0 boolean exclusiveMaximum to the numeric bound', () => {
    expect(number({ type: 'number', maximum: 1, exclusiveMaximum: true })).toBe(
      't.Number({exclusiveMaximum:1})',
    )
  })
})
