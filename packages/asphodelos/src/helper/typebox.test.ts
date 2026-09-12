import { describe, expect, it } from 'bun:test'

import {
  brand,
  commonOpts,
  enumErrorCallback,
  errorCallback,
  readonly,
  options,
  stringPatternFrom,
  stringTransformWrap,
  transformWrap,
  wrap,
} from './typebox.js'

describe('commonOpts', () => {
  it('returns empty option string for plain schema', () => {
    expect(options(commonOpts({ type: 'string' }))).toBe('')
  })

  it('preserves description / default / title', () => {
    expect(
      options(
        commonOpts({
          type: 'string',
          description: 'd',
          default: 'x',
          title: 't',
        }),
      ),
    ).toBe('{title:"t",description:"d",default:"x"}')
  })

  it('preserves readOnly / writeOnly / deprecated in Schema-type-defined order', () => {
    expect(
      options(
        commonOpts({
          type: 'string',
          deprecated: true,
          readOnly: true,
          writeOnly: false,
        }),
      ),
    ).toBe('{readOnly:true,writeOnly:false,deprecated:true}')
  })

  it('preserves OpenAPI 3.0 example field', () => {
    expect(options(commonOpts({ type: 'string', example: 'demo' }))).toBe('{example:"demo"}')
  })

  it('preserves externalDocs object as-is', () => {
    expect(
      options(
        commonOpts({
          type: 'string',
          externalDocs: { url: 'https://example.com', description: 'docs' },
        }),
      ),
    ).toBe('{externalDocs:{"url":"https://example.com","description":"docs"}}')
  })

  it('preserves x-error-message as-is (no error mirror)', () => {
    expect(options(commonOpts({ type: 'string', 'x-error-message': 'invalid' }))).toBe(
      '{"x-error-message":"invalid"}',
    )
  })

  it('preserves multiple x-* extensions verbatim', () => {
    expect(
      options(
        commonOpts({
          type: 'string',
          'x-error-message': 'bad',
          'x-pattern-message': 'no match',
          'x-brand': 'UserId',
        }),
      ),
    ).toBe('{"x-error-message":"bad","x-pattern-message":"no match","x-brand":"UserId"}')
  })

  it('preserves every x-*-message extension in Schema-type-defined order (40-extension spec)', () => {
    expect(
      options(
        commonOpts({
          type: 'string',
          // Common
          'x-error-message': 'a',
          'x-required-message': 'b',
          'x-const-message': 'c',
          'x-enum-message': 'd',
          // Numeric
          'x-minimum-message': 'e',
          'x-maximum-message': 'f',
          'x-exclusiveMinimum-message': 'g',
          'x-exclusiveMaximum-message': 'h',
          'x-multipleOf-message': 'i',
          // String
          'x-minLength-message': 'j',
          'x-maxLength-message': 'k',
          'x-pattern-message': 'l',
          'x-length-message': 'm',
          // Array
          'x-minItems-message': 'n',
          'x-maxItems-message': 'o',
          'x-uniqueItems-message': 'p',
          'x-contains-message': 'q',
          'x-minContains-message': 'r',
          'x-maxContains-message': 's',
          'x-prefixItems-message': 'sa',
          'x-items-message': 'sb',
          // Object
          'x-minProperties-message': 't',
          'x-maxProperties-message': 'u',
          'x-additionalProperties-message': 'v',
          'x-propertyNames-message': 'w',
          'x-patternProperties-message': 'x',
          'x-dependentRequired-message': 'y',
          'x-dependentSchemas-message': 'z',
          'x-properties-message': 'za',
          // Unevaluated / conditional
          'x-unevaluatedProperties-message': 'zb',
          'x-unevaluatedItems-message': 'zc',
          'x-if-message': 'zd',
          'x-then-message': 'ze',
          'x-else-message': 'zf',
          // Composition
          'x-allOf-message': 'aa',
          'x-anyOf-message': 'ab',
          'x-oneOf-message': 'ac',
          'x-not-message': 'ad',
          'x-implication-message': 'ae',
        }),
      ),
    ).toBe(
      '{"x-error-message":"a","x-required-message":"b","x-const-message":"c","x-enum-message":"d","x-minimum-message":"e","x-maximum-message":"f","x-exclusiveMinimum-message":"g","x-exclusiveMaximum-message":"h","x-multipleOf-message":"i","x-minLength-message":"j","x-maxLength-message":"k","x-pattern-message":"l","x-length-message":"m","x-minItems-message":"n","x-maxItems-message":"o","x-uniqueItems-message":"p","x-contains-message":"q","x-minContains-message":"r","x-maxContains-message":"s","x-prefixItems-message":"sa","x-items-message":"sb","x-minProperties-message":"t","x-maxProperties-message":"u","x-additionalProperties-message":"v","x-propertyNames-message":"w","x-patternProperties-message":"x","x-dependentRequired-message":"y","x-dependentSchemas-message":"z","x-properties-message":"za","x-unevaluatedProperties-message":"zb","x-unevaluatedItems-message":"zc","x-if-message":"zd","x-then-message":"ze","x-else-message":"zf","x-allOf-message":"aa","x-anyOf-message":"ab","x-oneOf-message":"ac","x-not-message":"ad","x-implication-message":"ae"}',
    )
  })
})

