import { describe, expect, it } from 'bun:test'

import { boolean } from './boolean.js'

describe('boolean', () => {
  it('emits bare t.Boolean()', () => {
    expect(boolean({ type: 'boolean' })).toBe('t.Boolean()')
  })

  it('preserves default false (no double-Optional bug)', () => {
    expect(boolean({ type: 'boolean', default: false })).toBe('t.Boolean({default:false})')
  })

  it('preserves default true', () => {
    expect(boolean({ type: 'boolean', default: true })).toBe('t.Boolean({default:true})')
  })

  it('emits t.BooleanString() when format is "boolean-string"', () => {
    expect(boolean({ type: 'boolean', format: 'boolean-string' })).toBe(
      't.BooleanString({format:"boolean-string"})',
    )
  })

  it('emits t.BooleanString() with default when format is "boolean-string"', () => {
    expect(boolean({ type: 'boolean', format: 'boolean-string', default: true })).toBe(
      't.BooleanString({format:"boolean-string",default:true})',
    )
  })

  it('emits Elysia error hook when x-error-message is set (plain fallback shape)', () => {
    expect(
      boolean({
        type: 'boolean',
        'x-error-message': 'must be a boolean',
      }),
    ).toBe('t.Boolean({error:"must be a boolean","x-error-message":"must be a boolean"})')
  })

  it('emits Elysia error hook on t.BooleanString() when format is boolean-string AND x-error-message is set', () => {
    expect(
      boolean({
        type: 'boolean',
        format: 'boolean-string',
        'x-error-message': 'expected "true" or "false"',
      }),
    ).toBe(
      't.BooleanString({format:"boolean-string",error:"expected \\"true\\" or \\"false\\"","x-error-message":"expected \\"true\\" or \\"false\\""})',
    )
  })
})
