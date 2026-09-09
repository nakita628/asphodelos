import { describe, expect, it } from 'bun:test'

import { notType } from './not.js'

describe('notType', () => {
  it('emits bare t.Not(inner)', () => {
    expect(notType({ type: 'string' }, {})).toBe('t.Not(t.String())')
  })

  it('preserves description from parent via commonOpts', () => {
    expect(notType({ type: 'string' }, { description: 'must not be string' })).toBe(
      't.Not(t.String(),{description:"must not be string"})',
    )
  })

  it('emits Not error callback for x-not-message on parent', () => {
    expect(
      notType({ type: 'string' }, { not: { type: 'string' }, 'x-not-message': 'no strings' }),
    ).toBe(
      't.Not(t.String(),{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===34)return "no strings";return undefined},"x-not-message":"no strings"})',
    )
  })
})
