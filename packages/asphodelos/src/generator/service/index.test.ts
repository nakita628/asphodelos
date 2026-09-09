import { describe, expect, it } from 'bun:test'

import { serviceFile } from './index.js'

describe('serviceFile', () => {
  it('emits a minimal empty abstract class with no imports', () => {
    expect(serviceFile('pet')).toBe('export abstract class Pet{}\n')
  })

  it('capitalizes the tag for the class identifier', () => {
    expect(serviceFile('products')).toBe('export abstract class Products{}\n')
  })

  it('does not import status from elysia (scaffold body is empty)', () => {
    expect(serviceFile('users').includes("from 'elysia'")).toBe(false)
  })

  it('does not import a model type (scaffold body is empty)', () => {
    expect(serviceFile('orders').includes("from './model'")).toBe(false)
  })

  it('prefixes a leading-digit tag so the class identifier is valid', () => {
    expect(serviceFile('1')).toBe('export abstract class _1{}\n')
  })
})
