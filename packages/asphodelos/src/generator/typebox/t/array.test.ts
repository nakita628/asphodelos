import { describe, expect, it } from 'bun:test'

import { array } from './array.js'

describe('array', () => {
  it('emits t.Array of primitive', () => {
    expect(array({ type: 'array', items: { type: 'string' } })).toBe('t.Array(t.String())')
  })

  it('emits t.Array of $ref', () => {
    expect(array({ type: 'array', items: { $ref: '#/components/schemas/Pet' } })).toBe(
      't.Array(PetSchema)',
    )
  })

  it('emits t.Tuple for prefixItems (OpenAPI 3.1)', () => {
    expect(
      array({
        type: 'array',
        prefixItems: [{ type: 'string' }, { type: 'integer' }],
      }),
    ).toBe('t.Tuple([t.String(),t.Integer({maximum:9007199254740991})])')
  })

  it('emits t.Tuple for items as array (legacy 3.0)', () => {
    expect(
      array({
        type: 'array',
        items: [{ type: 'string' }, { type: 'integer' }],
      }),
    ).toBe('t.Tuple([t.String(),t.Integer({maximum:9007199254740991})])')
  })

  it('emits min/max/unique constraints', () => {
    expect(
      array({
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        uniqueItems: true,
      }),
    ).toBe('t.Array(t.String(),{minItems:1,maxItems:10,uniqueItems:true})')
  })

  it('falls back to t.Unknown() when items is missing', () => {
    expect(array({ type: 'array' })).toBe('t.Array(t.Unknown())')
  })

  it('emits per-constraint error callback for x-minItems-message (ArrayMinItems)', () => {
    expect(
      array({
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        'x-minItems-message': 'at least one item',
      }),
    ).toBe(
      't.Array(t.String(),{minItems:1,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===4)return "at least one item";return undefined},"x-minItems-message":"at least one item"})',
    )
  })

  it('emits t.Files() when items are format:binary inside multipart/form-data', () => {
    expect(
      array(
        {
          type: 'array',
          items: { type: 'string', format: 'binary' },
        },
        { mediaType: 'multipart/form-data' },
      ),
    ).toBe('t.Files()')
  })

  it('emits t.Files({type:..., minItems, maxItems}) propagating items.contentMediaType', () => {
    expect(
      array(
        {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: {
            type: 'string',
            format: 'binary',
            contentMediaType: 'image/*',
          },
        },
        { mediaType: 'multipart/form-data' },
      ),
    ).toBe('t.Files({type:"image/*",minItems:1,maxItems:5})')
  })

  it('emits t.Files with per-file size bounds from items.minLength/maxLength', () => {
    expect(
      array(
        {
          type: 'array',
          items: {
            type: 'string',
            format: 'binary',
            minLength: 1024,
            maxLength: 1_048_576,
          },
        },
        { mediaType: 'multipart/form-data' },
      ),
    ).toBe('t.Files({minSize:1024,maxSize:1048576})')
  })

  it('keeps t.Array(t.File(...)) when items are binary but media-type is NOT multipart', () => {
    // Without the multipart hint, the array stays as a generic file array
    // (default `t.File()` fallback per element) — `t.Files` is multipart-
    // specific by design.
    expect(
      array({
        type: 'array',
        items: { type: 'string', format: 'binary' },
      }),
    ).toBe('t.Array(t.File())')
  })

  it('emits t.Tuple([]) for empty prefixItems', () => {
    // Empty prefixItems is a valid OpenAPI 3.1 schema (a 0-element tuple);
    // the generator emits an empty `t.Tuple([])` rather than falling back
    // to `t.Array(...)`.
    expect(array({ type: 'array', prefixItems: [] })).toBe('t.Tuple([])')
  })

  it('emits t.Tuple([]) for empty items array (legacy 3.0 0-element tuple)', () => {
    expect(array({ type: 'array', items: [] })).toBe('t.Tuple([])')
  })

  it('forwards contains / minContains / maxContains to t.Array for native enforcement', () => {
    expect(
      array({
        type: 'array',
        items: { type: 'string' },
        contains: { type: 'string' },
        minContains: 1,
        maxContains: 3,
        'x-contains-message': 'must contain a string',
      }),
    ).toBe(
      't.Array(t.String(),{contains:t.String(),minContains:1,maxContains:3,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===0)return "must contain a string";return undefined},"x-contains-message":"must contain a string"})',
    )
  })
})
