import { describe, expect, it } from 'bun:test'

import { mockName, schemaToFaker } from './index.js'

describe('schemaToFaker — primitives', () => {
  it('string (no constraints) → bounded alpha', () => {
    expect(schemaToFaker({ type: 'string' })).toBe(
      'faker.string.alpha({ length: { min: 5, max: 20 } })',
    )
  })

  it('string honors minLength/maxLength', () => {
    expect(schemaToFaker({ type: 'string', minLength: 2, maxLength: 4 })).toBe(
      'faker.string.alpha({ length: { min: 2, max: 4 } })',
    )
  })

  it('integer (no constraints) → int 1..1000', () => {
    expect(schemaToFaker({ type: 'integer' })).toBe('faker.number.int({ min: 1, max: 1000 })')
  })

  it('integer honors minimum/maximum', () => {
    expect(schemaToFaker({ type: 'integer', minimum: 5, maximum: 9 })).toBe(
      'faker.number.int({ min: 5, max: 9 })',
    )
  })

  it('number → float', () => {
    expect(schemaToFaker({ type: 'number' })).toBe(
      'faker.number.float({ min: 1, max: 1000, fractionDigits: 2 })',
    )
  })

  it('boolean → datatype.boolean', () => {
    expect(schemaToFaker({ type: 'boolean' })).toBe('faker.datatype.boolean()')
  })

  it('unknown shape → undefined', () => {
    expect(schemaToFaker({})).toBe('undefined')
  })
})

describe('schemaToFaker — format mapping', () => {
  it('format:email → faker.internet.email()', () => {
    expect(schemaToFaker({ type: 'string', format: 'email' })).toBe('faker.internet.email()')
  })

  it('format:uuid → faker.string.uuid()', () => {
    expect(schemaToFaker({ type: 'string', format: 'uuid' })).toBe('faker.string.uuid()')
  })

  it('format:date-time → ISO string', () => {
    expect(schemaToFaker({ type: 'string', format: 'date-time' })).toBe(
      'faker.date.past().toISOString()',
    )
  })
})

describe('schemaToFaker — pattern / enum / const', () => {
  it('pattern → fromRegExp called with a string literal (no /.../ literal)', () => {
    expect(schemaToFaker({ type: 'string', pattern: '^a/b$' })).toBe(
      'faker.helpers.fromRegExp("^a/b$")',
    )
  })

  it('pattern with a line terminator stays inside the string literal (no injection)', () => {
    expect(schemaToFaker({ type: 'string', pattern: 'abc/\ndrop=1;/x' })).toBe(
      'faker.helpers.fromRegExp("abc/\\ndrop=1;/x")',
    )
  })

  it('enum → arrayElement of literals as const', () => {
    expect(schemaToFaker({ enum: ['a', 'b'] })).toBe(
      'faker.helpers.arrayElement(["a", "b"] as const)',
    )
  })

  it('const → JSON literal as const', () => {
    expect(schemaToFaker({ const: 'X' })).toBe('"X" as const')
  })
})

describe('schemaToFaker — composites', () => {
  it('$ref → mock function call (dots stripped)', () => {
    expect(schemaToFaker({ $ref: '#/components/schemas/Foo.Bar' })).toBe('mockFooBar()')
  })

  it('array → Array.from with item faker', () => {
    expect(schemaToFaker({ type: 'array', items: { type: 'integer' } })).toBe(
      'Array.from({ length: faker.number.int({ min: 1, max: 5 }) }, () => (faker.number.int({ min: 1, max: 1000 })))',
    )
  })

  it('object: optional props wrapped with undefined, required not', () => {
    expect(
      schemaToFaker({
        type: 'object',
        properties: { id: { type: 'integer' }, nick: { type: 'string' } },
        required: ['id'],
      }),
    ).toBe(
      '{ id: faker.number.int({ min: 1, max: 99999 }), nick: faker.helpers.arrayElement([faker.string.alpha({ length: { min: 5, max: 20 } }), undefined]) }',
    )
  })

  it('object: nullable prop wrapped with null', () => {
    expect(
      schemaToFaker({
        type: 'object',
        properties: { a: { type: 'string', nullable: true } },
        required: ['a'],
      }),
    ).toBe(
      '{ a: faker.helpers.arrayElement([faker.string.alpha({ length: { min: 5, max: 20 } }), null]) }',
    )
  })

  it('allOf merges spread refs with own props', () => {
    expect(
      schemaToFaker({
        allOf: [{ $ref: '#/components/schemas/A' }],
        properties: { x: { type: 'integer' } },
        required: ['x'],
      }),
    ).toBe('{ ...mockA(), x: faker.number.int({ min: 1, max: 1000 }) }')
  })

  it('oneOf → arrayElement of variants', () => {
    expect(schemaToFaker({ oneOf: [{ type: 'string' }, { type: 'integer' }] })).toBe(
      'faker.helpers.arrayElement([faker.string.alpha({ length: { min: 5, max: 20 } }), faker.number.int({ min: 1, max: 1000 })])',
    )
  })
})

