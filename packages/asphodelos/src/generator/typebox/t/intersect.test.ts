import { describe, expect, it } from 'bun:test'

import { intersect } from './intersect.js'

describe('intersect', () => {
  it('emits t.Intersect for two schemas', () => {
    expect(
      intersect([{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }]),
    ).toBe('t.Intersect([ASchema,BSchema])')
  })

  // Elysia's `t.Integer()` is a coercing union TypeBox will not intersect, and a constraint
  // bag has no type of its own: the two are one bounded integer.
  it('merges scalar members into one schema instead of intersecting them', () => {
    expect(intersect([{ type: 'integer' }, { minimum: 5 }])).toBe(
      't.Integer({minimum:5,maximum:9007199254740991})',
    )
    expect(
      intersect([{ type: 'string' }, { minLength: 2 }], { allOf: [], description: 'a code' }),
    ).toBe('t.String({minLength:2,description:"a code"})')
  })

  it('keeps t.Intersect for members that are objects or references', () => {
    expect(
      intersect([
        { type: 'object', properties: { a: { type: 'string' } } },
        { $ref: '#/components/schemas/B' },
      ]),
    ).toContain('t.Intersect([')
  })

  it('flattens single-element allOf', () => {
    expect(intersect([{ type: 'string' }])).toBe('t.String()')
  })

  it('emits t.Unknown for empty allOf', () => {
    expect(intersect([])).toBe('t.Unknown()')
  })

  it('emits Intersect error callback for x-allOf-message on parent', () => {
    expect(
      intersect([{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }], {
        allOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
        'x-allOf-message': 'must satisfy all',
      }),
    ).toBe(
      't.Intersect([ASchema,BSchema],{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===29)return "must satisfy all";return undefined},"x-allOf-message":"must satisfy all"})',
    )
  })
})
