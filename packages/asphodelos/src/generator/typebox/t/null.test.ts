import { describe, expect, it } from 'bun:test'

import { nullType } from './null.js'

describe('nullType', () => {
  it('emits t.Null()', () => {
    expect(nullType()).toBe('t.Null()')
  })
})
