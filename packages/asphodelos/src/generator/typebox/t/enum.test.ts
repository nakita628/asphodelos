import { describe, expect, it } from 'bun:test'

import { _enum } from './enum.js'

describe('_enum', () => {
  it('emits t.Literal for single-value enum', () => {
    expect(_enum({ enum: ['available'] })).toBe('t.Literal("available")')
  })

  it('emits t.UnionEnum for all-string multi-value enum (preserves literal union type)', () => {
    expect(_enum({ enum: ['available', 'pending', 'sold'] })).toBe(
      't.UnionEnum(["available","pending","sold"])',
    )
  })

  it('handles all-numeric enum values via t.UnionEnum (t.NumericEnum is string-keyed)', () => {
    expect(_enum({ enum: [1, 2, 3] })).toBe('t.UnionEnum([1,2,3])')
  })

  it('handles string + null enum values via t.Union (t.UnionEnum rejects null)', () => {
    expect(_enum({ enum: ['a', null] })).toBe('t.Union([t.Literal("a"),t.Null()])')
  })

  it('falls back to t.Union of t.Literal when a member is boolean (UnionEnum rejects booleans)', () => {
    expect(_enum({ enum: ['a', 1, true] })).toBe(
      't.Union([t.Literal("a"),t.Literal(1),t.Literal(true)])',
    )
  })

  it('emits a structural literal (t.Tuple) for an array enum member', () => {
    // Schema['enum'] allows arrays; arrays violate the UnionEnum precondition
    // (Elysia's t.UnionEnum throws on object/array members) so the generator
    // falls back to t.Union — and the array member becomes a t.Tuple of element
    // literals, since t.Literal only accepts string | number | boolean.
    expect(_enum({ enum: ['a', [1, 2]] })).toBe(
      't.Union([t.Literal("a"),t.Tuple([t.Literal(1),t.Literal(2)])])',
    )
  })

  it('emits t.Never for empty enum', () => {
    expect(_enum({ enum: [] })).toBe('t.Never()')
  })

  it('emits plain string error when only x-error-message is set on enum (UnionEnum form)', () => {
    expect(
      _enum({
        type: 'string',
        enum: ['a', 'b'],
        'x-error-message': 'invalid choice',
      }),
    ).toBe('t.UnionEnum(["a","b"],{error:"invalid choice","x-error-message":"invalid choice"})')
  })
})
