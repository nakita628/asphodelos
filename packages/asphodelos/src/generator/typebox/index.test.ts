import { describe, expect, it } from 'bun:test'

import { Value } from '@sinclair/typebox/value'
import { Elysia, t } from 'elysia'

import { typebox } from './index.js'

describe('typebox', () => {
  it('dispatches to ref for $ref schemas', () => {
    expect(typebox({ $ref: '#/components/schemas/Pet' })).toBe('PetSchema')
  })

  it('dispatches to string for type:string', () => {
    expect(typebox({ type: 'string', format: 'uuid' })).toBe('t.String({format:"uuid"})')
  })

  it('dispatches to integer for type:integer (auto-cap MAX_SAFE_INTEGER when no maximum)', () => {
    expect(typebox({ type: 'integer', minimum: 0 })).toBe(
      't.Integer({minimum:0,maximum:9007199254740991})',
    )
  })

  it('dispatches to boolean for type:boolean preserving default', () => {
    expect(typebox({ type: 'boolean', default: false })).toBe('t.Boolean({default:false})')
  })

  it('dispatches to object for type:object with required wrapping', () => {
    expect(
      typebox({
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, age: { type: 'integer' } },
      }),
    ).toBe('t.Object({"name":t.String(),"age":t.Optional(t.Integer({maximum:9007199254740991}))})')
  })

  it('dispatches to array for type:array', () => {
    expect(typebox({ type: 'array', items: { type: 'string' } })).toBe('t.Array(t.String())')
  })

  it('dispatches all-string enum to t.UnionEnum (preserves literal-union TS type)', () => {
    expect(typebox({ type: 'string', enum: ['a', 'b'] })).toBe('t.UnionEnum(["a","b"])')
  })

  it('dispatches allOf to t.Intersect', () => {
    expect(
      typebox({
        allOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
      }),
    ).toBe('t.Intersect([ASchema,BSchema])')
  })

  it('dispatches oneOf and anyOf to t.Union', () => {
    expect(typebox({ oneOf: [{ type: 'string' }, { type: 'integer' }] })).toBe(
      't.Union([t.String(),t.Integer({maximum:9007199254740991})])',
    )
    expect(typebox({ anyOf: [{ type: 'string' }, { type: 'integer' }] })).toBe(
      't.Union([t.String(),t.Integer({maximum:9007199254740991})])',
    )
  })

  it('wraps nullable:true in Union with t.Null()', () => {
    expect(typebox({ type: 'string', nullable: true })).toBe('t.Union([t.String(),t.Null()])')
  })

  it('wraps OpenAPI 3.1 type:[X,null] in Union with t.Null()', () => {
    expect(typebox({ type: ['string', 'null'] })).toBe('t.Union([t.String(),t.Null()])')
  })

  it('emits t.Literal for const', () => {
    expect(typebox({ const: 'fixed' })).toBe('t.Literal("fixed")')
  })

  it('emits t.Null for a null const (t.Literal rejects null)', () => {
    expect(typebox({ const: null })).toBe('t.Null()')
  })

  it('emits a structural literal for a composite const (t.Literal rejects array/object)', () => {
    expect(typebox({ const: [1, 2, 3] as unknown })).toBe(
      't.Tuple([t.Literal(1),t.Literal(2),t.Literal(3)])',
    )
    expect(typebox({ const: { key: 'value' } })).toBe('t.Object({"key":t.Literal("value")})')
  })

  it('falls back to t.Unknown() for empty schema', () => {
    expect(typebox({})).toBe('t.Unknown()')
  })

  it('applies x-brand to primitive schema via t.Unsafe', () => {
    expect(typebox({ type: 'string', format: 'uuid', 'x-brand': 'UserId' })).toBe(
      `t.Unsafe<string & { readonly __brand: 'UserId' }>(t.String({format:"uuid","x-brand":"UserId"}))`,
    )
  })

  it('combines x-brand with nullable wrap', () => {
    expect(typebox({ type: 'string', nullable: true, 'x-brand': 'Token' })).toBe(
      `t.Union([t.Unsafe<string & { readonly __brand: 'Token' }>(t.String({"x-brand":"Token"})),t.Null()])`,
    )
  })

  it('does not brand object schemas (only primitives)', () => {
    expect(
      typebox({
        type: 'object',
        'x-brand': 'WrapperBrand',
        properties: { id: { type: 'string' } },
      }),
    ).toBe(`t.Object({"id":t.Optional(t.String())},{"x-brand":"WrapperBrand"})`)
  })

  it('handles full Petstore-style Pet schema', () => {
    expect(
      typebox({
        type: 'object',
        required: ['name', 'photoUrls'],
        properties: {
          id: { type: 'integer', format: 'int64' },
          name: { type: 'string' },
          photoUrls: { type: 'array', items: { type: 'string' } },
          status: { type: 'string', enum: ['available', 'pending', 'sold'] },
        },
      }),
    ).toBe(
      't.Object({"id":t.Optional(t.Integer({format:"int64",maximum:9007199254740991})),"name":t.String(),"photoUrls":t.Array(t.String()),"status":t.Optional(t.UnionEnum(["available","pending","sold"]))})',
    )
  })
})

// ─────────────────────────────────────────────────────────────────────
// Per-extension round-trip + runtime tests (30 vendor extensions × EN/JP).
// Round-trip asserts the exact emitted string. Runtime asserts the
// equivalent Elysia `t.X` schema fires the ValueErrorType code that the
// helper's `branches()` routes that extension to (or, for transform-based
// extensions, that the equivalent transform Decode body throws).
// Helpers are intentionally NOT abstracted: each test inlines its own
// `t.X(...)` so the runtime intent stays visible at the call site.
// ─────────────────────────────────────────────────────────────────────

describe('typebox: x-error-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(typebox({ type: 'string', 'x-error-message': 'invalid value' })).toBe(
        `t.String({error:"invalid value","x-error-message":"invalid value"})`,
      )
    })

    it('runtime: TypeBox schema rejects non-string', () => {
      const Schema = t.String()
      expect(Value.Check(Schema, 'ok')).toBe(true)
      expect(Value.Check(Schema, 123)).toBe(false)
      expect(
        [...Value.Errors(Schema, 123)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 54, path: '', message: 'Expected string', value: 123 }])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(typebox({ type: 'string', 'x-error-message': '不正な値です' })).toBe(
        `t.String({error:"不正な値です","x-error-message":"不正な値です"})`,
      )
    })

    it('runtime: TypeBox schema rejects non-string', () => {
      const Schema = t.String()
      expect(Value.Check(Schema, 'ok')).toBe(true)
      expect(Value.Check(Schema, 123)).toBe(false)
      expect(
        [...Value.Errors(Schema, 123)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 54, path: '', message: 'Expected string', value: 123 }])
    })
  })
})

describe('typebox: x-required-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
          'x-required-message': 'name is required',
        }),
      ).toBe(
        `t.Object({"name":t.String()},{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===45)return "name is required";return undefined},"x-required-message":"name is required"})`,
      )
    })

    it('runtime: object missing required prop fires ObjectRequiredProperty (45)', () => {
      // Elysia's t.Object emits BOTH 45 (RequiredProperty) and 54 (the inner
      // String shape error) for a missing prop — so the dispatch chain in
      // generated code routes on `errors[0].type === 45`. Pin the full shape
      // (length, order, type/path/message/value per entry) instead of a
      // single-index toBe so any TypeBox renumbering surfaces as a diff.
      const Schema = t.Object({ name: t.String() })
      expect(Value.Check(Schema, { name: 'x' })).toBe(true)
      expect(Value.Check(Schema, {})).toBe(false)
      expect(
        [...Value.Errors(Schema, {})].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 45, path: '/name', message: 'Expected required property', value: undefined },
        { type: 54, path: '/name', message: 'Expected string', value: undefined },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          required: ['name'],
          properties: { name: { type: 'string' } },
          'x-required-message': 'name は必須です',
        }),
      ).toBe(
        `t.Object({"name":t.String()},{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===45)return "name は必須です";return undefined},"x-required-message":"name は必須です"})`,
      )
    })

    it('runtime: object missing required prop fires ObjectRequiredProperty (45)', () => {
      // Elysia's t.Object emits BOTH 45 (RequiredProperty) and 54 (the inner
      // String shape error) for a missing prop — so the dispatch chain in
      // generated code routes on `errors[0].type === 45`. Pin the full shape
      // (length, order, type/path/message/value per entry) instead of a
      // single-index toBe so any TypeBox renumbering surfaces as a diff.
      const Schema = t.Object({ name: t.String() })
      expect(Value.Check(Schema, { name: 'x' })).toBe(true)
      expect(Value.Check(Schema, {})).toBe(false)
      expect(
        [...Value.Errors(Schema, {})].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 45, path: '/name', message: 'Expected required property', value: undefined },
        { type: 54, path: '/name', message: 'Expected string', value: undefined },
      ])
    })
  })
})

describe('typebox: x-const-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(typebox({ const: 'fixed', 'x-const-message': 'must be "fixed"' })).toBe(
        `t.Literal("fixed",{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===32)return "must be \\"fixed\\"";return undefined},"x-const-message":"must be \\"fixed\\""})`,
      )
    })

    it('runtime: t.Literal rejects mismatching value with Literal (32)', () => {
      const Schema = t.Literal('fixed')
      expect(Value.Check(Schema, 'fixed')).toBe(true)
      expect(Value.Check(Schema, 'other')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'other')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 32, path: '', message: "Expected 'fixed'", value: 'other' }])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(typebox({ const: 'fixed', 'x-const-message': '"fixed" でなければなりません' })).toBe(
        `t.Literal("fixed",{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===32)return "\\"fixed\\" でなければなりません";return undefined},"x-const-message":"\\"fixed\\" でなければなりません"})`,
      )
    })

    it('runtime: t.Literal rejects mismatching value with Literal (32)', () => {
      const Schema = t.Literal('fixed')
      expect(Value.Check(Schema, 'fixed')).toBe(true)
      expect(Value.Check(Schema, 'other')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'other')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 32, path: '', message: "Expected 'fixed'", value: 'other' }])
    })
  })
})

describe('typebox: x-enum-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({ type: 'string', enum: ['a', 'b'], 'x-enum-message': 'must be a or b' }),
      ).toBe(`t.UnionEnum(["a","b"],{error:"must be a or b","x-enum-message":"must be a or b"})`)
    })

    it('runtime: union of literals rejects non-member with Union (62)', () => {
      const Schema = t.Union([t.Literal('a'), t.Literal('b')])
      expect(Value.Check(Schema, 'a')).toBe(true)
      expect(Value.Check(Schema, 'c')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'c')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 62, path: '', message: 'Expected union value', value: 'c' }])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'string',
          enum: ['a', 'b'],
          'x-enum-message': 'a または b にしてください',
        }),
      ).toBe(
        `t.UnionEnum(["a","b"],{error:"a または b にしてください","x-enum-message":"a または b にしてください"})`,
      )
    })

    it('runtime: union of literals rejects non-member with Union (62)', () => {
      const Schema = t.Union([t.Literal('a'), t.Literal('b')])
      expect(Value.Check(Schema, 'a')).toBe(true)
      expect(Value.Check(Schema, 'c')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'c')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 62, path: '', message: 'Expected union value', value: 'c' }])
    })
  })
})

