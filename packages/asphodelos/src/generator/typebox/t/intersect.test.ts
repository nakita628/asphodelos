import { describe, expect, it } from 'bun:test'

import { intersect } from './intersect.js'

describe('intersect', () => {
  it('emits t.Intersect for two schemas', () => {
    expect(
      intersect([{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }]),
    ).toBe('t.Intersect([ASchema,BSchema])')
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