describe('errorCallback', () => {
  it('returns undefined when neither x-error-message nor active branches exist', () => {
    expect(errorCallback({ type: 'string' }, 'string')).toBeUndefined()
  })

  it('emits a plain string error when only x-error-message is set', () => {
    expect(errorCallback({ type: 'string', 'x-error-message': 'invalid' }, 'string')).toStrictEqual(
      ['error', 'invalid'],
    )
  })

  it('falls back to plain string when per-constraint extensions are present without matching constraint', () => {
    // x-minLength-message has no minLength sibling → no runtime branch → x-error-message wins.
    const out = errorCallback(
      { type: 'string', 'x-error-message': 'fallback', 'x-minLength-message': 'orphan' },
      'string',
    )
    expect(out).toStrictEqual(['error', 'fallback'])
  })

  it('falls back to undefined when only orphan per-constraint extensions exist', () => {
    expect(
      errorCallback({ type: 'string', 'x-minLength-message': 'orphan' }, 'string'),
    ).toBeUndefined()
  })

  it('ignores polymorphic x-minimum-message on string (numeric-only in v3.0 spec)', () => {
    // x-minimum-message is reserved for `number` / `integer` minimums.
    // On a string schema with minLength, the per-keyword `x-minLength-message`
    // is the only key that emits a branch.
    const out = errorCallback(
      { type: 'string', minLength: 3, 'x-minimum-message': 'wrong key' },
      'string',
    )
    expect(out).toBeUndefined()
  })

  it('emits per-constraint callback for string with all of min/max/pattern', () => {
    const result = errorCallback(
      {
        type: 'string',
        minLength: 3,
        maxLength: 10,
        pattern: '^[a-z]+$',
        'x-error-message': 'invalid string',
        'x-minLength-message': 'too short',
        'x-maxLength-message': 'too long',
        'x-pattern-message': 'letters only',
      },
      'string',
    )
    expect(result?.[0]).toBe('error')
    // raw expression — extract the inner expr
    expect(typeof result?.[1] === 'object' && result?.[1] !== null && 'expr' in result[1]).toBe(
      true,
    )
    const expr = (result?.[1] as { expr: string }).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===52)return "too short";if(type===51)return "too long";if(type===48||type===53)return "letters only";return "invalid string"}',
    )
  })

  it('treats minLength === maxLength + x-length-message as both StringMinLength & StringMaxLength', () => {
    const result = errorCallback(
      { type: 'string', minLength: 5, maxLength: 5, 'x-length-message': 'must be 5 chars' },
      'string',
    )
    const expr = (result?.[1] as { expr: string }).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===51||type===52)return "must be 5 chars";return undefined}',
    )
  })

  it('emits NumberMinimum / NumberMaximum branches for number', () => {
    const expr = (
      errorCallback(
        {
          type: 'number',
          minimum: 0,
          maximum: 100,
          'x-minimum-message': 'must be >= 0',
          'x-maximum-message': 'must be <= 100',
        },
        'number',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===39)return "must be >= 0";if(type===38)return "must be <= 100";return undefined}',
    )
  })

  it('emits exclusive branches for number with exclusiveMinimum / exclusiveMaximum + multipleOf', () => {
    const expr = (
      errorCallback(
        {
          type: 'number',
          exclusiveMinimum: 0,
          exclusiveMaximum: 1,
          multipleOf: 0.1,
          'x-exclusiveMinimum-message': 'must be > 0',
          'x-exclusiveMaximum-message': 'must be < 1',
          'x-multipleOf-message': 'must be a multiple of 0.1',
        },
        'number',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===37)return "must be > 0";if(type===36)return "must be < 1";if(type===40)return "must be a multiple of 0.1";return undefined}',
    )
  })

  it('emits IntegerMinimum / IntegerMultipleOf branches for integer', () => {
    const expr = (
      errorCallback(
        {
          type: 'integer',
          minimum: 1,
          multipleOf: 2,
          'x-minimum-message': 'at least 1',
          'x-multipleOf-message': 'must be even',
        },
        'integer',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===25)return "at least 1";if(type===26)return "must be even";return undefined}',
    )
  })

  it('emits ArrayMinItems / ArrayMaxItems branches for array', () => {
    const expr = (
      errorCallback(
        {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          'x-minItems-message': 'at least one item',
          'x-maxItems-message': 'at most five items',
          'x-error-message': 'invalid array',
        },
        'array',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===4)return "at least one item";if(type===2)return "at most five items";return "invalid array"}',
    )
  })

  it('emits ArrayUniqueItems / ArrayContains / ArrayMinContains / ArrayMaxContains branches', () => {
    const expr = (
      errorCallback(
        {
          type: 'array',
          uniqueItems: true,
          contains: { type: 'string' },
          minContains: 1,
          maxContains: 3,
          'x-uniqueItems-message': 'no duplicates',
          'x-contains-message': 'must contain at least one string',
          'x-minContains-message': 'too few matches',
          'x-maxContains-message': 'too many matches',
        },
        'array',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===5)return "no duplicates";if(type===0)return "must contain at least one string";if(type===3)return "too few matches";if(type===1)return "too many matches";return undefined}',
    )
  })

  it('emits ObjectMinProperties / ObjectMaxProperties branches for object', () => {
    const expr = (
      errorCallback(
        {
          type: 'object',
          minProperties: 1,
          maxProperties: 3,
          'x-minProperties-message': 'need at least one prop',
          'x-maxProperties-message': 'no more than three props',
        },
        'object',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===44)return "need at least one prop";if(type===43)return "no more than three props";return undefined}',
    )
  })

  it('emits ObjectRequiredProperty branch for x-required-message + required[]', () => {
    const expr = (
      errorCallback(
        {
          type: 'object',
          required: ['id'],
          'x-required-message': 'id is required',
        },
        'object',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===45)return "id is required";return undefined}',
    )
  })

  it('emits ObjectAdditionalProperties branch for x-additionalProperties-message + additionalProperties:false', () => {
    const expr = (
      errorCallback(
        {
          type: 'object',
          additionalProperties: false,
          'x-additionalProperties-message': 'no extra fields allowed',
        },
        'object',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===42)return "no extra fields allowed";return undefined}',
    )
  })

  it('emits Literal branch for x-const-message + const', () => {
    const expr = (
      errorCallback(
        { const: 'fixed', 'x-const-message': 'must be exactly "fixed"' },
        'composition',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===32)return "must be exactly \\"fixed\\"";return undefined}',
    )
  })

  it('emits Union branch for oneOf composition', () => {
    const expr = (
      errorCallback(
        { oneOf: [{ type: 'string' }, { type: 'integer' }], 'x-oneOf-message': 'pick one' },
        'composition',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return "pick one";return undefined}',
    )
  })

  it('emits Union branch for anyOf when x-anyOf-message is set', () => {
    const expr = (
      errorCallback(
        { anyOf: [{ type: 'string' }, { type: 'integer' }], 'x-anyOf-message': 'no match' },
        'composition',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return "no match";return undefined}',
    )
  })

  it('emits Intersect branch for allOf composition', () => {
    const expr = (
      errorCallback(
        {
          allOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
          'x-allOf-message': 'must match all',
        },
        'composition',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===29)return "must match all";return undefined}',
    )
  })

  it('emits Not branch when x-not-message is set with not constraint via composition', () => {
    const expr = (
      errorCallback(
        { not: { type: 'string' }, 'x-not-message': 'must not be a string' },
        'composition',
      )?.[1] as { expr: string }
    ).expr
    expect(expr).toBe(
      '(error)=>{const type=error?.errors?.[0]?.type;if(type===34)return "must not be a string";return undefined}',
    )
  })
})