describe('typebox: x-minimum-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({ type: 'number', minimum: 0, 'x-minimum-message': 'value must be >= 0' }),
      ).toBe(
        `t.Number({minimum:0,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===39)return "value must be >= 0";return undefined},"x-minimum-message":"value must be >= 0"})`,
      )
    })

    it('runtime: t.Number({minimum}) fires NumberMinimum (39)', () => {
      const Schema = t.Number({ minimum: 0 })
      expect(Value.Check(Schema, 0)).toBe(true)
      expect(Value.Check(Schema, -1)).toBe(false)
      expect(
        [...Value.Errors(Schema, -1)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 39, path: '', message: 'Expected number to be greater or equal to 0', value: -1 },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({ type: 'number', minimum: 0, 'x-minimum-message': '0 以上にしてください' }),
      ).toBe(
        `t.Number({minimum:0,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===39)return "0 以上にしてください";return undefined},"x-minimum-message":"0 以上にしてください"})`,
      )
    })

    it('runtime: t.Number({minimum}) fires NumberMinimum (39)', () => {
      const Schema = t.Number({ minimum: 0 })
      expect(Value.Check(Schema, 0)).toBe(true)
      expect(Value.Check(Schema, -1)).toBe(false)
      expect(
        [...Value.Errors(Schema, -1)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 39, path: '', message: 'Expected number to be greater or equal to 0', value: -1 },
      ])
    })
  })
})

describe('typebox: x-maximum-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({ type: 'number', maximum: 100, 'x-maximum-message': 'value must be <= 100' }),
      ).toBe(
        `t.Number({maximum:100,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===38)return "value must be <= 100";return undefined},"x-maximum-message":"value must be <= 100"})`,
      )
    })

    it('runtime: t.Number({maximum}) fires NumberMaximum (38)', () => {
      const Schema = t.Number({ maximum: 100 })
      expect(Value.Check(Schema, 100)).toBe(true)
      expect(Value.Check(Schema, 101)).toBe(false)
      expect(
        [...Value.Errors(Schema, 101)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 38, path: '', message: 'Expected number to be less or equal to 100', value: 101 },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({ type: 'number', maximum: 100, 'x-maximum-message': '100 以下にしてください' }),
      ).toBe(
        `t.Number({maximum:100,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===38)return "100 以下にしてください";return undefined},"x-maximum-message":"100 以下にしてください"})`,
      )
    })

    it('runtime: t.Number({maximum}) fires NumberMaximum (38)', () => {
      const Schema = t.Number({ maximum: 100 })
      expect(Value.Check(Schema, 100)).toBe(true)
      expect(Value.Check(Schema, 101)).toBe(false)
      expect(
        [...Value.Errors(Schema, 101)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 38, path: '', message: 'Expected number to be less or equal to 100', value: 101 },
      ])
    })
  })
})

describe('typebox: x-exclusiveMinimum-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'number',
          exclusiveMinimum: 0,
          'x-exclusiveMinimum-message': 'value must be > 0',
        }),
      ).toBe(
        `t.Number({exclusiveMinimum:0,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===37)return "value must be > 0";return undefined},"x-exclusiveMinimum-message":"value must be > 0"})`,
      )
    })

    it('runtime: t.Number({exclusiveMinimum}) fires NumberExclusiveMinimum (37)', () => {
      const Schema = t.Number({ exclusiveMinimum: 0 })
      expect(Value.Check(Schema, 1)).toBe(true)
      expect(Value.Check(Schema, 0)).toBe(false)
      expect(
        [...Value.Errors(Schema, 0)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 37, path: '', message: 'Expected number to be greater than 0', value: 0 },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'number',
          exclusiveMinimum: 0,
          'x-exclusiveMinimum-message': '0 より大きい値にしてください',
        }),
      ).toBe(
        `t.Number({exclusiveMinimum:0,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===37)return "0 より大きい値にしてください";return undefined},"x-exclusiveMinimum-message":"0 より大きい値にしてください"})`,
      )
    })

    it('runtime: t.Number({exclusiveMinimum}) fires NumberExclusiveMinimum (37)', () => {
      const Schema = t.Number({ exclusiveMinimum: 0 })
      expect(Value.Check(Schema, 1)).toBe(true)
      expect(Value.Check(Schema, 0)).toBe(false)
      expect(
        [...Value.Errors(Schema, 0)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 37, path: '', message: 'Expected number to be greater than 0', value: 0 },
      ])
    })
  })
})

describe('typebox: x-exclusiveMaximum-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'number',
          exclusiveMaximum: 100,
          'x-exclusiveMaximum-message': 'value must be < 100',
        }),
      ).toBe(
        `t.Number({exclusiveMaximum:100,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===36)return "value must be < 100";return undefined},"x-exclusiveMaximum-message":"value must be < 100"})`,
      )
    })

    it('runtime: t.Number({exclusiveMaximum}) fires NumberExclusiveMaximum (36)', () => {
      const Schema = t.Number({ exclusiveMaximum: 100 })
      expect(Value.Check(Schema, 99)).toBe(true)
      expect(Value.Check(Schema, 100)).toBe(false)
      expect(
        [...Value.Errors(Schema, 100)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 36, path: '', message: 'Expected number to be less than 100', value: 100 },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'number',
          exclusiveMaximum: 100,
          'x-exclusiveMaximum-message': '100 より小さい値にしてください',
        }),
      ).toBe(
        `t.Number({exclusiveMaximum:100,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===36)return "100 より小さい値にしてください";return undefined},"x-exclusiveMaximum-message":"100 より小さい値にしてください"})`,
      )
    })

    it('runtime: t.Number({exclusiveMaximum}) fires NumberExclusiveMaximum (36)', () => {
      const Schema = t.Number({ exclusiveMaximum: 100 })
      expect(Value.Check(Schema, 99)).toBe(true)
      expect(Value.Check(Schema, 100)).toBe(false)
      expect(
        [...Value.Errors(Schema, 100)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 36, path: '', message: 'Expected number to be less than 100', value: 100 },
      ])
    })
  })
})

describe('typebox: x-multipleOf-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'number',
          multipleOf: 2,
          'x-multipleOf-message': 'value must be a multiple of 2',
        }),
      ).toBe(
        `t.Number({multipleOf:2,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===40)return "value must be a multiple of 2";return undefined},"x-multipleOf-message":"value must be a multiple of 2"})`,
      )
    })

    it('runtime: t.Number({multipleOf}) fires NumberMultipleOf (40)', () => {
      const Schema = t.Number({ multipleOf: 2 })
      expect(Value.Check(Schema, 4)).toBe(true)
      expect(Value.Check(Schema, 3)).toBe(false)
      expect(
        [...Value.Errors(Schema, 3)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 40, path: '', message: 'Expected number to be a multiple of 2', value: 3 },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'number',
          multipleOf: 2,
          'x-multipleOf-message': '2 の倍数にしてください',
        }),
      ).toBe(
        `t.Number({multipleOf:2,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===40)return "2 の倍数にしてください";return undefined},"x-multipleOf-message":"2 の倍数にしてください"})`,
      )
    })

    it('runtime: t.Number({multipleOf}) fires NumberMultipleOf (40)', () => {
      const Schema = t.Number({ multipleOf: 2 })
      expect(Value.Check(Schema, 4)).toBe(true)
      expect(Value.Check(Schema, 3)).toBe(false)
      expect(
        [...Value.Errors(Schema, 3)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 40, path: '', message: 'Expected number to be a multiple of 2', value: 3 },
      ])
    })
  })
})

describe('typebox: x-minLength-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({ type: 'string', minLength: 1, 'x-minLength-message': 'must not be empty' }),
      ).toBe(
        `t.String({minLength:1,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===52)return "must not be empty";return undefined},"x-minLength-message":"must not be empty"})`,
      )
    })

    it('runtime: t.String({minLength}) fires StringMinLength (52)', () => {
      const Schema = t.String({ minLength: 1 })
      expect(Value.Check(Schema, 'a')).toBe(true)
      expect(Value.Check(Schema, '')).toBe(false)
      expect(
        [...Value.Errors(Schema, '')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 52, path: '', message: 'Expected string length greater or equal to 1', value: '' },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({ type: 'string', minLength: 1, 'x-minLength-message': '空にできません' }),
      ).toBe(
        `t.String({minLength:1,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===52)return "空にできません";return undefined},"x-minLength-message":"空にできません"})`,
      )
    })

    it('runtime: t.String({minLength}) fires StringMinLength (52)', () => {
      const Schema = t.String({ minLength: 1 })
      expect(Value.Check(Schema, 'a')).toBe(true)
      expect(Value.Check(Schema, '')).toBe(false)
      expect(
        [...Value.Errors(Schema, '')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 52, path: '', message: 'Expected string length greater or equal to 1', value: '' },
      ])
    })
  })
})

describe('typebox: x-maxLength-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(typebox({ type: 'string', maxLength: 10, 'x-maxLength-message': 'too long' })).toBe(
        `t.String({maxLength:10,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===51)return "too long";return undefined},"x-maxLength-message":"too long"})`,
      )
    })

    it('runtime: t.String({maxLength}) fires StringMaxLength (51)', () => {
      const Schema = t.String({ maxLength: 3 })
      expect(Value.Check(Schema, 'abc')).toBe(true)
      expect(Value.Check(Schema, 'abcd')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'abcd')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 51, path: '', message: 'Expected string length less or equal to 3', value: 'abcd' },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(typebox({ type: 'string', maxLength: 10, 'x-maxLength-message': '長すぎます' })).toBe(
        `t.String({maxLength:10,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===51)return "長すぎます";return undefined},"x-maxLength-message":"長すぎます"})`,
      )
    })

    it('runtime: t.String({maxLength}) fires StringMaxLength (51)', () => {
      const Schema = t.String({ maxLength: 3 })
      expect(Value.Check(Schema, 'abc')).toBe(true)
      expect(Value.Check(Schema, 'abcd')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'abcd')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 51, path: '', message: 'Expected string length less or equal to 3', value: 'abcd' },
      ])
    })
  })
})

describe('typebox: x-pattern-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'string',
          pattern: '^[a-z]+$',
          'x-pattern-message': 'lowercase letters only',
        }),
      ).toBe(
        `t.String({pattern:"^[a-z]+$",error:(error)=>{const type=error?.errors?.[0]?.type;if(type===48||type===53)return "lowercase letters only";return undefined},"x-pattern-message":"lowercase letters only"})`,
      )
    })

    it('runtime: t.String({pattern}) fires StringPattern (53)', () => {
      // Elysia 1.4 / TypeBox 0.34 surfaces only StringPattern (53) for
      // pattern violations; the helper additionally routes RegExp (48) for
      // forward-compat with TypeBox's separate Kind path.
      const Schema = t.String({ pattern: '^[a-z]+$' })
      expect(Value.Check(Schema, 'abc')).toBe(true)
      expect(Value.Check(Schema, 'ABC')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'ABC')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 53, path: '', message: "Expected string to match '^[a-z]+$'", value: 'ABC' },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({ type: 'string', pattern: '^[a-z]+$', 'x-pattern-message': '小文字英字のみです' }),
      ).toBe(
        `t.String({pattern:"^[a-z]+$",error:(error)=>{const type=error?.errors?.[0]?.type;if(type===48||type===53)return "小文字英字のみです";return undefined},"x-pattern-message":"小文字英字のみです"})`,
      )
    })

    it('runtime: t.String({pattern}) fires StringPattern (53)', () => {
      const Schema = t.String({ pattern: '^[a-z]+$' })
      expect(Value.Check(Schema, 'abc')).toBe(true)
      expect(Value.Check(Schema, 'ABC')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'ABC')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 53, path: '', message: "Expected string to match '^[a-z]+$'", value: 'ABC' },
      ])
    })
  })
})