describe('schemaToFaker — injection hardening', () => {
  it('mockName drops dots and neutralizes non-identifier characters', () => {
    expect(mockName('Foo.Bar')).toBe('mockFooBar')
    expect(mockName('Evil(){};x')).toBe('mockEvil_____x')
  })

  it('$ref uses the sanitized mock factory name', () => {
    expect(schemaToFaker({ $ref: '#/components/schemas/Evil(){};x' })).toBe('mockEvil_____x()')
  })

  it('a hostile object-property name is emitted as a quoted key (no breakout)', () => {
    expect(
      schemaToFaker({
        type: 'object',
        properties: { 'a:1},({}),b': { type: 'string' } },
        required: ['a:1},({}),b'],
      }),
    ).toBe('{ "a:1},({}),b": faker.string.alpha({ length: { min: 5, max: 20 } }) }')
  })
})

describe('schemaToFaker — type array & property-name hints', () => {
  it('type:[string,null] collapses to the non-null member', () => {
    expect(schemaToFaker({ type: ['string', 'null'] })).toBe(
      'faker.string.alpha({ length: { min: 5, max: 20 } })',
    )
  })

  it('property name hint applies (name → fullName)', () => {
    expect(schemaToFaker({ type: 'string' }, 'name')).toBe('faker.person.fullName()')
  })

  it('numeric property hint is skipped when the schema type is string', () => {
    expect(schemaToFaker({ type: 'string' }, 'id')).toBe(
      'faker.string.alpha({ length: { min: 5, max: 20 } })',
    )
  })
})

describe('schemaToFaker — constraints vs hints', () => {
  it('a host-enforced string format (email) is KEPT alongside a length constraint', () => {
    // Dropping the format for `alpha` would satisfy maxLength but always fail the
    // host's email format check. The format wins; length is best-effort.
    expect(schemaToFaker({ type: 'string', format: 'email', maxLength: 255 })).toBe(
      'faker.internet.email()',
    )
  })

  it('a numeric format hint (int32) yields to an explicit minimum', () => {
    expect(schemaToFaker({ type: 'integer', format: 'int32', minimum: 5 })).toBe(
      'faker.number.int({ min: 5, max: 1000 })',
    )
  })

  it("property hint 'price' is dropped when maximum is present", () => {
    expect(schemaToFaker({ type: 'number', maximum: 5 }, 'price')).toBe(
      'faker.number.float({ min: 1, max: 5, fractionDigits: 2 })',
    )
  })

  it("property hint 'count' is dropped when minimum/maximum are present", () => {
    expect(schemaToFaker({ type: 'integer', minimum: 5, maximum: 9 }, 'count')).toBe(
      'faker.number.int({ min: 5, max: 9 })',
    )
  })

  it('a length constraint without a declared format uses bounded alpha', () => {
    expect(schemaToFaker({ type: 'string', minLength: 2, maxLength: 4 }, 'name')).toBe(
      'faker.string.alpha({ length: { min: 2, max: 4 } })',
    )
  })
})

describe('schemaToFaker — exclusive bounds & multipleOf', () => {
  it('integer exclusiveMinimum/exclusiveMaximum (2020-12 numeric) pull inward by 1', () => {
    expect(schemaToFaker({ type: 'integer', exclusiveMinimum: 0, exclusiveMaximum: 10 })).toBe(
      'faker.number.int({ min: 1, max: 9 })',
    )
  })

  it('integer exclusiveMinimum (draft-04 boolean) pulls inward by 1', () => {
    expect(schemaToFaker({ type: 'integer', minimum: 5, exclusiveMinimum: true })).toBe(
      'faker.number.int({ min: 6, max: 1000 })',
    )
  })

  it('number exclusive bounds pull inward by 0.01', () => {
    expect(schemaToFaker({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1 })).toBe(
      'faker.number.float({ min: 0.01, max: 0.99, fractionDigits: 2 })',
    )
  })

  it('integer multipleOf within a range emits a bounded multiplier', () => {
    expect(schemaToFaker({ type: 'integer', minimum: 1, maximum: 100, multipleOf: 10 })).toBe(
      'faker.number.int({ min: 1, max: 10 }) * 10',
    )
  })

  it('integer multipleOf without bounds uses default 1..1000 range', () => {
    expect(schemaToFaker({ type: 'integer', multipleOf: 10 })).toBe(
      'faker.number.int({ min: 1, max: 100 }) * 10',
    )
  })
})

describe('schemaToFaker — array length honors minItems/maxItems', () => {
  it('fixed length (minItems === maxItems)', () => {
    expect(
      schemaToFaker({ type: 'array', items: { type: 'integer' }, minItems: 7, maxItems: 7 }),
    ).toBe(
      'Array.from({ length: faker.number.int({ min: 7, max: 7 }) }, () => (faker.number.int({ min: 1, max: 1000 })))',
    )
  })

  it('empty array (maxItems === 0)', () => {
    expect(
      schemaToFaker({ type: 'array', items: { type: 'integer' }, minItems: 0, maxItems: 0 }),
    ).toBe(
      'Array.from({ length: faker.number.int({ min: 0, max: 0 }) }, () => (faker.number.int({ min: 1, max: 1000 })))',
    )
  })
})