describe('transformWrap', () => {
  it('returns expr unchanged when neither x-propertyNames-message nor x-dependentRequired-message is set', () => {
    expect(transformWrap('t.Object({})', { type: 'object' })).toBe('t.Object({})')
  })

  it('returns expr unchanged when x-propertyNames-message is set but propertyNames.pattern is missing', () => {
    expect(
      transformWrap('t.Object({})', { type: 'object', 'x-propertyNames-message': 'oops' }),
    ).toBe('t.Object({})')
  })

  it('returns expr unchanged when x-dependentRequired-message is set but dependentRequired is missing', () => {
    expect(
      transformWrap('t.Object({})', {
        type: 'object',
        'x-dependentRequired-message': 'oops',
      }),
    ).toBe('t.Object({})')
  })

  it('wraps with Transform when x-propertyNames-message + propertyNames.pattern coexist', () => {
    expect(
      transformWrap('t.Record(t.String(),t.String())', {
        type: 'object',
        additionalProperties: { type: 'string' },
        propertyNames: { pattern: '^[a-z]+$' },
        'x-propertyNames-message': 'keys must be lowercase letters only',
      }),
    ).toBe(
      `t.Transform(t.Record(t.String(),t.String())).Decode((v)=>{const propNamesRe=new RegExp("^[a-z]+$");if(v&&typeof v==='object'){for(const k of Object.keys(v)){if(!propNamesRe.test(k))throw new Error("keys must be lowercase letters only")}}return v}).Encode((v)=>v)`,
    )
  })

  it('warns when x-propertyNames-message is paired with propertyNames keywords other than pattern', () => {
    const calls: string[] = []
    const orig = console.warn
    console.warn = (...args: unknown[]) => {
      calls.push(args.map(String).join(' '))
    }
    try {
      const out = transformWrap('t.Record(t.String(),t.String())', {
        type: 'object',
        additionalProperties: { type: 'string' },
        // No `pattern` — only minLength/enum, which the transform path
        // can't enforce. Should warn instead of silently skipping.
        propertyNames: { minLength: 3, enum: ['a', 'b'] },
        'x-propertyNames-message': 'keys constraint',
      })
      // No transform should be emitted (no enforceable keyword present).
      expect(out).toBe('t.Record(t.String(),t.String())')
      expect(calls.length).toBe(1)
      expect(calls[0]?.includes('only `pattern` is enforced')).toBe(true)
      expect(calls[0]?.includes('`minLength`')).toBe(true)
      expect(calls[0]?.includes('`enum`')).toBe(true)
    } finally {
      console.warn = orig
    }
  })

  it('wraps with Transform when x-dependentRequired-message + dependentRequired coexist', () => {
    expect(
      transformWrap('t.Object({"label":t.Optional(t.String()),"value":t.Optional(t.String())})', {
        type: 'object',
        properties: {
          label: { type: 'string' },
          value: { type: 'string' },
        },
        dependentRequired: { label: ['value'] },
        'x-dependentRequired-message': 'if label is present, value is required',
      }),
    ).toBe(
      `t.Transform(t.Object({"label":t.Optional(t.String()),"value":t.Optional(t.String())})).Decode((v)=>{if(v&&typeof v==='object'){if("label" in v&&(!("value" in v)))throw new Error("if label is present, value is required")}return v}).Encode((v)=>v)`,
    )
  })

  it('warns when a dependentRequired entry has an empty required array', () => {
    const calls: string[] = []
    const orig = console.warn
    console.warn = (...args: unknown[]) => {
      calls.push(args.map(String).join(' '))
    }
    try {
      const out = transformWrap('t.Object({})', {
        type: 'object',
        // `b: []` is a no-op (no required keys to check). Should warn,
        // but `a: ['x']` still produces its check normally.
        dependentRequired: { a: ['x'], b: [] },
        'x-dependentRequired-message': 'dep needed',
      })
      expect(out.includes('"a" in v')).toBe(true)
      expect(out.includes('"b" in v')).toBe(false)
      expect(calls.length).toBe(1)
      expect(calls[0]?.includes('empty arrays are silently skipped')).toBe(true)
      expect(calls[0]?.includes('`b`')).toBe(true)
    } finally {
      console.warn = orig
    }
  })

  it('handles multiple dependentRequired triggers', () => {
    expect(
      transformWrap('t.Object({})', {
        type: 'object',
        dependentRequired: { a: ['b'], c: ['d', 'e'] },
        'x-dependentRequired-message': 'dependent fields required',
      }),
    ).toBe(
      `t.Transform(t.Object({})).Decode((v)=>{if(v&&typeof v==='object'){if("a" in v&&(!("b" in v)))throw new Error("dependent fields required");if("c" in v&&(!("d" in v)||!("e" in v)))throw new Error("dependent fields required")}return v}).Encode((v)=>v)`,
    )
  })

  it('combines propertyNames + dependentRequired checks in one Transform', () => {
    const out = transformWrap('t.Object({})', {
      type: 'object',
      propertyNames: { pattern: '^[a-z]+$' },
      dependentRequired: { a: ['b'] },
      'x-propertyNames-message': 'keys lowercase',
      'x-dependentRequired-message': 'a needs b',
    })
    expect(out.startsWith('t.Transform(t.Object({})).Decode((v)=>{')).toBe(true)
    expect(out.includes('keys lowercase')).toBe(true)
    expect(out.includes('a needs b')).toBe(true)
    expect(out.endsWith('return v}).Encode((v)=>v)')).toBe(true)
  })

  it('wraps with Transform when x-patternProperties-message + patternProperties + additionalProperties:false coexist', () => {
    const out = transformWrap('t.Object({})', {
      type: 'object',
      patternProperties: { '^S_': { type: 'string' } },
      additionalProperties: false,
      'x-patternProperties-message': 'S_ keys must match pattern',
    })
    expect(out).toBe(
      `t.Transform(t.Object({})).Decode((v)=>{const patternPropsRes=[new RegExp("^S_")];const declaredProps=new Set<string>([]);if(v&&typeof v==='object'){for(const k of Object.keys(v)){if(declaredProps.has(k))continue;if(!patternPropsRes.some(r=>r.test(k)))throw new Error("S_ keys must match pattern")}}return v}).Encode((v)=>v)`,
    )
  })

  it('skips declared properties when checking patternProperties', () => {
    const out = transformWrap('t.Object({})', {
      type: 'object',
      properties: { id: { type: 'string' } },
      patternProperties: { '^x-': { type: 'string' } },
      additionalProperties: false,
      'x-patternProperties-message': 'extension keys must start with x-',
    })
    expect(out.includes('declaredProps=new Set<string>(["id"])')).toBe(true)
  })

  it('does NOT wrap patternProperties check when additionalProperties is unset (JSON Schema default = true)', () => {
    // JSON Schema spec: a key matching no patternProperties pattern is
    // allowed unless additionalProperties:false. No guard → no Transform.
    const out = transformWrap('t.Object({})', {
      type: 'object',
      patternProperties: { '^x-': { type: 'string' } },
      'x-patternProperties-message': 'this should not fire at runtime',
    })
    expect(out).toBe('t.Object({})')
  })

  it('wraps with Transform when x-dependentSchemas-message + dependentSchemas coexist (shallow fallback)', () => {
    // No renderSubSchema callback supplied → shallow `required[]`-only
    // fallback path (with build-time warn). Used by direct-call sites
    // that don't have access to the recursive emitter.
    const orig = console.warn
    console.warn = () => {}
    try {
      expect(
        transformWrap('t.Object({})', {
          type: 'object',
          dependentSchemas: {
            credit_card: { required: ['billing_address'] },
          },
          'x-dependentSchemas-message': 'credit_card requires billing_address',
        }),
      ).toBe(
        `t.Transform(t.Object({})).Decode((v)=>{if(v&&typeof v==='object'){if("credit_card" in v&&(!("billing_address" in v)))throw new Error("credit_card requires billing_address")}return v}).Encode((v)=>v)`,
      )
    } finally {
      console.warn = orig
    }
  })

  it('emits Value.Check deep enforcement when renderSubSchema callback is supplied', () => {
    // Mock sub-schema emitter — production wire-up uses the recursive
    // typebox() emitter from the object generator.
    const renderSubSchema = (sub: { readonly type?: unknown }) =>
      sub.type === 'object' ? `t.Object({foo:t.String()})` : 't.Unknown()'
    const out = transformWrap(
      't.Object({})',
      {
        type: 'object',
        dependentSchemas: {
          credit_card: { type: 'object', required: ['foo'] },
        },
        'x-dependentSchemas-message': 'credit_card requires foo',
      },
      renderSubSchema,
    )
    expect(out.includes('const depSubs={"credit_card":t.Object({foo:t.String()})}')).toBe(true)
    expect(out.includes('Value.Check(depSubs["credit_card"],v)')).toBe(true)
    expect(out.includes('throw new Error("credit_card requires foo")')).toBe(true)
  })

  it('warns when dependentSchemas sub-schema has additionalProperties:false without trigger in properties', () => {
    const calls: string[] = []
    const orig = console.warn
    console.warn = (...args: unknown[]) => {
      calls.push(args.map(String).join(' '))
    }
    try {
      transformWrap(
        't.Object({})',
        {
          type: 'object',
          dependentSchemas: {
            // Spec foot-gun: additionalProperties:false rejects the trigger
            // key (`credit_card`) itself unless listed in `properties` —
            // every payload would 422.
            credit_card: {
              type: 'object',
              additionalProperties: false,
              required: ['billing_address'],
              properties: { billing_address: { type: 'string' } },
            },
          },
          'x-dependentSchemas-message': 'cc requires billing',
        },
        () => 't.Object({},{additionalProperties:false})',
      )
      expect(calls.length).toBe(1)
      expect(calls[0]?.includes('additionalProperties: false')).toBe(true)
      expect(calls[0]?.includes('credit_card')).toBe(true)
    } finally {
      console.warn = orig
    }
  })

  it('warns when dependentSchemas sub-schema is non-object', () => {
    const calls: string[] = []
    const orig = console.warn
    console.warn = (...args: unknown[]) => {
      calls.push(args.map(String).join(' '))
    }
    try {
      transformWrap(
        't.Object({})',
        {
          type: 'object',
          dependentSchemas: {
            // Foot-gun: a string sub-schema can't match the parent object
            // at runtime — Value.Check always returns false → every
            // payload would 422.
            tag: { type: 'string' },
          },
          'x-dependentSchemas-message': 'tag is funky',
        },
        () => 't.String()',
      )
      expect(calls.length).toBe(1)
      expect(calls[0]?.includes('type: string')).toBe(true)
    } finally {
      console.warn = orig
    }
  })
})

