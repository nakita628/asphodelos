import { describe, expect, it } from 'bun:test'

import { union } from './union.js'

describe('union', () => {
  it('emits t.Union of primitives', () => {
    expect(union([{ type: 'string' }, { type: 'integer' }])).toBe(
      't.Union([t.String(),t.Integer({maximum:9007199254740991})])',
    )
  })

  it('emits t.Union of refs', () => {
    expect(union([{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }])).toBe(
      't.Union([ASchema,BSchema])',
    )
  })

  it('flattens single-element union', () => {
    expect(union([{ type: 'string' }])).toBe('t.String()')
  })

  it('emits t.Never for empty union', () => {
    expect(union([])).toBe('t.Never()')
  })

  it('emits Union error callback for x-oneOf-message on parent', () => {
    expect(
      union([{ type: 'string' }, { type: 'integer' }], {
        oneOf: [{ type: 'string' }, { type: 'integer' }],
        'x-oneOf-message': 'pick exactly one',
      }),
    ).toBe(
      't.Union([t.String(),t.Integer({maximum:9007199254740991})],{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return "pick exactly one";return undefined},"x-oneOf-message":"pick exactly one"})',
    )
  })

  it('emits Union error callback for x-anyOf-message on parent', () => {
    expect(
      union([{ type: 'string' }, { type: 'integer' }], {
        anyOf: [{ type: 'string' }, { type: 'integer' }],
        'x-anyOf-message': 'no variant matched',
      }),
    ).toBe(
      't.Union([t.String(),t.Integer({maximum:9007199254740991})],{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return "no variant matched";return undefined},"x-anyOf-message":"no variant matched"})',
    )
  })
})