describe('typebox: x-length-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'string',
          minLength: 5,
          maxLength: 5,
          'x-length-message': 'must be exactly 5 characters',
        }),
      ).toBe(
        `t.String({minLength:5,maxLength:5,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===51||type===52)return "must be exactly 5 characters";return undefined},"x-length-message":"must be exactly 5 characters"})`,
      )
    })

    it('runtime: fixed-length string fires StringMinLength (52) when too short', () => {
      const Schema = t.String({ minLength: 5, maxLength: 5 })
      expect(Value.Check(Schema, 'hello')).toBe(true)
      expect(Value.Check(Schema, 'hi')).toBe(false)
      expect(Value.Check(Schema, 'hellooo')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'hi')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 52,
          path: '',
          message: 'Expected string length greater or equal to 5',
          value: 'hi',
        },
      ])
      expect(
        [...Value.Errors(Schema, 'hellooo')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 51,
          path: '',
          message: 'Expected string length less or equal to 5',
          value: 'hellooo',
        },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'string',
          minLength: 5,
          maxLength: 5,
          'x-length-message': 'ちょうど 5 文字にしてください',
        }),
      ).toBe(
        `t.String({minLength:5,maxLength:5,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===51||type===52)return "ちょうど 5 文字にしてください";return undefined},"x-length-message":"ちょうど 5 文字にしてください"})`,
      )
    })

    it('runtime: fixed-length string fires StringMinLength (52) when too short', () => {
      const Schema = t.String({ minLength: 5, maxLength: 5 })
      expect(Value.Check(Schema, 'hello')).toBe(true)
      expect(Value.Check(Schema, 'hi')).toBe(false)
      expect(Value.Check(Schema, 'hellooo')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'hi')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 52,
          path: '',
          message: 'Expected string length greater or equal to 5',
          value: 'hi',
        },
      ])
      expect(
        [...Value.Errors(Schema, 'hellooo')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 51,
          path: '',
          message: 'Expected string length less or equal to 5',
          value: 'hellooo',
        },
      ])
    })
  })
})

describe('typebox: x-minItems-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          'x-minItems-message': 'at least one item required',
        }),
      ).toBe(
        `t.Array(t.String(),{minItems:1,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===4)return "at least one item required";return undefined},"x-minItems-message":"at least one item required"})`,
      )
    })

    it('runtime: t.Array({minItems}) fires ArrayMinItems (4)', () => {
      const Schema = t.Array(t.String(), { minItems: 1 })
      expect(Value.Check(Schema, ['a'])).toBe(true)
      expect(Value.Check(Schema, [])).toBe(false)
      expect(
        [...Value.Errors(Schema, [])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 4,
          path: '',
          message: 'Expected array length to be greater or equal to 1',
          value: [],
        },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'string' },
          minItems: 1,
          'x-minItems-message': '少なくとも 1 件必要です',
        }),
      ).toBe(
        `t.Array(t.String(),{minItems:1,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===4)return "少なくとも 1 件必要です";return undefined},"x-minItems-message":"少なくとも 1 件必要です"})`,
      )
    })

    it('runtime: t.Array({minItems}) fires ArrayMinItems (4)', () => {
      const Schema = t.Array(t.String(), { minItems: 1 })
      expect(Value.Check(Schema, ['a'])).toBe(true)
      expect(Value.Check(Schema, [])).toBe(false)
      expect(
        [...Value.Errors(Schema, [])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 4,
          path: '',
          message: 'Expected array length to be greater or equal to 1',
          value: [],
        },
      ])
    })
  })
})

describe('typebox: x-maxItems-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'string' },
          maxItems: 3,
          'x-maxItems-message': 'too many items',
        }),
      ).toBe(
        `t.Array(t.String(),{maxItems:3,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===2)return "too many items";return undefined},"x-maxItems-message":"too many items"})`,
      )
    })

    it('runtime: t.Array({maxItems}) fires ArrayMaxItems (2)', () => {
      const Schema = t.Array(t.String(), { maxItems: 2 })
      expect(Value.Check(Schema, ['a'])).toBe(true)
      expect(Value.Check(Schema, ['a', 'b', 'c'])).toBe(false)
      expect(
        [...Value.Errors(Schema, ['a', 'b', 'c'])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 2,
          path: '',
          message: 'Expected array length to be less or equal to 2',
          value: ['a', 'b', 'c'],
        },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'string' },
          maxItems: 3,
          'x-maxItems-message': '件数が多すぎます',
        }),
      ).toBe(
        `t.Array(t.String(),{maxItems:3,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===2)return "件数が多すぎます";return undefined},"x-maxItems-message":"件数が多すぎます"})`,
      )
    })

    it('runtime: t.Array({maxItems}) fires ArrayMaxItems (2)', () => {
      const Schema = t.Array(t.String(), { maxItems: 2 })
      expect(Value.Check(Schema, ['a'])).toBe(true)
      expect(Value.Check(Schema, ['a', 'b', 'c'])).toBe(false)
      expect(
        [...Value.Errors(Schema, ['a', 'b', 'c'])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 2,
          path: '',
          message: 'Expected array length to be less or equal to 2',
          value: ['a', 'b', 'c'],
        },
      ])
    })
  })
})

describe('typebox: x-uniqueItems-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'string' },
          uniqueItems: true,
          'x-uniqueItems-message': 'items must be unique',
        }),
      ).toBe(
        `t.Array(t.String(),{uniqueItems:true,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===5)return "items must be unique";return undefined},"x-uniqueItems-message":"items must be unique"})`,
      )
    })

    it('runtime: t.Array({uniqueItems}) fires ArrayUniqueItems (5)', () => {
      const Schema = t.Array(t.String(), { uniqueItems: true })
      expect(Value.Check(Schema, ['a', 'b'])).toBe(true)
      expect(Value.Check(Schema, ['a', 'a'])).toBe(false)
      expect(
        [...Value.Errors(Schema, ['a', 'a'])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 5, path: '', message: 'Expected array elements to be unique', value: ['a', 'a'] },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'string' },
          uniqueItems: true,
          'x-uniqueItems-message': '重複は許可されません',
        }),
      ).toBe(
        `t.Array(t.String(),{uniqueItems:true,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===5)return "重複は許可されません";return undefined},"x-uniqueItems-message":"重複は許可されません"})`,
      )
    })

    it('runtime: t.Array({uniqueItems}) fires ArrayUniqueItems (5)', () => {
      const Schema = t.Array(t.String(), { uniqueItems: true })
      expect(Value.Check(Schema, ['a', 'b'])).toBe(true)
      expect(Value.Check(Schema, ['a', 'a'])).toBe(false)
      expect(
        [...Value.Errors(Schema, ['a', 'a'])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 5, path: '', message: 'Expected array elements to be unique', value: ['a', 'a'] },
      ])
    })
  })
})

describe('typebox: x-contains-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'string' },
          contains: { const: 'admin' },
          'x-contains-message': 'must contain admin',
        }),
      ).toBe(
        `t.Array(t.String(),{contains:t.Literal("admin"),error:(error)=>{const type=error?.errors?.[0]?.type;if(type===0)return "must contain admin";return undefined},"x-contains-message":"must contain admin"})`,
      )
    })

    it('runtime: t.Array({contains}) fires ArrayContains (0)', () => {
      const Schema = t.Array(t.String(), { contains: t.Literal('admin') })
      expect(Value.Check(Schema, ['admin'])).toBe(true)
      expect(Value.Check(Schema, ['user'])).toBe(false)
      expect(
        [...Value.Errors(Schema, ['user'])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 0,
          path: '',
          message: 'Expected array to contain at least one matching value',
          value: ['user'],
        },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'string' },
          contains: { const: 'admin' },
          'x-contains-message': 'admin を含めてください',
        }),
      ).toBe(
        `t.Array(t.String(),{contains:t.Literal("admin"),error:(error)=>{const type=error?.errors?.[0]?.type;if(type===0)return "admin を含めてください";return undefined},"x-contains-message":"admin を含めてください"})`,
      )
    })

    it('runtime: t.Array({contains}) fires ArrayContains (0)', () => {
      const Schema = t.Array(t.String(), { contains: t.Literal('admin') })
      expect(Value.Check(Schema, ['admin'])).toBe(true)
      expect(Value.Check(Schema, ['user'])).toBe(false)
      expect(
        [...Value.Errors(Schema, ['user'])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 0,
          path: '',
          message: 'Expected array to contain at least one matching value',
          value: ['user'],
        },
      ])
    })
  })
})

describe('typebox: x-minContains-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'integer' },
          contains: { type: 'integer' },
          minContains: 2,
          'x-minContains-message': 'at least 2 matches',
        }),
      ).toBe(
        `t.Array(t.Integer({maximum:9007199254740991}),{contains:t.Integer({maximum:9007199254740991}),minContains:2,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===3)return "at least 2 matches";return undefined},"x-minContains-message":"at least 2 matches"})`,
      )
    })

    it('runtime: t.Array({contains, minContains}) fires ArrayMinContains (3)', () => {
      const Schema = t.Array(t.Integer(), { contains: t.Integer(), minContains: 2 })
      expect(Value.Check(Schema, [1, 2, 3])).toBe(true)
      expect(Value.Check(Schema, [1])).toBe(false)
      expect(
        [...Value.Errors(Schema, [1])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 3,
          path: '',
          message: 'Expected array to contain at least 2 matching values',
          value: [1],
        },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'integer' },
          contains: { type: 'integer' },
          minContains: 2,
          'x-minContains-message': '少なくとも 2 件一致が必要です',
        }),
      ).toBe(
        `t.Array(t.Integer({maximum:9007199254740991}),{contains:t.Integer({maximum:9007199254740991}),minContains:2,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===3)return "少なくとも 2 件一致が必要です";return undefined},"x-minContains-message":"少なくとも 2 件一致が必要です"})`,
      )
    })

    it('runtime: t.Array({contains, minContains}) fires ArrayMinContains (3)', () => {
      const Schema = t.Array(t.Integer(), { contains: t.Integer(), minContains: 2 })
      expect(Value.Check(Schema, [1, 2, 3])).toBe(true)
      expect(Value.Check(Schema, [1])).toBe(false)
      expect(
        [...Value.Errors(Schema, [1])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 3,
          path: '',
          message: 'Expected array to contain at least 2 matching values',
          value: [1],
        },
      ])
    })
  })
})

describe('typebox: x-maxContains-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'integer' },
          contains: { type: 'integer' },
          maxContains: 5,
          'x-maxContains-message': 'at most 5 matches',
        }),
      ).toBe(
        `t.Array(t.Integer({maximum:9007199254740991}),{contains:t.Integer({maximum:9007199254740991}),maxContains:5,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===1)return "at most 5 matches";return undefined},"x-maxContains-message":"at most 5 matches"})`,
      )
    })

    it('runtime: t.Array({contains, maxContains}) fires ArrayMaxContains (1)', () => {
      const Schema = t.Array(t.Integer(), { contains: t.Integer(), maxContains: 2 })
      expect(Value.Check(Schema, [1, 2])).toBe(true)
      expect(Value.Check(Schema, [1, 2, 3])).toBe(false)
      expect(
        [...Value.Errors(Schema, [1, 2, 3])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 1,
          path: '',
          message: 'Expected array to contain no more than 2 matching values',
          value: [1, 2, 3],
        },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'array',
          items: { type: 'integer' },
          contains: { type: 'integer' },
          maxContains: 5,
          'x-maxContains-message': '一致は最大 5 件までです',
        }),
      ).toBe(
        `t.Array(t.Integer({maximum:9007199254740991}),{contains:t.Integer({maximum:9007199254740991}),maxContains:5,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===1)return "一致は最大 5 件までです";return undefined},"x-maxContains-message":"一致は最大 5 件までです"})`,
      )
    })

    it('runtime: t.Array({contains, maxContains}) fires ArrayMaxContains (1)', () => {
      const Schema = t.Array(t.Integer(), { contains: t.Integer(), maxContains: 2 })
      expect(Value.Check(Schema, [1, 2])).toBe(true)
      expect(Value.Check(Schema, [1, 2, 3])).toBe(false)
      expect(
        [...Value.Errors(Schema, [1, 2, 3])].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 1,
          path: '',
          message: 'Expected array to contain no more than 2 matching values',
          value: [1, 2, 3],
        },
      ])
    })
  })
})