describe('wrap', () => {
  it('returns expr unchanged when not nullable', () => {
    expect(wrap('t.String()', { type: 'string' })).toBe('t.String()')
  })

  it('wraps with Union+Null for OpenAPI 3.0 nullable:true', () => {
    expect(wrap('t.String()', { type: 'string', nullable: true })).toBe(
      't.Union([t.String(),t.Null()])',
    )
  })

  it('wraps with Union+Null for OpenAPI 3.1 type array containing null', () => {
    expect(wrap('t.String()', { type: ['string', 'null'] })).toBe('t.Union([t.String(),t.Null()])')
  })

  it('does not wrap when type array does not include null', () => {
    expect(wrap('t.String()', { type: ['string', 'integer'] })).toBe('t.String()')
  })
})

describe('brand', () => {
  it('passes expr through when x-brand is absent', () => {
    expect(brand('t.String()', { type: 'string' })).toBe('t.String()')
  })

  it('wraps string schema with t.Unsafe + branded TS type', () => {
    expect(brand('t.String({format:"uuid"})', { type: 'string', 'x-brand': 'UserId' })).toBe(
      `t.Unsafe<string & { readonly __brand: 'UserId' }>(t.String({format:"uuid"}))`,
    )
  })

  it('wraps integer schema with number base', () => {
    expect(brand('t.Integer()', { type: 'integer', 'x-brand': 'OrderId' })).toBe(
      `t.Unsafe<number & { readonly __brand: 'OrderId' }>(t.Integer())`,
    )
  })

  it('wraps number schema with number base', () => {
    expect(brand('t.Number()', { type: 'number', 'x-brand': 'Score' })).toBe(
      `t.Unsafe<number & { readonly __brand: 'Score' }>(t.Number())`,
    )
  })

  it('wraps boolean schema with boolean base', () => {
    expect(brand('t.Boolean()', { type: 'boolean', 'x-brand': 'Flag' })).toBe(
      `t.Unsafe<boolean & { readonly __brand: 'Flag' }>(t.Boolean())`,
    )
  })

  it('handles OpenAPI 3.1 nullable type array', () => {
    expect(brand('t.String()', { type: ['string', 'null'], 'x-brand': 'Maybe' })).toBe(
      `t.Unsafe<string & { readonly __brand: 'Maybe' }>(t.String())`,
    )
  })

  it('passes through when type is not a primitive (no branding for arrays/objects)', () => {
    expect(brand('t.Object({})', { type: 'object', 'x-brand': 'Wrapper' })).toBe('t.Object({})')
  })
})

