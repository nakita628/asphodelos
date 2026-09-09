import { describe, expect, it } from 'bun:test'

import { ref } from './ref.js'

describe('ref', () => {
  it('emits a bare schema identifier (Elysia idiom: direct schema reuse, no t.Ref)', () => {
    expect(ref({ $ref: '#/components/schemas/Pet' })).toBe('PetSchema')
  })

  it('PascalCases names with separators', () => {
    expect(ref({ $ref: '#/components/schemas/todo.entity' })).toBe('TodoEntitySchema')
  })

  it('falls back to t.Unknown() for non-component refs', () => {
    expect(ref({ $ref: '#/components/parameters/X' })).toBe('t.Unknown()')
  })

  it('falls back to t.Unknown() for a sub-property ref (degrade, no broken self-import)', () => {
    expect(ref({ $ref: '#/components/schemas/Composition/properties/recursive' })).toBe(
      't.Unknown()',
    )
  })

  it('falls back to t.Unknown() when $ref is missing', () => {
    expect(ref({ type: 'string' })).toBe('t.Unknown()')
  })
})