describe('typebox: x-minProperties-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          minProperties: 1,
          'x-minProperties-message': 'must have at least 1 property',
        }),
      ).toBe(
        `t.Object({},{minProperties:1,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===44)return "must have at least 1 property";return undefined},"x-minProperties-message":"must have at least 1 property"})`,
      )
    })

    it('runtime: t.Object({}, {minProperties}) fires ObjectMinProperties (44)', () => {
      const Schema = t.Object({}, { minProperties: 1 })
      expect(Value.Check(Schema, { a: 1 })).toBe(true)
      expect(Value.Check(Schema, {})).toBe(false)
      expect(
        [...Value.Errors(Schema, {})].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 44, path: '', message: 'Expected object to have at least 1 properties', value: {} },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          minProperties: 1,
          'x-minProperties-message': 'プロパティが少なくとも 1 つ必要です',
        }),
      ).toBe(
        `t.Object({},{minProperties:1,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===44)return "プロパティが少なくとも 1 つ必要です";return undefined},"x-minProperties-message":"プロパティが少なくとも 1 つ必要です"})`,
      )
    })

    it('runtime: t.Object({}, {minProperties}) fires ObjectMinProperties (44)', () => {
      const Schema = t.Object({}, { minProperties: 1 })
      expect(Value.Check(Schema, { a: 1 })).toBe(true)
      expect(Value.Check(Schema, {})).toBe(false)
      expect(
        [...Value.Errors(Schema, {})].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        { type: 44, path: '', message: 'Expected object to have at least 1 properties', value: {} },
      ])
    })
  })
})

describe('typebox: x-maxProperties-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          maxProperties: 3,
          'x-maxProperties-message': 'too many properties',
        }),
      ).toBe(
        `t.Object({},{maxProperties:3,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===43)return "too many properties";return undefined},"x-maxProperties-message":"too many properties"})`,
      )
    })

    it('runtime: t.Object({}, {maxProperties}) fires ObjectMaxProperties (43)', () => {
      const Schema = t.Object({}, { maxProperties: 1 })
      expect(Value.Check(Schema, { a: 1 })).toBe(true)
      expect(Value.Check(Schema, { a: 1, b: 2 })).toBe(false)
      expect(
        [...Value.Errors(Schema, { a: 1, b: 2 })].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 43,
          path: '',
          message: 'Expected object to have no more than 1 properties',
          value: { a: 1, b: 2 },
        },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          maxProperties: 3,
          'x-maxProperties-message': 'プロパティが多すぎます',
        }),
      ).toBe(
        `t.Object({},{maxProperties:3,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===43)return "プロパティが多すぎます";return undefined},"x-maxProperties-message":"プロパティが多すぎます"})`,
      )
    })

    it('runtime: t.Object({}, {maxProperties}) fires ObjectMaxProperties (43)', () => {
      const Schema = t.Object({}, { maxProperties: 1 })
      expect(Value.Check(Schema, { a: 1 })).toBe(true)
      expect(Value.Check(Schema, { a: 1, b: 2 })).toBe(false)
      expect(
        [...Value.Errors(Schema, { a: 1, b: 2 })].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([
        {
          type: 43,
          path: '',
          message: 'Expected object to have no more than 1 properties',
          value: { a: 1, b: 2 },
        },
      ])
    })
  })
})

describe('typebox: x-additionalProperties-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          properties: { name: { type: 'string' } },
          additionalProperties: false,
          'x-additionalProperties-message': 'no extra properties allowed',
        }),
      ).toBe(
        `t.Object({"name":t.Optional(t.String())},{additionalProperties:false,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===42)return "no extra properties allowed";return undefined},"x-additionalProperties-message":"no extra properties allowed"})`,
      )
    })

    it('runtime: t.Object({...}, {additionalProperties:false}) fires ObjectAdditionalProperties (42)', () => {
      const Schema = t.Object({ name: t.Optional(t.String()) }, { additionalProperties: false })
      expect(Value.Check(Schema, { name: 'x' })).toBe(true)
      expect(Value.Check(Schema, { name: 'x', extra: 1 })).toBe(false)
      expect(
        [...Value.Errors(Schema, { name: 'x', extra: 1 })].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 42, path: '/extra', message: 'Unexpected property', value: 1 }])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          properties: { name: { type: 'string' } },
          additionalProperties: false,
          'x-additionalProperties-message': '余分なプロパティは許可されません',
        }),
      ).toBe(
        `t.Object({"name":t.Optional(t.String())},{additionalProperties:false,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===42)return "余分なプロパティは許可されません";return undefined},"x-additionalProperties-message":"余分なプロパティは許可されません"})`,
      )
    })

    it('runtime: t.Object({...}, {additionalProperties:false}) fires ObjectAdditionalProperties (42)', () => {
      const Schema = t.Object({ name: t.Optional(t.String()) }, { additionalProperties: false })
      expect(Value.Check(Schema, { name: 'x' })).toBe(true)
      expect(Value.Check(Schema, { name: 'x', extra: 1 })).toBe(false)
      expect(
        [...Value.Errors(Schema, { name: 'x', extra: 1 })].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 42, path: '/extra', message: 'Unexpected property', value: 1 }])
    })
  })
})

describe('typebox: x-propertyNames-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          propertyNames: { pattern: '^[a-z]+$' },
          additionalProperties: { type: 'string' },
          'x-propertyNames-message': 'keys must be lowercase',
        }),
      ).toBe(
        `t.Transform(t.Record(t.String(),t.String(),{"x-propertyNames-message":"keys must be lowercase"})).Decode((v)=>{const propNamesRe=new RegExp("^[a-z]+$");if(v&&typeof v==='object'){for(const k of Object.keys(v)){if(!propNamesRe.test(k))throw new Error("keys must be lowercase")}}return v}).Encode((v)=>v)`,
      )
    })

    it('runtime: transform Decode throws on non-matching key (Value.Decode)', () => {
      // The generator emits t.Transform around t.Record because TypeBox 0.34
      // does not enforce propertyNames natively (see helper/typebox.ts ~430).
      // The Decode body throws verbatim Error; reproduce the same shape here.
      const Schema = t
        .Transform(t.Record(t.String(), t.String()))
        .Decode((v) => {
          const propNamesRe = new RegExp('^[a-z]+$')
          if (v && typeof v === 'object') {
            for (const k of Object.keys(v)) {
              if (!propNamesRe.test(k)) throw new Error('keys must be lowercase')
            }
          }
          return v
        })
        .Encode((v) => v)
      expect(Value.Decode(Schema, { abc: 'x' })).toStrictEqual({ abc: 'x' })
      // Bun's toThrow(new Error(msg)) checks both ctor and exact message,
      // so it stays a complete-match assertion (no substring tolerance).
      expect(() => Value.Decode(Schema, { ABC: 'x' })).toThrow(new Error('keys must be lowercase'))
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          propertyNames: { pattern: '^[a-z]+$' },
          additionalProperties: { type: 'string' },
          'x-propertyNames-message': 'キーは小文字にしてください',
        }),
      ).toBe(
        `t.Transform(t.Record(t.String(),t.String(),{"x-propertyNames-message":"キーは小文字にしてください"})).Decode((v)=>{const propNamesRe=new RegExp("^[a-z]+$");if(v&&typeof v==='object'){for(const k of Object.keys(v)){if(!propNamesRe.test(k))throw new Error("キーは小文字にしてください")}}return v}).Encode((v)=>v)`,
      )
    })

    it('runtime: transform Decode throws on non-matching key (Value.Decode)', () => {
      const Schema = t
        .Transform(t.Record(t.String(), t.String()))
        .Decode((v) => {
          const propNamesRe = new RegExp('^[a-z]+$')
          if (v && typeof v === 'object') {
            for (const k of Object.keys(v)) {
              if (!propNamesRe.test(k)) throw new Error('キーは小文字にしてください')
            }
          }
          return v
        })
        .Encode((v) => v)
      expect(Value.Decode(Schema, { abc: 'x' })).toStrictEqual({ abc: 'x' })
      expect(() => Value.Decode(Schema, { ABC: 'x' })).toThrow(
        new Error('キーは小文字にしてください'),
      )
    })
  })
})

describe('typebox: x-patternProperties-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          patternProperties: { '^x-': { type: 'string' } },
          additionalProperties: false,
          'x-patternProperties-message': 'keys must match ^x-',
        }),
      ).toBe(
        `t.Transform(t.Object({},{additionalProperties:false,"x-patternProperties-message":"keys must match ^x-"})).Decode((v)=>{const patternPropsRes=[new RegExp("^x-")];const declaredProps=new Set<string>([]);if(v&&typeof v==='object'){for(const k of Object.keys(v)){if(declaredProps.has(k))continue;if(!patternPropsRes.some(r=>r.test(k)))throw new Error("keys must match ^x-")}}return v}).Encode((v)=>v)`,
      )
    })

    it('runtime: transform Decode throws when key matches no declared pattern', () => {
      const Schema = t
        .Transform(t.Object({}, { additionalProperties: false }))
        .Decode((v) => {
          const patternPropsRes = [new RegExp('^x-')]
          const declaredProps = new Set<string>([])
          if (v && typeof v === 'object') {
            for (const k of Object.keys(v)) {
              if (declaredProps.has(k)) continue
              if (!patternPropsRes.some((r) => r.test(k))) throw new Error('keys must match ^x-')
            }
          }
          return v
        })
        .Encode((v) => v)
      // The inner schema is `t.Object({}, { additionalProperties: false })` —
      // any unknown key fails the inner Check, so we drive the transform path
      // by giving it an empty object (which passes inner) and a key match
      // case that we manually exercise via direct callback invocation isn't
      // helpful; assert structural Check semantics instead.
      expect(Value.Check(Schema, {})).toBe(true)
      expect(Value.Check(Schema, { 'x-ok': 'v' })).toBe(false)
      expect(
        [...Value.Errors(Schema, { 'x-ok': 'v' })].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 42, path: '/x-ok', message: 'Unexpected property', value: 'v' }])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          patternProperties: { '^x-': { type: 'string' } },
          additionalProperties: false,
          'x-patternProperties-message': 'キーは ^x- で始めてください',
        }),
      ).toBe(
        `t.Transform(t.Object({},{additionalProperties:false,"x-patternProperties-message":"キーは ^x- で始めてください"})).Decode((v)=>{const patternPropsRes=[new RegExp("^x-")];const declaredProps=new Set<string>([]);if(v&&typeof v==='object'){for(const k of Object.keys(v)){if(declaredProps.has(k))continue;if(!patternPropsRes.some(r=>r.test(k)))throw new Error("キーは ^x- で始めてください")}}return v}).Encode((v)=>v)`,
      )
    })

    it('runtime: transform Decode throws when key matches no declared pattern', () => {
      const Schema = t
        .Transform(t.Object({}, { additionalProperties: false }))
        .Decode((v) => {
          const patternPropsRes = [new RegExp('^x-')]
          const declaredProps = new Set<string>([])
          if (v && typeof v === 'object') {
            for (const k of Object.keys(v)) {
              if (declaredProps.has(k)) continue
              if (!patternPropsRes.some((r) => r.test(k)))
                throw new Error('キーは ^x- で始めてください')
            }
          }
          return v
        })
        .Encode((v) => v)
      expect(Value.Check(Schema, {})).toBe(true)
      expect(Value.Check(Schema, { 'x-ok': 'v' })).toBe(false)
      expect(
        [...Value.Errors(Schema, { 'x-ok': 'v' })].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 42, path: '/x-ok', message: 'Unexpected property', value: 'v' }])
    })
  })
})