describe('readonly', () => {
  it('passes expr through when enabled is omitted', () => {
    expect(readonly('t.String()')).toBe('t.String()')
  })

  it('passes expr through when enabled is false', () => {
    expect(readonly('t.String()', false)).toBe('t.String()')
  })

  it('wraps expression in t.Readonly when enabled is true', () => {
    expect(readonly('t.String()', true)).toBe('t.Readonly(t.String())')
  })
})

describe('stringPatternFrom', () => {
  it('returns existing pattern unchanged when no substring shortcuts present', () => {
    expect(stringPatternFrom({ type: 'string', pattern: '^[a-z]+$' })).toBe('^[a-z]+$')
  })

  it('returns undefined when neither pattern nor shortcuts present', () => {
    expect(stringPatternFrom({ type: 'string' })).toBeUndefined()
  })

  it('folds x-startsWith into anchored prefix pattern', () => {
    expect(stringPatternFrom({ type: 'string', 'x-startsWith': 'foo' })).toBe('^foo')
  })

  it('folds x-endsWith into anchored suffix pattern', () => {
    expect(stringPatternFrom({ type: 'string', 'x-endsWith': 'bar' })).toBe('bar$')
  })

  it('folds x-includes into substring pattern', () => {
    expect(stringPatternFrom({ type: 'string', 'x-includes': 'mid' })).toBe('mid')
  })

  it('joins multiple substring shortcuts with .* between them', () => {
    expect(
      stringPatternFrom({
        type: 'string',
        'x-startsWith': 'a',
        'x-includes': 'b',
        'x-endsWith': 'c',
      }),
    ).toBe('^a.*b.*c$')
  })

  it('escapes regex metacharacters in substring shortcuts', () => {
    expect(stringPatternFrom({ type: 'string', 'x-startsWith': 'a.b+c' })).toBe('^a\\.b\\+c')
  })

  it('drops existing pattern when substring shortcuts are present', () => {
    expect(stringPatternFrom({ type: 'string', pattern: '^x', 'x-startsWith': 'foo' })).toBe('^foo')
  })

  it('uses x-emailRegex when format is email', () => {
    expect(
      stringPatternFrom({ type: 'string', format: 'email', 'x-emailRegex': '^[a-z]+@x$' }),
    ).toBe('^[a-z]+@x$')
  })

  it('ignores x-emailRegex when format is not email', () => {
    expect(
      stringPatternFrom({ type: 'string', pattern: '^p$', 'x-emailRegex': '^[a-z]+@x$' }),
    ).toBe('^p$')
  })
})

