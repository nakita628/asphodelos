import { describe, expect, it } from 'bun:test'

import { nonExistentPathValue } from './faker.js'

// 404-probe value for a path param: must satisfy the schema (so the host's
// TypeBox layer does not reject it with 422) yet be a value the implementation
// will not find. See helper/faker.ts.
describe('nonExistentPathValue', () => {
  it('unconstrained integer yields a large valid literal', () => {
    expect(nonExistentPathValue({ type: 'integer' })).toStrictEqual({
      kind: 'literal',
      value: '2147483647',
    })
  })

  it('integer honors minimum (no negative that would 422)', () => {
    expect(nonExistentPathValue({ type: 'integer', minimum: 1 })).toStrictEqual({
      kind: 'literal',
      value: '2147483647',
    })
  })

  it('integer with maximum stays within range', () => {
    expect(nonExistentPathValue({ type: 'integer', minimum: 1, maximum: 100 })).toStrictEqual({
      kind: 'literal',
      value: '100',
    })
  })

  it('integer honors exclusiveMaximum', () => {
    expect(
      nonExistentPathValue({ type: 'integer', maximum: 100, exclusiveMaximum: true }),
    ).toStrictEqual({ kind: 'literal', value: '99' })
  })

  it('integer honors multipleOf within range', () => {
    expect(
      nonExistentPathValue({ type: 'integer', minimum: 1, maximum: 100, multipleOf: 10 }),
    ).toStrictEqual({ kind: 'literal', value: '10' })
  })

  it('integer with minimum above the default ceiling still produces a value', () => {
    expect(nonExistentPathValue({ type: 'integer', minimum: 3_000_000_000 })).toStrictEqual({
      kind: 'literal',
      value: '3000000000',
    })
  })

  it('returns undefined when constraints admit no value (empty multipleOf range)', () => {
    expect(
      nonExistentPathValue({ type: 'integer', minimum: 5, maximum: 9, multipleOf: 10 }),
    ).toBeUndefined()
  })

  it('uuid format yields the zero UUID literal', () => {
    expect(nonExistentPathValue({ type: 'string', format: 'uuid' })).toStrictEqual({
      kind: 'literal',
      value: '00000000-0000-0000-0000-000000000000',
    })
  })

  it('pattern yields a runtime faker expression that satisfies it', () => {
    // faker keeps `^`/`$` of a string pattern in the value, so the anchors are stripped.
    expect(nonExistentPathValue({ type: 'string', pattern: '^[a-z]{3}$' })).toStrictEqual({
      kind: 'expr',
      code: 'faker.helpers.fromRegExp("[a-z]{3}")',
    })
  })

  it('plain string yields a readable literal', () => {
    expect(nonExistentPathValue({ type: 'string' })).toStrictEqual({
      kind: 'literal',
      value: '__non_existent__',
    })
  })

  it('string pads to satisfy minLength', () => {
    expect(nonExistentPathValue({ type: 'string', minLength: 20 })).toStrictEqual({
      kind: 'literal',
      value: '__non_existent__xxxx',
    })
  })

  it('string truncates to satisfy maxLength', () => {
    expect(nonExistentPathValue({ type: 'string', maxLength: 4 })).toStrictEqual({
      kind: 'literal',
      value: 'xxxx',
    })
  })

  it('enum admits no non-existent value (404 unprovable)', () => {
    expect(nonExistentPathValue({ type: 'string', enum: ['a', 'b'] })).toBeUndefined()
  })

  it('const admits no non-existent value (404 unprovable)', () => {
    expect(nonExistentPathValue({ const: 'fixed' })).toBeUndefined()
  })
})