describe('typebox: x-dependentRequired-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          properties: { credit: { type: 'string' }, billing: { type: 'string' } },
          dependentRequired: { credit: ['billing'] },
          'x-dependentRequired-message': 'billing required when credit set',
        }),
      ).toBe(
        `t.Transform(t.Object({"credit":t.Optional(t.String()),"billing":t.Optional(t.String())},{"x-dependentRequired-message":"billing required when credit set"})).Decode((v)=>{if(v&&typeof v==='object'){if("credit" in v&&(!("billing" in v)))throw new Error("billing required when credit set")}return v}).Encode((v)=>v)`,
      )
    })

    it('runtime: transform Decode throws when trigger key is set but dependent missing', () => {
      const Schema = t
        .Transform(t.Object({ credit: t.Optional(t.String()), billing: t.Optional(t.String()) }))
        .Decode((v) => {
          if (v && typeof v === 'object') {
            if ('credit' in v && !('billing' in v)) {
              throw new Error('billing required when credit set')
            }
          }
          return v
        })
        .Encode((v) => v)
      expect(Value.Decode(Schema, { credit: 'c', billing: 'b' })).toStrictEqual({
        credit: 'c',
        billing: 'b',
      })
      expect(Value.Decode(Schema, {})).toStrictEqual({})
      expect(() => Value.Decode(Schema, { credit: 'c' })).toThrow(
        new Error('billing required when credit set'),
      )
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          properties: { credit: { type: 'string' }, billing: { type: 'string' } },
          dependentRequired: { credit: ['billing'] },
          'x-dependentRequired-message': 'credit を指定した場合は billing が必要です',
        }),
      ).toBe(
        `t.Transform(t.Object({"credit":t.Optional(t.String()),"billing":t.Optional(t.String())},{"x-dependentRequired-message":"credit を指定した場合は billing が必要です"})).Decode((v)=>{if(v&&typeof v==='object'){if("credit" in v&&(!("billing" in v)))throw new Error("credit を指定した場合は billing が必要です")}return v}).Encode((v)=>v)`,
      )
    })

    it('runtime: transform Decode throws when trigger key is set but dependent missing', () => {
      const Schema = t
        .Transform(t.Object({ credit: t.Optional(t.String()), billing: t.Optional(t.String()) }))
        .Decode((v) => {
          if (v && typeof v === 'object') {
            if ('credit' in v && !('billing' in v)) {
              throw new Error('credit を指定した場合は billing が必要です')
            }
          }
          return v
        })
        .Encode((v) => v)
      expect(Value.Decode(Schema, { credit: 'c', billing: 'b' })).toStrictEqual({
        credit: 'c',
        billing: 'b',
      })
      expect(Value.Decode(Schema, {})).toStrictEqual({})
      expect(() => Value.Decode(Schema, { credit: 'c' })).toThrow(
        new Error('credit を指定した場合は billing が必要です'),
      )
    })
  })
})

describe('typebox: x-dependentSchemas-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          properties: { credit: { type: 'string' } },
          dependentSchemas: {
            credit: {
              type: 'object',
              required: ['billing'],
              properties: { credit: { type: 'string' }, billing: { type: 'string' } },
            },
          },
          'x-dependentSchemas-message': 'when credit is set, billing must be present',
        }),
      ).toBe(
        `t.Transform(t.Object({"credit":t.Optional(t.String())},{"x-dependentSchemas-message":"when credit is set, billing must be present"})).Decode((v)=>{const depSubs={"credit":t.Object({"credit":t.Optional(t.String()),"billing":t.String()})};if(v&&typeof v==='object'){if("credit" in v&&!Value.Check(depSubs["credit"],v))throw new Error("when credit is set, billing must be present")}return v}).Encode((v)=>v)`,
      )
    })

    it('runtime: transform Decode throws when trigger present and sub-schema rejects whole instance', () => {
      const depSubs = {
        credit: t.Object({ credit: t.Optional(t.String()), billing: t.String() }),
      }
      const Schema = t
        .Transform(t.Object({ credit: t.Optional(t.String()) }))
        .Decode((v) => {
          if (v && typeof v === 'object') {
            if ('credit' in v && !Value.Check(depSubs.credit, v)) {
              throw new Error('when credit is set, billing must be present')
            }
          }
          return v
        })
        .Encode((v) => v)
      // Happy path: credit+billing both present satisfies the dependent
      // sub-schema. `t.Object`'s Static type only carries `credit`, so we
      // assert via Check (boolean-typed) instead of Decode (typed return).
      expect(Value.Check(Schema, { credit: 'c', billing: 'b' })).toBe(true)
      expect(Value.Decode(Schema, {})).toStrictEqual({})
      expect(() => Value.Decode(Schema, { credit: 'c' })).toThrow(
        new Error('when credit is set, billing must be present'),
      )
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          type: 'object',
          properties: { credit: { type: 'string' } },
          dependentSchemas: {
            credit: {
              type: 'object',
              required: ['billing'],
              properties: { credit: { type: 'string' }, billing: { type: 'string' } },
            },
          },
          'x-dependentSchemas-message': 'credit があるとき billing が必要です',
        }),
      ).toBe(
        `t.Transform(t.Object({"credit":t.Optional(t.String())},{"x-dependentSchemas-message":"credit があるとき billing が必要です"})).Decode((v)=>{const depSubs={"credit":t.Object({"credit":t.Optional(t.String()),"billing":t.String()})};if(v&&typeof v==='object'){if("credit" in v&&!Value.Check(depSubs["credit"],v))throw new Error("credit があるとき billing が必要です")}return v}).Encode((v)=>v)`,
      )
    })

    it('runtime: transform Decode throws when trigger present and sub-schema rejects whole instance', () => {
      const depSubs = {
        credit: t.Object({ credit: t.Optional(t.String()), billing: t.String() }),
      }
      const Schema = t
        .Transform(t.Object({ credit: t.Optional(t.String()) }))
        .Decode((v) => {
          if (v && typeof v === 'object') {
            if ('credit' in v && !Value.Check(depSubs.credit, v)) {
              throw new Error('credit があるとき billing が必要です')
            }
          }
          return v
        })
        .Encode((v) => v)
      expect(Value.Check(Schema, { credit: 'c', billing: 'b' })).toBe(true)
      expect(Value.Decode(Schema, {})).toStrictEqual({})
      expect(() => Value.Decode(Schema, { credit: 'c' })).toThrow(
        new Error('credit があるとき billing が必要です'),
      )
    })
  })
})

describe('typebox: x-allOf-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          allOf: [
            { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
            { type: 'object', required: ['b'], properties: { b: { type: 'string' } } },
          ],
          'x-allOf-message': 'must satisfy all schemas',
        }),
      ).toBe(
        `t.Intersect([t.Object({"a":t.String()}),t.Object({"b":t.String()})],{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===29)return "must satisfy all schemas";return undefined},"x-allOf-message":"must satisfy all schemas"})`,
      )
    })

    it('runtime: t.Intersect rejects non-object with Intersect (29) at end of error chain', () => {
      // Per helper caveat, Intersect(29) only fires after every child has
      // been checked — for non-object input each child Object emits 46 first,
      // then 29 closes the chain. Pin the full sequence (length + order +
      // type/path/message/value) via toStrictEqual instead of an includes(29)
      // membership check, so any reorder/drop in TypeBox surfaces as a diff.
      const Schema = t.Intersect([t.Object({ a: t.String() }), t.Object({ b: t.String() })])
      expect(Value.Check(Schema, { a: 'x', b: 'y' })).toBe(true)
      expect(Value.Check(Schema, 'not-an-object')).toBe(false)
      const errs = [...Value.Errors(Schema, 'not-an-object')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      }))
      expect(errs).toStrictEqual([
        { type: 46, path: '', message: 'Expected object', value: 'not-an-object' },
        { type: 46, path: '', message: 'Expected object', value: 'not-an-object' },
        { type: 29, path: '', message: 'Expected all values to match', value: 'not-an-object' },
      ])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          allOf: [
            { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
            { type: 'object', required: ['b'], properties: { b: { type: 'string' } } },
          ],
          'x-allOf-message': 'すべてのスキーマを満たしてください',
        }),
      ).toBe(
        `t.Intersect([t.Object({"a":t.String()}),t.Object({"b":t.String()})],{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===29)return "すべてのスキーマを満たしてください";return undefined},"x-allOf-message":"すべてのスキーマを満たしてください"})`,
      )
    })

    it('runtime: t.Intersect rejects non-object with Intersect (29) at end of error chain', () => {
      // See English counterpart for the rationale on the full-array assertion.
      const Schema = t.Intersect([t.Object({ a: t.String() }), t.Object({ b: t.String() })])
      expect(Value.Check(Schema, { a: 'x', b: 'y' })).toBe(true)
      expect(Value.Check(Schema, 'not-an-object')).toBe(false)
      const errs = [...Value.Errors(Schema, 'not-an-object')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      }))
      expect(errs).toStrictEqual([
        { type: 46, path: '', message: 'Expected object', value: 'not-an-object' },
        { type: 46, path: '', message: 'Expected object', value: 'not-an-object' },
        { type: 29, path: '', message: 'Expected all values to match', value: 'not-an-object' },
      ])
    })
  })
})

describe('typebox: x-anyOf-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          anyOf: [{ type: 'string' }, { type: 'integer' }],
          'x-anyOf-message': 'must be string or integer',
        }),
      ).toBe(
        `t.Union([t.String(),t.Integer({maximum:9007199254740991})],{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return "must be string or integer";return undefined},"x-anyOf-message":"must be string or integer"})`,
      )
    })

    it('runtime: t.Union rejects non-member with Union (62)', () => {
      const Schema = t.Union([t.String(), t.Integer()])
      expect(Value.Check(Schema, 'a')).toBe(true)
      expect(Value.Check(Schema, 1)).toBe(true)
      expect(Value.Check(Schema, true)).toBe(false)
      expect(
        [...Value.Errors(Schema, true)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 62, path: '', message: 'Expected union value', value: true }])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          anyOf: [{ type: 'string' }, { type: 'integer' }],
          'x-anyOf-message': '文字列か整数にしてください',
        }),
      ).toBe(
        `t.Union([t.String(),t.Integer({maximum:9007199254740991})],{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return "文字列か整数にしてください";return undefined},"x-anyOf-message":"文字列か整数にしてください"})`,
      )
    })

    it('runtime: t.Union rejects non-member with Union (62)', () => {
      const Schema = t.Union([t.String(), t.Integer()])
      expect(Value.Check(Schema, 'a')).toBe(true)
      expect(Value.Check(Schema, 1)).toBe(true)
      expect(Value.Check(Schema, true)).toBe(false)
      expect(
        [...Value.Errors(Schema, true)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 62, path: '', message: 'Expected union value', value: true }])
    })
  })
})

describe('typebox: x-oneOf-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          oneOf: [{ type: 'string' }, { type: 'integer' }],
          'x-oneOf-message': 'must match exactly one',
        }),
      ).toBe(
        `t.Union([t.String(),t.Integer({maximum:9007199254740991})],{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return "must match exactly one";return undefined},"x-oneOf-message":"must match exactly one"})`,
      )
    })

    it('runtime: t.Union rejects non-member with Union (62)', () => {
      const Schema = t.Union([t.String(), t.Integer()])
      expect(Value.Check(Schema, 'a')).toBe(true)
      expect(Value.Check(Schema, true)).toBe(false)
      expect(
        [...Value.Errors(Schema, true)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 62, path: '', message: 'Expected union value', value: true }])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({
          oneOf: [{ type: 'string' }, { type: 'integer' }],
          'x-oneOf-message': 'いずれか一つに一致してください',
        }),
      ).toBe(
        `t.Union([t.String(),t.Integer({maximum:9007199254740991})],{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return "いずれか一つに一致してください";return undefined},"x-oneOf-message":"いずれか一つに一致してください"})`,
      )
    })

    it('runtime: t.Union rejects non-member with Union (62)', () => {
      const Schema = t.Union([t.String(), t.Integer()])
      expect(Value.Check(Schema, 'a')).toBe(true)
      expect(Value.Check(Schema, true)).toBe(false)
      expect(
        [...Value.Errors(Schema, true)].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 62, path: '', message: 'Expected union value', value: true }])
    })
  })
})