describe('stringTransformWrap', () => {
  it('returns expr unchanged when no transform extensions are set', () => {
    expect(stringTransformWrap('t.String()', { type: 'string' })).toBe('t.String()')
  })

  it('wraps with t.Transform applying trim', () => {
    expect(stringTransformWrap('t.String()', { type: 'string', 'x-trim': true })).toBe(
      't.Transform(t.String()).Decode((v)=>{v=v.trim();return v}).Encode((v)=>v)',
    )
  })

  it('chains trim → lowercase → normalize in source order', () => {
    expect(
      stringTransformWrap('t.String()', {
        type: 'string',
        'x-trim': true,
        'x-toLowerCase': true,
        'x-normalize': 'NFC',
      }),
    ).toBe(
      't.Transform(t.String()).Decode((v)=>{v=v.trim();v=v.toLowerCase();v=v.normalize("NFC");return v}).Encode((v)=>v)',
    )
  })

  it('accepts x-lowercase alias for x-toLowerCase', () => {
    expect(stringTransformWrap('t.String()', { type: 'string', 'x-lowercase': true })).toBe(
      't.Transform(t.String()).Decode((v)=>{v=v.toLowerCase();return v}).Encode((v)=>v)',
    )
  })

  it('accepts x-uppercase alias for x-toUpperCase', () => {
    expect(stringTransformWrap('t.String()', { type: 'string', 'x-uppercase': true })).toBe(
      't.Transform(t.String()).Decode((v)=>{v=v.toUpperCase();return v}).Encode((v)=>v)',
    )
  })

  it('ignores x-normalize when value is not a known form', () => {
    expect(
      stringTransformWrap('t.String()', {
        type: 'string',
        // @ts-expect-error testing invalid runtime value falls through silently
        'x-normalize': 'BOGUS',
      }),
    ).toBe('t.String()')
  })
})

