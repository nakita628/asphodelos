import { describe, expect, it } from 'bun:test'

import { object } from './object.js'

describe('object', () => {
  it('emits empty object', () => {
    expect(object({ type: 'object' })).toBe('t.Object({})')
  })

  it('emits object with required scalar property', () => {
    expect(
      object({
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
      }),
    ).toBe('t.Object({"name":t.String()})')
  })

  it('wraps non-required properties in t.Optional', () => {
    expect(
      object({
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' }, age: { type: 'integer' } },
      }),
    ).toBe('t.Object({"name":t.String(),"age":t.Optional(t.Integer({maximum:9007199254740991}))})')
  })

  it('does NOT wrap default-bearing optional in double Optional', () => {
    expect(
      object({
        type: 'object',
        required: [],
        properties: { completed: { type: 'boolean', default: false } },
      }),
    ).toBe('t.Object({"completed":t.Optional(t.Boolean({default:false}))})')
  })

  it('emits t.Record when no properties and additionalProperties is a schema', () => {
    expect(
      object({
        type: 'object',
        additionalProperties: { type: 'integer' },
      }),
    ).toBe('t.Record(t.String(),t.Integer({maximum:9007199254740991}))')
  })

  // ─── Edge cases ────────────────────────────────────────────────────────

  it('additionalProperties=false with properties → emits the false flag', () => {
    expect(
      object({
        type: 'object',
        required: ['name'],
        properties: { name: { type: 'string' } },
        additionalProperties: false,
      }),
    ).toBe('t.Object({"name":t.String()},{additionalProperties:false})')
  })

  it('additionalProperties=true is ignored (default Elysia behavior)', () => {
    // `additionalProperties: true` matches typebox default — no opts emitted.
    expect(
      object({
        type: 'object',
        required: [],
        properties: { name: { type: 'string' } },
        additionalProperties: true,
      }),
    ).toBe('t.Object({"name":t.Optional(t.String())})')
  })

  it('types the undeclared keys by an additionalProperties schema beside the declared properties', () => {
    // TypeBox takes a schema as `additionalProperties`: the declared keys keep their own types and
    // every other key is held to this one.
    expect(
      object({
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
        additionalProperties: { type: 'integer' },
      }),
    ).toBe(
      't.Object({"id":t.String()},{additionalProperties:t.Integer({maximum:9007199254740991})})',
    )
  })

  it('reads an additionalProperties schema in a form body like the declared properties', () => {
    expect(
      object(
        {
          type: 'object',
          properties: { id: { type: 'string' } },
          additionalProperties: { type: 'boolean' },
        },
        { mediaType: 'application/x-www-form-urlencoded' },
      ),
    ).toBe('t.Object({"id":t.Optional(t.String())},{additionalProperties:t.BooleanString()})')
  })

  it('required entry without a matching property is silently ignored (no ghost prop)', () => {
    // `required: ['ghost']` references a key absent from `properties`.
    // The current generator iterates `properties` only, so the ghost name
    // never appears in the emitted body — there is no synthesized
    // `t.Unknown()` or error. Pinned so a future "warn on dangling
    // required" change is intentional.
    expect(object({ type: 'object', required: ['ghost'] })).toBe('t.Object({})')
  })

  it('emits t.Record with extra opts (minProperties etc.) when present', () => {
    expect(
      object({
        type: 'object',
        additionalProperties: { type: 'string' },
        description: 'a map',
      }),
    ).toBe('t.Record(t.String(),t.String(),{description:"a map"})')
  })

  it('preserves description on t.Object', () => {
    expect(
      object({
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string' } },
        description: 'user',
      }),
    ).toBe('t.Object({"id":t.String()},{description:"user"})')
  })

  it('emits minProperties / maxProperties bounds', () => {
    expect(
      object({
        type: 'object',
        required: [],
        properties: { x: { type: 'string' } },
        minProperties: 1,
        maxProperties: 5,
      }),
    ).toBe('t.Object({"x":t.Optional(t.String())},{minProperties:1,maxProperties:5})')
  })

  it('handles property name with reserved JS keyword', () => {
    expect(
      object({
        type: 'object',
        required: ['class', 'default'],
        properties: { class: { type: 'string' }, default: { type: 'integer' } },
      }),
    ).toBe('t.Object({"class":t.String(),"default":t.Integer({maximum:9007199254740991})})')
  })

  it('handles property name with hyphen / dot / colon', () => {
    expect(
      object({
        type: 'object',
        required: ['x-rate-limit', 'pet.name', 'a:b'],
        properties: {
          'x-rate-limit': { type: 'integer' },
          'pet.name': { type: 'string' },
          'a:b': { type: 'boolean' },
        },
      }),
    ).toBe(
      't.Object({"x-rate-limit":t.Integer({maximum:9007199254740991}),"pet.name":t.String(),"a:b":t.Boolean()})',
    )
  })

  it('every property is optional when required is omitted entirely', () => {
    expect(
      object({
        type: 'object',
        properties: { a: { type: 'string' }, b: { type: 'integer' } },
      }),
    ).toBe(
      't.Object({"a":t.Optional(t.String()),"b":t.Optional(t.Integer({maximum:9007199254740991}))})',
    )
  })

  // `t.Readonly(...)` is the TypeBox-level modifier (affects the inferred TS
  // type). The inner `{readOnly:true}` is the JSON Schema annotation that
  // commonOpts always passes through — both are intentional and not
  // redundant from the OpenAPI emission point of view.
  it('per-property `readOnly: true` becomes t.Readonly when required', () => {
    expect(
      object({
        type: 'object',
        required: ['id'],
        properties: { id: { type: 'string', readOnly: true } },
      }),
    ).toBe('t.Object({"id":t.Readonly(t.String({readOnly:true}))})')
  })

  it('per-property `readOnly: true` becomes t.ReadonlyOptional when not required', () => {
    expect(
      object({
        type: 'object',
        properties: { name: { type: 'string', readOnly: true } },
      }),
    ).toBe('t.Object({"name":t.ReadonlyOptional(t.String({readOnly:true}))})')
  })

  it('per-property `readOnly` mixes correctly with non-readOnly siblings', () => {
    expect(
      object({
        type: 'object',
        required: ['id', 'name'],
        properties: {
          id: { type: 'string', readOnly: true },
          name: { type: 'string' },
        },
      }),
    ).toBe('t.Object({"id":t.Readonly(t.String({readOnly:true})),"name":t.String()})')
  })

  // The properties of a parameter container arrive as text and are marked so; an object nested in
  // one is a single JSON document whose own properties are typed, and are left alone.
  it('reads the properties of a parameter container from text, but not those of a nested object', () => {
    expect(
      object(
        {
          type: 'object',
          properties: {
            level: { type: 'integer', enum: [1, 2] },
            deep: { type: 'object', properties: { level: { type: 'integer', enum: [1, 2] } } },
          },
        },
        { parameterLocation: 'query' },
      ),
    ).toBe(
      '{"level":t.Optional(t.Transform(t.Union([t.Union([t.Literal("1"),t.Literal("2")]),t.UnionEnum([1,2],{default:undefined})])).Decode((v):1|2=>(typeof v===\'string\'?JSON.parse(v):v)).Encode((v)=>v)),"deep":t.Optional(t.ObjectString({"level":t.Optional(t.UnionEnum([1,2],{default:undefined}))}))}'
        .replace('{"level"', 't.Object({"level"')
        .replace(/\}$/u, '})'),
    )
  })

  it('reads an array header from one value, and a JSON-declared parameter as one document', () => {
    expect(
      object(
        {
          type: 'object',
          properties: {
            'x-ids': { type: 'array', items: { type: 'integer' } },
            'x-filter': { type: 'object', properties: { tag: { type: 'string' } } },
            'x-list': { type: 'array', items: { type: 'string' } },
          },
        },
        { parameterLocation: 'header', jsonProperties: ['x-filter', 'x-list'] },
      ),
    ).toBe(
      't.Object({"x-ids":t.Optional(t.ArrayQuery(t.Integer({maximum:9007199254740991}))),"x-filter":t.Optional(t.ObjectString({"tag":t.Optional(t.String())})),"x-list":t.Optional(t.ArrayString(t.String()))})',
    )
  })

  it('emits t.Form({...}) when called with multipart/form-data media-type ctx', () => {
    // multipart bodies require Elysia's `t.Form` factory so FormData→Object
    // coerce kicks in. The ctx is supplied by helper/schema.ts when the
    // operation's requestBody picks the `multipart/form-data` content entry.
    expect(
      object(
        {
          type: 'object',
          required: ['file'],
          properties: { file: { type: 'string', format: 'binary' } },
        },
        { mediaType: 'multipart/form-data' },
      ),
    ).toBe('t.Form({"file":t.File()})')
  })

  it('emits t.ObjectString({...}) when called with elysiaKind: object-string ctx', () => {
    // in:query parameters whose schema is `type: object` must coerce
    // through `t.ObjectString({...})` — without it the query value stays
    // a raw JSON string and the inner shape is never validated.
    expect(
      object(
        {
          type: 'object',
          required: ['filter'],
          properties: { filter: { type: 'string' } },
        },
        { elysiaKind: 'object-string' },
      ),
    ).toBe('t.ObjectString({"filter":t.String()})')
  })

  it('emits t.Cookie({...}) when called with elysiaKind: cookie ctx', () => {
    // Per-route cookie container becomes Elysia's typed-cookie factory.
    // No `secrets` option is added — signed cookies are an app-level
    // concern.
    expect(
      object(
        {
          type: 'object',
          required: ['session'],
          properties: { session: { type: 'string' } },
        },
        { elysiaKind: 'cookie' },
      ),
    ).toBe('t.Cookie({"session":t.String()})')
  })

  it('emits t.ObjectString for type:object property when parent ctx is parameterLocation:query', () => {
    // The synthesized query container itself stays a plain t.Object, but
    // each `type:object` property under it is emitted as t.ObjectString —
    // the rule the `makeParamsSchema` -> `bodyInfo` call sites encode
    // without stamping the schema.
    expect(
      object(
        {
          type: 'object',
          properties: {
            filter: { type: 'object', properties: { kind: { type: 'string' } } },
            other: { type: 'string' },
          },
        },
        { parameterLocation: 'query' },
      ),
    ).toBe(
      't.Object({"filter":t.Optional(t.ObjectString({"kind":t.Optional(t.String())})),"other":t.Optional(t.String())})',
    )
  })

  it('emits per-constraint error callback for x-minProperties-message + minProperties (ObjectMinProperties)', () => {
    expect(
      object({
        type: 'object',
        required: [],
        properties: { x: { type: 'string' } },
        minProperties: 1,
        'x-minProperties-message': 'need at least one prop',
      }),
    ).toBe(
      't.Object({"x":t.Optional(t.String())},{minProperties:1,error:(error)=>{const type=error?.errors?.[0]?.type;if(type===44)return "need at least one prop";return undefined},"x-minProperties-message":"need at least one prop"})',
    )
  })
})