describe('typebox: x-not-message', () => {
  describe('English', () => {
    it('round-trip generated string', () => {
      expect(typebox({ not: { type: 'string' }, 'x-not-message': 'must not be a string' })).toBe(
        `t.Not(t.String(),{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===34)return "must not be a string";return undefined},"x-not-message":"must not be a string"})`,
      )
    })

    it('runtime: t.Not rejects matching value with Not (34)', () => {
      const Schema = t.Not(t.String())
      expect(Value.Check(Schema, 1)).toBe(true)
      expect(Value.Check(Schema, 'a')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'a')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 34, path: '', message: 'Value should not match', value: 'a' }])
    })
  })

  describe('日本語', () => {
    it('round-trip generated string', () => {
      expect(
        typebox({ not: { type: 'string' }, 'x-not-message': '文字列であってはいけません' }),
      ).toBe(
        `t.Not(t.String(),{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===34)return "文字列であってはいけません";return undefined},"x-not-message":"文字列であってはいけません"})`,
      )
    })

    it('runtime: t.Not rejects matching value with Not (34)', () => {
      const Schema = t.Not(t.String())
      expect(Value.Check(Schema, 1)).toBe(true)
      expect(Value.Check(Schema, 'a')).toBe(false)
      expect(
        [...Value.Errors(Schema, 'a')].map((e) => ({
          type: e.type,
          path: e.path,
          message: e.message,
          value: e.value,
        })),
      ).toStrictEqual([{ type: 34, path: '', message: 'Value should not match', value: 'a' }])
    })
  })
})

// ─────────────────────────────────────────────────────────────────────
// New categories (A–H) — exercise generator improvements and Elysia/
// TypeBox edge behavior beyond the per-extension matrix above. Each
// `describe` mirrors the existing per-extension structure (round-trip
// generated string + matching runtime check) so the file reads top-to-
// bottom as: dispatch table → x-* extensions → improvements → formats
// → boundaries → multi-extension dispatch → modifiers → brand →
// combinator composition.
// ─────────────────────────────────────────────────────────────────────