describe('enumErrorCallback', () => {
  it('returns undefined when neither x-enum-message nor x-error-message is set', () => {
    expect(enumErrorCallback({ type: 'string' })).toBeUndefined()
  })

  it('returns the fallback x-error-message verbatim when only fallback is set', () => {
    expect(enumErrorCallback({ type: 'string', 'x-error-message': 'bad' })).toStrictEqual([
      'error',
      'bad',
    ])
  })

  it('returns x-enum-message verbatim when only enum message is set', () => {
    expect(enumErrorCallback({ type: 'string', 'x-enum-message': 'pick one' })).toStrictEqual([
      'error',
      'pick one',
    ])
  })

  it('dispatches on error type 62 when both x-enum-message and x-error-message are set', () => {
    const result = enumErrorCallback({
      type: 'string',
      'x-enum-message': 'pick one',
      'x-error-message': 'bad',
    })
    expect(result?.[0]).toBe('error')
    expect(options([result ?? ['noop', '']])).toBe(
      '{error:(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return "pick one";return "bad"}}',
    )
  })
})

describe('options', () => {
  it('returns empty string when no defined values', () => {
    expect(options([])).toBe('')
    expect(options([['a', undefined]])).toBe('')
  })

  it('serializes a single pair', () => {
    expect(options([['minLength', 1]])).toBe('{minLength:1}')
  })

  it('skips undefined entries', () => {
    expect(
      options([
        ['minLength', 1],
        ['maxLength', undefined],
        ['format', 'uuid'],
      ]),
    ).toBe('{minLength:1,format:"uuid"}')
  })

  it('preserves false and 0', () => {
    expect(options([['default', false]])).toBe('{default:false}')
    expect(options([['minimum', 0]])).toBe('{minimum:0}')
  })

  it('JSON-encodes string values', () => {
    expect(options([['description', 'a "quoted" desc']])).toBe(
      '{description:"a \\"quoted\\" desc"}',
    )
  })

  it('quotes non-identifier keys (e.g. x-error-message)', () => {
    expect(options([['x-error-message', 'oops']])).toBe('{"x-error-message":"oops"}')
  })

  it('does not quote valid identifier keys', () => {
    expect(options([['minLength', 1]])).toBe('{minLength:1}')
  })
})
