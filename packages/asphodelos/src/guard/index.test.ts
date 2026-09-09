import { describe, expect, it } from 'bun:test'

import type { Schema } from '../openapi/index.js'
import {
  isMediaWithSchema,
  isReference,
  isSchemaArray,
  isSecurityArray,
  isStringRef,
} from './index.js'

describe('isReference', () => {
  it('accepts a `$ref` object with a non-empty string', () => {
    expect(isReference({ $ref: '#/components/schemas/Pet' })).toBe(true)
  })

  it('rejects an empty `$ref` string', () => {
    expect(isReference({ $ref: '' })).toBe(false)
  })

  it('rejects a non-string `$ref`', () => {
    expect(isReference({ $ref: 123 })).toBe(false)
  })

  it('rejects an object without `$ref`', () => {
    expect(isReference({ type: 'object' })).toBe(false)
  })

  it('rejects null, undefined, and primitives', () => {
    expect(isReference(null)).toBe(false)
    expect(isReference(undefined)).toBe(false)
    expect(isReference('foo')).toBe(false)
    expect(isReference(42)).toBe(false)
  })
})

describe('isSchemaArray', () => {
  it('accepts a readonly Schema array', () => {
    const v: Schema | readonly Schema[] = [{ type: 'string' }, { type: 'number' }]
    expect(isSchemaArray(v)).toBe(true)
  })

  it('rejects a single Schema object', () => {
    const v: Schema | readonly Schema[] = { type: 'string' }
    expect(isSchemaArray(v)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isSchemaArray(undefined)).toBe(false)
  })
})

describe('isStringRef', () => {
  it('accepts a $ref object whose value is a string', () => {
    expect(isStringRef({ $ref: '#/components/schemas/Pet' })).toBe(true)
  })

  it('accepts an empty $ref string (unlike isReference which requires non-empty)', () => {
    // isStringRef is the narrower form used inside object-typed branches —
    // it does not re-check non-emptiness. Callers that need that should
    // use isReference instead.
    expect(isStringRef({ $ref: '' })).toBe(true)
  })

  it('rejects an object without $ref', () => {
    expect(isStringRef({ schema: { type: 'string' } })).toBe(false)
  })

  it('rejects a $ref whose value is not a string', () => {
    expect(isStringRef({ $ref: 123 })).toBe(false)
  })
})

describe('isMediaWithSchema', () => {
  it('accepts a Media object with a schema field', () => {
    expect(isMediaWithSchema({ schema: { type: 'string' } })).toBe(true)
  })

  it('rejects an object without schema (e.g. a Reference)', () => {
    expect(isMediaWithSchema({ $ref: '#/x' })).toBe(false)
  })

  it('rejects null, undefined, and primitives', () => {
    expect(isMediaWithSchema(null)).toBe(false)
    expect(isMediaWithSchema(undefined)).toBe(false)
    expect(isMediaWithSchema('schema')).toBe(false)
  })

  it('rejects arrays', () => {
    expect(isMediaWithSchema([{ schema: { type: 'string' } }])).toBe(false)
  })
})

describe('isSecurityArray', () => {
  it('accepts an array of security requirement objects', () => {
    expect(isSecurityArray([{ bearerAuth: [] }, { apiKey: ['read'] }])).toBe(true)
  })

  it('accepts an empty array', () => {
    expect(isSecurityArray([])).toBe(true)
  })

  it('rejects a non-array value', () => {
    expect(isSecurityArray({ bearerAuth: [] })).toBe(false)
  })

  it('rejects an array containing non-object elements', () => {
    expect(isSecurityArray(['bearerAuth'])).toBe(false)
    expect(isSecurityArray([null])).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isSecurityArray(undefined)).toBe(false)
  })
})