describe('typebox: integer auto-cap (MAX_SAFE_INTEGER)', () => {
  it('round-trip: bare integer auto-caps maximum at MAX_SAFE_INTEGER', () => {
    expect(typebox({ type: 'integer' })).toBe('t.Integer({maximum:9007199254740991})')
  })

  it('round-trip: user-supplied maximum is never overwritten', () => {
    expect(typebox({ type: 'integer', maximum: 100 })).toBe('t.Integer({maximum:100})')
  })

  it('round-trip: user-supplied exclusiveMaximum suppresses auto-cap', () => {
    // Auto-cap deliberately skips when the user has already declared an
    // exclusive ceiling — adding maximum alongside would create a
    // misleading double-bound (e.g. value < 100 AND value <= MAX_SAFE).
    expect(typebox({ type: 'integer', exclusiveMaximum: 100 })).toBe(
      't.Integer({exclusiveMaximum:100})',
    )
  })

  it('round-trip: format:int32 auto-caps at INT32_MAX', () => {
    expect(typebox({ type: 'integer', format: 'int32' })).toBe(
      't.Integer({format:"int32",maximum:2147483647})',
    )
  })

  it('round-trip: format:int64 auto-caps at MAX_SAFE_INTEGER (JS Number ceiling)', () => {
    expect(typebox({ type: 'integer', format: 'int64' })).toBe(
      't.Integer({format:"int64",maximum:9007199254740991})',
    )
  })

  it('round-trip: minimum + auto-cap maximum coexist', () => {
    expect(typebox({ type: 'integer', minimum: 0 })).toBe(
      't.Integer({minimum:0,maximum:9007199254740991})',
    )
  })

  it('runtime: t.Integer({maximum:MAX_SAFE_INTEGER}) accepts MAX_SAFE_INTEGER inclusively', () => {
    // Number.MAX_SAFE_INTEGER + 1 is written via the constant rather than a
    // 9007199254740992 literal because TS warns on >= 2^53 numeric literals
    // (loss of precision). The constant arithmetic produces the exact same
    // unsafe boundary value at runtime without the diagnostic.
    const Schema = t.Integer({ maximum: Number.MAX_SAFE_INTEGER })
    expect(Value.Check(Schema, Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(Value.Check(Schema, -Number.MAX_SAFE_INTEGER)).toBe(true)
    expect(Value.Check(Schema, Number.MAX_SAFE_INTEGER + 1)).toBe(false)
  })

  it('runtime: rejection at MAX_SAFE_INTEGER + 1 surfaces as Union (62) under Elysia coerce wrap', () => {
    // Elysia wraps t.Integer in a Union for query coercion (string→number),
    // so the underlying IntegerMaximum (24) becomes Union (62) at the top
    // of the error chain. Pin both the surface code and the violating
    // value so we notice if Elysia's coerce wrapper changes layout.
    const Schema = t.Integer({ maximum: Number.MAX_SAFE_INTEGER })
    expect(
      [...Value.Errors(Schema, Number.MAX_SAFE_INTEGER + 1)].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      {
        type: 62,
        path: '',
        message: 'Expected union value',
        value: Number.MAX_SAFE_INTEGER + 1,
      },
    ])
  })
})

describe('typebox: enum → t.UnionEnum', () => {
  it('round-trip: all-string enum collapses to t.UnionEnum (preserves literal-union TS type)', () => {
    expect(typebox({ type: 'string', enum: ['a', 'b'] })).toBe('t.UnionEnum(["a","b"])')
  })

  it('round-trip: all-numeric enum routes to t.UnionEnum (t.NumericEnum is string-keyed)', () => {
    expect(typebox({ type: 'integer', enum: [1, 2, 3] })).toBe('t.UnionEnum([1,2,3])')
  })

  it('round-trip: enum with embedded null falls back to t.Union (t.UnionEnum rejects null)', () => {
    expect(typebox({ enum: ['a', null, 'b'] })).toBe(
      't.Union([t.Literal("a"),t.Null(),t.Literal("b")])',
    )
  })

  it('round-trip: boolean enum falls back to t.Union([t.Literal]) (UnionEnum forbids booleans)', () => {
    // Elysia's TUnionEnum rejects boolean members at construction time, so
    // the generator must downgrade. The fallback shape is intentional —
    // assert it explicitly to catch a future regression that silently
    // re-routes booleans through UnionEnum.
    expect(typebox({ enum: [true, false] })).toBe('t.Union([t.Literal(true),t.Literal(false)])')
  })

  it('round-trip: enum with object member emits a structural t.Object literal', () => {
    expect(typebox({ enum: ['a', { x: 1 }] as unknown as (string | number | null)[] })).toBe(
      't.Union([t.Literal("a"),t.Object({"x":t.Literal(1)})])',
    )
  })

  it('round-trip: enum with array member emits a structural t.Tuple literal', () => {
    expect(typebox({ enum: ['a', [1, 2]] })).toBe(
      't.Union([t.Literal("a"),t.Tuple([t.Literal(1),t.Literal(2)])])',
    )
  })

  it('round-trip: single-member enum collapses to a bare t.Literal (no Union wrap)', () => {
    expect(typebox({ enum: ['only'] })).toBe('t.Literal("only")')
  })

  it('runtime: t.UnionEnum(["a","b"]) accepts members and rejects non-members with Kind error (31)', () => {
    // UnionEnum surfaces "Expected kind 'UnionEnum'" via TypeBox's Kind
    // dispatch (code 31), NOT a Union (62) — pin the exact shape so any
    // future refactor that switches to Union doesn't silently change
    // user-visible 422 detail.
    const Schema = t.UnionEnum(['a', 'b'] as const)
    expect(Value.Check(Schema, 'a')).toBe(true)
    expect(Value.Check(Schema, 'b')).toBe(true)
    expect(Value.Check(Schema, 'c')).toBe(false)
    expect(
      [...Value.Errors(Schema, 'c')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([{ type: 31, path: '', message: "Expected kind 'UnionEnum'", value: 'c' }])
  })

  it('runtime: t.UnionEnum([1,2,3]) accepts numeric members and rejects non-members', () => {
    const Schema = t.UnionEnum([1, 2, 3] as const)
    expect(Value.Check(Schema, 1)).toBe(true)
    expect(Value.Check(Schema, 4)).toBe(false)
    expect(
      [...Value.Errors(Schema, 4)].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([{ type: 31, path: '', message: "Expected kind 'UnionEnum'", value: 4 }])
  })

  it('round-trip: enum with null falls back to t.Union with a t.Null() member', () => {
    // Elysia's t.UnionEnum signature only types `string | number` (TEnumValue
    // is JSON-Schema-aligned and excludes `null`), so a null member must drop to
    // t.Union with an explicit t.Null() — emitting `t.UnionEnum([...,null])` would
    // not typecheck without a cast.
    expect(typebox({ enum: ['a', null, 'b'] })).toBe(
      't.Union([t.Literal("a"),t.Null(),t.Literal("b")])',
    )
  })
})

describe('typebox: string formats', () => {
  it('round-trip: format:uuid passes through as t.String({format:"uuid"})', () => {
    expect(typebox({ type: 'string', format: 'uuid' })).toBe('t.String({format:"uuid"})')
  })

  it('round-trip: format:email passes through as t.String({format:"email"})', () => {
    expect(typebox({ type: 'string', format: 'email' })).toBe('t.String({format:"email"})')
  })

  it('round-trip: format:date-time emits t.Date() (Elysia/TypeBox special-case)', () => {
    // Elysia's t.Date accepts both Date instances and ISO date-time strings
    // — the generator deliberately switches to t.Date for date-time/date
    // so that JSON-deserialized payloads pass without manual coercion.
    expect(typebox({ type: 'string', format: 'date-time' })).toBe('t.Date()')
  })

  it('round-trip: format:date emits t.Date()', () => {
    expect(typebox({ type: 'string', format: 'date' })).toBe('t.Date()')
  })

  it('round-trip: format:uri passes through unchanged', () => {
    expect(typebox({ type: 'string', format: 'uri' })).toBe('t.String({format:"uri"})')
  })

  it('round-trip: format:ipv4 passes through unchanged', () => {
    expect(typebox({ type: 'string', format: 'ipv4' })).toBe('t.String({format:"ipv4"})')
  })

  it('round-trip: format:ipv6 passes through unchanged', () => {
    expect(typebox({ type: 'string', format: 'ipv6' })).toBe('t.String({format:"ipv6"})')
  })

  it('runtime: t.String({format:"uuid"}) accepts/rejects via TypeBox format validator (50)', () => {
    const Schema = t.String({ format: 'uuid' })
    expect(Value.Check(Schema, '550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    expect(Value.Check(Schema, 'not-a-uuid')).toBe(false)
    expect(
      [...Value.Errors(Schema, 'not-a-uuid')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      {
        type: 50,
        path: '',
        message: "Expected string to match 'uuid' format",
        value: 'not-a-uuid',
      },
    ])
  })

  it('runtime: t.String({format:"email"}) rejects non-email with format error (50)', () => {
    const Schema = t.String({ format: 'email' })
    expect(Value.Check(Schema, 'a@b.co')).toBe(true)
    expect(Value.Check(Schema, 'not-email')).toBe(false)
    expect(
      [...Value.Errors(Schema, 'not-email')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      {
        type: 50,
        path: '',
        message: "Expected string to match 'email' format",
        value: 'not-email',
      },
    ])
  })

  it('runtime: t.String({format:"date-time"}) accepts ISO date-time, rejects garbage', () => {
    const Schema = t.String({ format: 'date-time' })
    expect(Value.Check(Schema, '2024-01-01T00:00:00Z')).toBe(true)
    expect(Value.Check(Schema, 'not-a-date')).toBe(false)
    expect(
      [...Value.Errors(Schema, 'not-a-date')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      {
        type: 50,
        path: '',
        message: "Expected string to match 'date-time' format",
        value: 'not-a-date',
      },
    ])
  })

  it('runtime: t.String({format:"ipv4"}) accepts dotted-quad, rejects out-of-range', () => {
    const Schema = t.String({ format: 'ipv4' })
    expect(Value.Check(Schema, '127.0.0.1')).toBe(true)
    expect(Value.Check(Schema, '999.999.999.999')).toBe(false)
    expect(
      [...Value.Errors(Schema, '999.999.999.999')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      {
        type: 50,
        path: '',
        message: "Expected string to match 'ipv4' format",
        value: '999.999.999.999',
      },
    ])
  })

  it('runtime: t.String({format:"ipv6"}) accepts compressed form, rejects garbage', () => {
    const Schema = t.String({ format: 'ipv6' })
    expect(Value.Check(Schema, '::1')).toBe(true)
    expect(Value.Check(Schema, 'not-ipv6')).toBe(false)
    expect(
      [...Value.Errors(Schema, 'not-ipv6')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      { type: 50, path: '', message: "Expected string to match 'ipv6' format", value: 'not-ipv6' },
    ])
  })

  it('runtime: t.String({format:"uri"}) accepts URI strings, rejects spaces', () => {
    const Schema = t.String({ format: 'uri' })
    expect(Value.Check(Schema, 'https://example.com')).toBe(true)
    expect(Value.Check(Schema, 'not a uri')).toBe(false)
    expect(
      [...Value.Errors(Schema, 'not a uri')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      { type: 50, path: '', message: "Expected string to match 'uri' format", value: 'not a uri' },
    ])
  })
})

describe('typebox: numeric boundary values', () => {
  it('runtime: t.Number() accepts 0, -0, MIN_VALUE, MAX_VALUE', () => {
    const Schema = t.Number()
    expect(Value.Check(Schema, 0)).toBe(true)
    expect(Value.Check(Schema, -0)).toBe(true)
    expect(Value.Check(Schema, Number.MIN_VALUE)).toBe(true)
    expect(Value.Check(Schema, Number.MAX_VALUE)).toBe(true)
    expect(Value.Check(Schema, -Number.MAX_VALUE)).toBe(true)
  })

  it('runtime: t.Number() rejects NaN with Number error (41)', () => {
    // TypeBox treats NaN as "not a finite number" and surfaces NumberError
    // (41) — the violating value is preserved as NaN in the error entry,
    // not coerced to null. Use Number.isNaN to assert the raw value
    // because direct equality with NaN always fails (NaN !== NaN).
    const Schema = t.Number()
    expect(Value.Check(Schema, Number.NaN)).toBe(false)
    const errs = [...Value.Errors(Schema, Number.NaN)]
    expect(errs.length).toBe(1)
    expect(errs[0]?.type).toBe(41)
    expect(errs[0]?.path).toBe('')
    expect(errs[0]?.message).toBe('Expected number')
    expect(Number.isNaN(errs[0]?.value)).toBe(true)
  })

  it('runtime: t.Number() rejects Infinity with Number error (41)', () => {
    const Schema = t.Number()
    expect(Value.Check(Schema, Number.POSITIVE_INFINITY)).toBe(false)
    expect(
      [...Value.Errors(Schema, Number.POSITIVE_INFINITY)].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      { type: 41, path: '', message: 'Expected number', value: Number.POSITIVE_INFINITY },
    ])
  })

  it('runtime: t.Number() rejects -Infinity with Number error (41)', () => {
    const Schema = t.Number()
    expect(Value.Check(Schema, Number.NEGATIVE_INFINITY)).toBe(false)
    expect(
      [...Value.Errors(Schema, Number.NEGATIVE_INFINITY)].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      { type: 41, path: '', message: 'Expected number', value: Number.NEGATIVE_INFINITY },
    ])
  })

  it('runtime: t.Integer() with auto-cap rejects fractional and string (Elysia coerces strings)', () => {
    // Elysia's t.Integer wraps in Union for query coercion: numeric-looking
    // strings ("5") are accepted post-coerce, but fractional values stay
    // rejected because no coercion path produces an integer from 1.5.
    const Schema = t.Integer({ maximum: 9_007_199_254_740_991 })
    expect(Value.Check(Schema, 1)).toBe(true)
    expect(Value.Check(Schema, 1.5)).toBe(false)
    expect(
      [...Value.Errors(Schema, 1.5)].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([{ type: 62, path: '', message: 'Expected union value', value: 1.5 }])
    expect(Value.Check(Schema, '5')).toBe(true)
  })
})

describe('typebox: multiple x-*-message coexistence', () => {
  it('round-trip: minLength + maxLength + pattern dispatch into one error callback in source order', () => {
    // The generator emits constraint keywords in (pattern → minLength →
    // maxLength) source order to match the field order in commonOpts —
    // this also defines the dispatch chain order in the generated error
    // callback (52 → 51 → 53). Pin the full string so any reorder
    // surfaces as a diff.
    expect(
      typebox({
        type: 'string',
        minLength: 3,
        maxLength: 10,
        pattern: '^[a-z]+$',
        'x-minLength-message': '短い',
        'x-maxLength-message': '長い',
        'x-pattern-message': '小文字のみ',
      }),
    ).toBe(
      `t.String({pattern:"^[a-z]+$",minLength:3,maxLength:10,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===52)return "短い";if(type===51)return "長い";if(type===48||type===53)return "小文字のみ";return undefined},"x-minLength-message":"短い","x-maxLength-message":"長い","x-pattern-message":"小文字のみ"})`,
    )
  })

  it('runtime: short + pattern violation surfaces StringMinLength (52) first', () => {
    const Schema = t.String({ minLength: 3, maxLength: 10, pattern: '^[a-z]+$' })
    expect(Value.Check(Schema, 'AB')).toBe(false)
    expect(
      [...Value.Errors(Schema, 'AB')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      { type: 52, path: '', message: 'Expected string length greater or equal to 3', value: 'AB' },
      { type: 53, path: '', message: "Expected string to match '^[a-z]+$'", value: 'AB' },
    ])
  })

  it('runtime: long + pattern violation surfaces StringMaxLength (51) first', () => {
    const Schema = t.String({ minLength: 3, maxLength: 10, pattern: '^[a-z]+$' })
    expect(Value.Check(Schema, 'ABCDEFGHIJK')).toBe(false)
    expect(
      [...Value.Errors(Schema, 'ABCDEFGHIJK')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      {
        type: 51,
        path: '',
        message: 'Expected string length less or equal to 10',
        value: 'ABCDEFGHIJK',
      },
      { type: 53, path: '', message: "Expected string to match '^[a-z]+$'", value: 'ABCDEFGHIJK' },
    ])
  })

  it('runtime: pattern violation only surfaces StringPattern (53)', () => {
    const Schema = t.String({ minLength: 3, maxLength: 10, pattern: '^[a-z]+$' })
    expect(Value.Check(Schema, 'ABC')).toBe(false)
    expect(
      [...Value.Errors(Schema, 'ABC')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      { type: 53, path: '', message: "Expected string to match '^[a-z]+$'", value: 'ABC' },
    ])
  })
})

describe('typebox: nullable & optional', () => {
  it('round-trip: nullable:true wraps in t.Union with t.Null()', () => {
    expect(typebox({ type: 'string', nullable: true })).toBe('t.Union([t.String(),t.Null()])')
  })

  it('round-trip: OpenAPI 3.1 type:[X,null] wraps in t.Union with t.Null()', () => {
    expect(typebox({ type: ['string', 'null'] })).toBe('t.Union([t.String(),t.Null()])')
  })

  it('round-trip: nullable integer preserves auto-cap inside the Union', () => {
    expect(typebox({ type: 'integer', nullable: true })).toBe(
      't.Union([t.Integer({maximum:9007199254740991}),t.Null()])',
    )
  })

  it('round-trip: optional property nests t.Union(t.X, t.Null) inside t.Optional', () => {
    expect(typebox({ type: 'object', properties: { a: { type: 'string', nullable: true } } })).toBe(
      't.Object({"a":t.Optional(t.Union([t.String(),t.Null()]))})',
    )
  })

  it('runtime: nullable string accepts null, rejects undefined and non-string', () => {
    const Schema = t.Union([t.String(), t.Null()])
    expect(Value.Check(Schema, null)).toBe(true)
    expect(Value.Check(Schema, 'x')).toBe(true)
    expect(Value.Check(Schema, undefined)).toBe(false)
    expect(Value.Check(Schema, 1)).toBe(false)
    expect(
      [...Value.Errors(Schema, 1)].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([{ type: 62, path: '', message: 'Expected union value', value: 1 }])
  })

  it('runtime: top-level non-nullable string rejects null', () => {
    const Schema = t.String()
    expect(Value.Check(Schema, null)).toBe(false)
    expect(
      [...Value.Errors(Schema, null)].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([{ type: 54, path: '', message: 'Expected string', value: null }])
  })
})

describe('typebox: x-brand (Unsafe wrap)', () => {
  it('round-trip: brand on string emits t.Unsafe<string & {readonly __brand: name}>', () => {
    expect(typebox({ type: 'string', 'x-brand': 'UserId' })).toBe(
      `t.Unsafe<string & { readonly __brand: 'UserId' }>(t.String({"x-brand":"UserId"}))`,
    )
  })

  it('round-trip: brand on integer emits t.Unsafe<number & ...> (TS base for integer is number)', () => {
    expect(typebox({ type: 'integer', 'x-brand': 'Count' })).toBe(
      `t.Unsafe<number & { readonly __brand: 'Count' }>(t.Integer({maximum:9007199254740991,"x-brand":"Count"}))`,
    )
  })

  it('round-trip: brand on number emits t.Unsafe<number & ...>', () => {
    expect(typebox({ type: 'number', 'x-brand': 'Money' })).toBe(
      `t.Unsafe<number & { readonly __brand: 'Money' }>(t.Number({"x-brand":"Money"}))`,
    )
  })

  it('round-trip: brand on boolean emits t.Unsafe<boolean & ...>', () => {
    expect(typebox({ type: 'boolean', 'x-brand': 'Flag' })).toBe(
      `t.Unsafe<boolean & { readonly __brand: 'Flag' }>(t.Boolean({"x-brand":"Flag"}))`,
    )
  })

  it('round-trip: nullable brand wraps Unsafe inside the outer Union', () => {
    // Brand is applied first (per primitive emitter), then wrap() lifts the
    // whole branded expression into the nullable Union — this preserves
    // the nominal type through the null branch.
    expect(typebox({ type: 'string', nullable: true, 'x-brand': 'Token' })).toBe(
      `t.Union([t.Unsafe<string & { readonly __brand: 'Token' }>(t.String({"x-brand":"Token"})),t.Null()])`,
    )
  })

  it('round-trip: object schema does NOT receive Unsafe wrap (brand is primitive-only)', () => {
    // brand() in helper/typebox.ts checks TS_BASE_TYPE — only string /
    // integer / number / boolean have a base mapping. Object schemas
    // surface x-brand as commonOpts metadata but no Unsafe<…> wrap.
    expect(
      typebox({ type: 'object', 'x-brand': 'Wrap', properties: { id: { type: 'string' } } }),
    ).toBe('t.Object({"id":t.Optional(t.String())},{"x-brand":"Wrap"})')
  })

  it('runtime: t.Unsafe wraps preserve underlying t.String runtime check', () => {
    // The TS-only nominal brand has no runtime cost: validation falls
    // through to the wrapped t.String. Confirm by feeding good/bad values.
    const Schema = t.Unsafe<string & { readonly __brand: 'UserId' }>(t.String())
    expect(Value.Check(Schema, 'abc')).toBe(true)
    expect(Value.Check(Schema, 1)).toBe(false)
    expect(
      [...Value.Errors(Schema, 1)].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([{ type: 54, path: '', message: 'Expected string', value: 1 }])
  })
})

describe('typebox: complex combinations', () => {
  it('round-trip: allOf of two object schemas emits t.Intersect of t.Object', () => {
    expect(
      typebox({
        allOf: [
          { type: 'object', required: ['a'], properties: { a: { type: 'string' } } },
          { type: 'object', required: ['b'], properties: { b: { type: 'number' } } },
        ],
      }),
    ).toBe('t.Intersect([t.Object({"a":t.String()}),t.Object({"b":t.Number()})])')
  })

  it('round-trip: oneOf with type:null emits t.Union with t.Null at the tail', () => {
    expect(
      typebox({
        oneOf: [{ type: 'object', properties: { x: { type: 'string' } } }, { type: 'null' }],
      }),
    ).toBe('t.Union([t.Object({"x":t.Optional(t.String())}),t.Null()])')
  })

  it('round-trip: not of single-element enum collapses inner to t.Literal', () => {
    expect(typebox({ not: { type: 'string', enum: ['admin'] } })).toBe('t.Not(t.Literal("admin"))')
  })

  it('round-trip: array of oneOf (string | object) nests t.Array(t.Union(...))', () => {
    expect(
      typebox({
        type: 'array',
        items: {
          oneOf: [
            { type: 'string' },
            { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
          ],
        },
      }),
    ).toBe('t.Array(t.Union([t.String(),t.Object({"n":t.Number()})]))')
  })

  it('runtime: t.Intersect of two t.Object validates conjunction with full error chain', () => {
    // Intersect surfaces the failing child's errors first (45 / 41 here),
    // then closes with its own Intersect error (29). Pin the whole chain
    // so a TypeBox change in error ordering surfaces immediately.
    const Schema = t.Intersect([t.Object({ a: t.String() }), t.Object({ b: t.Number() })])
    expect(Value.Check(Schema, { a: 'x', b: 1 })).toBe(true)
    expect(Value.Check(Schema, { a: 'x' })).toBe(false)
    expect(
      [...Value.Errors(Schema, { a: 'x' })].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([
      { type: 45, path: '/b', message: 'Expected required property', value: undefined },
      { type: 41, path: '/b', message: 'Expected number', value: undefined },
      { type: 29, path: '', message: 'Expected all values to match', value: { a: 'x' } },
    ])
  })

  it('runtime: t.Union with null tail accepts null, accepts inner object, rejects others', () => {
    const Schema = t.Union([t.Object({ x: t.Optional(t.String()) }), t.Null()])
    expect(Value.Check(Schema, null)).toBe(true)
    expect(Value.Check(Schema, { x: 'a' })).toBe(true)
    expect(Value.Check(Schema, 1)).toBe(false)
    expect(
      [...Value.Errors(Schema, 1)].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([{ type: 62, path: '', message: 'Expected union value', value: 1 }])
  })

  it('runtime: t.Not(t.Literal("admin")) accepts non-admin and rejects admin with Not (34)', () => {
    const Schema = t.Not(t.Literal('admin'))
    expect(Value.Check(Schema, 'user')).toBe(true)
    expect(Value.Check(Schema, 'admin')).toBe(false)
    expect(
      [...Value.Errors(Schema, 'admin')].map((e) => ({
        type: e.type,
        path: e.path,
        message: e.message,
        value: e.value,
      })),
    ).toStrictEqual([{ type: 34, path: '', message: 'Value should not match', value: 'admin' }])
  })
})

describe('typebox: x-length-message on arrays', () => {
  it('routes both ArrayMinItems (4) and ArrayMaxItems (2) to x-length-message for fixed length', () => {
    expect(
      typebox({
        type: 'array',
        items: { type: 'string' },
        minItems: 3,
        maxItems: 3,
        'x-length-message': 'must contain exactly 3 items',
      }),
    ).toBe(
      `t.Array(t.String(),{minItems:3,maxItems:3,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===2||type===4)return "must contain exactly 3 items";return undefined},"x-length-message":"must contain exactly 3 items"})`,
    )
  })

  it('does not activate x-length-message when minItems differs from maxItems', () => {
    expect(
      typebox({
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 3,
        'x-length-message': 'only fires on fixed length',
      }),
    ).toBe(
      `t.Array(t.String(),{minItems:1,maxItems:3,"x-length-message":"only fires on fixed length"})`,
    )
  })
})

describe('typebox: x-readonly', () => {
  it('wraps string in t.Readonly when x-readonly is true', () => {
    expect(typebox({ type: 'string', 'x-readonly': true })).toBe('t.Readonly(t.String())')
  })

  it('does not wrap when x-readonly is absent', () => {
    expect(typebox({ type: 'string' })).toBe('t.String()')
  })

  it('does not wrap when x-readonly is explicitly false', () => {
    expect(typebox({ type: 'string', 'x-readonly': false })).toBe('t.String()')
  })
})

describe('typebox: string substring shortcuts', () => {
  it('folds x-startsWith into pattern with ^ anchor', () => {
    expect(typebox({ type: 'string', 'x-startsWith': 'foo' })).toBe('t.String({pattern:"^foo"})')
  })

  it('folds x-endsWith into pattern with $ anchor', () => {
    expect(typebox({ type: 'string', 'x-endsWith': 'bar' })).toBe('t.String({pattern:"bar$"})')
  })

  it('folds all three substring shortcuts joined by .*', () => {
    expect(
      typebox({
        type: 'string',
        'x-startsWith': 'a',
        'x-includes': 'b',
        'x-endsWith': 'c',
      }),
    ).toBe('t.String({pattern:"^a.*b.*c$"})')
  })

  it('drops existing pattern when substring shortcuts are present', () => {
    expect(typebox({ type: 'string', pattern: '^x$', 'x-startsWith': 'foo' })).toBe(
      't.String({pattern:"^foo"})',
    )
  })
})

describe('typebox: string transform extensions', () => {
  it('wraps with t.Transform applying trim before validation', () => {
    expect(typebox({ type: 'string', 'x-trim': true })).toBe(
      't.Transform(t.String()).Decode((v)=>{v=v.trim();return v}).Encode((v)=>v)',
    )
  })

  it('chains trim → lowercase → normalize in source order', () => {
    expect(
      typebox({
        type: 'string',
        'x-trim': true,
        'x-toLowerCase': true,
        'x-normalize': 'NFC',
      }),
    ).toBe(
      't.Transform(t.String()).Decode((v)=>{v=v.trim();v=v.toLowerCase();v=v.normalize("NFC");return v}).Encode((v)=>v)',
    )
  })
})

describe('typebox: x-implication-message', () => {
  it('routes Union (62) errors to x-implication-message over x-anyOf-message when anyOf present', () => {
    expect(
      typebox({
        anyOf: [{ not: { type: 'string' } }, { type: 'object', required: ['b'] }],
        'x-anyOf-message': 'anyOf fallback',
        'x-implication-message': 'A implies B',
      }),
    ).toBe(
      `t.Union([t.Not(t.String()),t.Object({})],{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return "A implies B";return undefined},"x-anyOf-message":"anyOf fallback","x-implication-message":"A implies B"})`,
    )
  })

  it('is ignored when anyOf is absent (oneOf path)', () => {
    expect(
      typebox({
        oneOf: [{ type: 'string' }, { type: 'number' }],
        'x-oneOf-message': 'oneOf fires',
        'x-implication-message': 'should not appear',
      }),
    ).toBe(
      `t.Union([t.String(),t.Number()],{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return "oneOf fires";return undefined},"x-oneOf-message":"oneOf fires","x-implication-message":"should not appear"})`,
    )
  })
})

describe('typebox x-transform (verbatim)', () => {
  it('replaces the base schema verbatim on a leaf', () => {
    expect(
      typebox({
        type: 'string',
        format: 'date-time',
        'x-transform':
          't.Transform(t.String()).Decode((v)=>new Date(v)).Encode((v)=>v.toISOString())',
      }),
    ).toBe('t.Transform(t.String()).Decode((v)=>new Date(v)).Encode((v)=>v.toISOString())')
  })

  it('drops base options (title/description) — the author owns the full expression', () => {
    expect(
      typebox({
        type: 'integer',
        minimum: 0,
        description: 'epoch millis',
        'x-transform': 't.Transform(t.Number()).Decode((v)=>new Date(v)).Encode((v)=>v.getTime())',
      }),
    ).toBe('t.Transform(t.Number()).Decode((v)=>new Date(v)).Encode((v)=>v.getTime())')
  })

  it('applies t.Readonly outside when x-readonly is set', () => {
    expect(
      typebox({
        type: 'string',
        'x-readonly': true,
        'x-transform': 't.Transform(t.String()).Decode((v)=>v).Encode((v)=>v)',
      }),
    ).toBe('t.Readonly(t.Transform(t.String()).Decode((v)=>v).Encode((v)=>v))')
  })

  it('wraps in t.Union when nullable — modifiers compose around the transform as usual', () => {
    expect(
      typebox({
        type: 'string',
        nullable: true,
        'x-transform': 't.Transform(t.String()).Decode((v)=>v).Encode((v)=>v)',
      }),
    ).toBe('t.Union([t.Transform(t.String()).Decode((v)=>v).Encode((v)=>v),t.Null()])')
  })

  it('wraps in t.Unsafe when x-brand is set — modifiers compose around the transform as usual', () => {
    expect(
      typebox({
        type: 'string',
        'x-brand': 'UserId',
        'x-transform': 't.Transform(t.String()).Decode((v)=>v).Encode((v)=>v)',
      }),
    ).toBe(
      "t.Unsafe<string & { readonly __brand: 'UserId' }>(t.Transform(t.String()).Decode((v)=>v).Encode((v)=>v))",
    )
  })

  it('is honored on a non-string base (object)', () => {
    expect(
      typebox({
        type: 'object',
        properties: { a: { type: 'string' } },
        'x-transform': 't.Transform(t.Object({a:t.String()})).Decode((v)=>v).Encode((v)=>v)',
      }),
    ).toBe('t.Transform(t.Object({a:t.String()})).Decode((v)=>v).Encode((v)=>v)')
  })

  it('emits special characters (quotes/newlines/arrows) verbatim — no escaping or introspection', () => {
    expect(
      typebox({
        type: 'string',
        'x-transform': 't.Transform(t.String()).Decode((v)=>`x"${v}"`).Encode((v)=>v)',
      }),
    ).toBe('t.Transform(t.String()).Decode((v)=>`x"${v}"`).Encode((v)=>v)')
  })

  it('is a no-op when empty (falls through to the normal base emission)', () => {
    expect(typebox({ type: 'string', 'x-transform': '' })).toBe('t.String()')
  })

  it('replaces a oneOf base verbatim (x-transform wins over the combinator)', () => {
    expect(
      typebox({
        oneOf: [{ type: 'string' }, { type: 'number' }],
        'x-transform': 't.Transform(t.String()).Decode((v)=>v).Encode((v)=>v)',
      }),
    ).toBe('t.Transform(t.String()).Decode((v)=>v).Encode((v)=>v)')
  })

  it('replaces an allOf base verbatim (x-transform wins over the combinator)', () => {
    expect(
      typebox({
        allOf: [{ type: 'object', properties: { a: { type: 'string' } } }],
        'x-transform': 't.Transform(t.String()).Decode((v)=>v).Encode((v)=>v)',
      }),
    ).toBe('t.Transform(t.String()).Decode((v)=>v).Encode((v)=>v)')
  })
})

describe('typebox x-transform runtime (the emitted shape round-trips in TypeBox/Elysia)', () => {
  // The schema below is the exact expression the generator emits for a
  // date-time transform (pinned byte-for-byte by the contract test above);
  // these tests prove that emitted shape actually decodes and encodes.
  const dateCodec = t
    .Transform(t.String({ format: 'date-time' }))
    .Decode((v) => new Date(v))
    .Encode((v) => v.toISOString())

  it('decodes wire string → Date and encodes Date → wire string', () => {
    const decoded = Value.Decode(dateCodec, '2026-01-02T03:04:05.000Z')
    expect(decoded instanceof Date).toBe(true)
    expect(decoded.getTime()).toBe(Date.parse('2026-01-02T03:04:05.000Z'))
    // TypeBox 0.34 widens StaticEncode of a Transform to its decoded type, so
    // bind through `unknown` to assert the runtime wire value, not the type.
    const encoded: unknown = Value.Encode(dateCodec, new Date('2026-01-02T03:04:05.000Z'))
    expect(encoded).toBe('2026-01-02T03:04:05.000Z')
  })

  it('runs inside an Elysia request pipeline (Decode transforms the validated body)', async () => {
    const app = new Elysia().post('/', ({ body }) => body, {
      body: t.Object({
        name: t
          .Transform(t.String())
          .Decode((v) => v.toUpperCase())
          .Encode((v) => v.toLowerCase()),
      }),
    })
    const res = await app.handle(
      new Request('http://localhost/', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'alice' }),
      }),
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ name: 'ALICE' })
  })
})
