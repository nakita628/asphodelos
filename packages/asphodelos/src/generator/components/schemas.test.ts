import { describe, expect, it } from 'bun:test'

import { Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

import { schemaConstNames, schemasCode, uniqueSchemas } from './schemas.js'

describe('schemasCode — empty / single', () => {
  it('returns empty string for undefined', () => {
    expect(schemasCode(undefined)).toBe('')
  })

  it('returns empty string for empty section', () => {
    expect(schemasCode({})).toBe('')
  })

  it('emits a plain const for a non-recursive schema', () => {
    expect(schemasCode({ User: { type: 'string' } })).toBe('export const UserSchema=t.String()')
  })

  it('PascalCases the entry name', () => {
    expect(schemasCode({ 'user-id': { type: 'string' } })).toBe(
      'export const UserIdSchema=t.String()',
    )
  })

  it('emits Static<typeof ...> alias when exportTypes=true', () => {
    expect(schemasCode({ User: { type: 'string' } }, false, true)).toBe(
      'export const UserSchema=t.String()\n\nexport type User=Static<typeof UserSchema>',
    )
  })

  it('suffixes case-colliding keys so exported names stay unique', () => {
    expect(
      schemasCode(
        {
          User: { type: 'object', properties: { id: { type: 'string' } } },
          user: { type: 'object', properties: { id: { type: 'integer' } } },
        },
        false,
        true,
      ),
    ).toBe(
      'export const UserSchema=t.Object({"id":t.Optional(t.String())})\n\nexport type User=Static<typeof UserSchema>\n\nexport const User2Schema=t.Object({"id":t.Optional(t.Integer({maximum:9007199254740991}))})\n\nexport type User2=Static<typeof User2Schema>',
    )
  })

  it('wraps with t.Readonly when readonly=true', () => {
    expect(schemasCode({ User: { type: 'string' } }, true)).toBe(
      'export const UserSchema=t.Readonly(t.String())',
    )
  })

  it('omits export keyword when exported=false', () => {
    expect(schemasCode({ User: { type: 'string' } }, false, false, false)).toBe(
      'const UserSchema=t.String()',
    )
  })
})

describe('schemasCode — self-recursive (SCC size 1 with self-loop)', () => {
  it('wraps with t.Recursive when the schema references itself', () => {
    const result = schemasCode({
      Node: {
        type: 'object',
        properties: {
          value: { type: 'string' },
          next: { $ref: '#/components/schemas/Node' },
        },
      },
    })
    expect(result).toBe(
      'export const NodeSchema=t.Recursive((Self)=>t.Object({"value":t.Optional(t.String()),"next":t.Optional(Self)}))',
    )
  })
})

describe('schemasCode — mutually recursive (SCC size > 1)', () => {
  it('collapses a star-shaped SCC (hub + spokes) to a single t.Recursive root', () => {
    expect(
      schemasCode({
        A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
        B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
      }),
    ).toBe(
      'export const ASchema=t.Recursive((Self)=>t.Object({"b":t.Optional((t.Object({"a":t.Optional(Self)})))}))\n\nexport const BSchema=t.Object({"a":t.Optional(ASchema)})',
    )
  })

  it('emits Static<typeof ...> alias for each member of a collapsed SCC when exportTypes=true', () => {
    expect(
      schemasCode(
        {
          A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
          B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
        },
        false,
        true,
      ),
    ).toBe(
      'export const ASchema=t.Recursive((Self)=>t.Object({"b":t.Optional((t.Object({"a":t.Optional(Self)})))}))\n\nexport type A=Static<typeof ASchema>\n\nexport const BSchema=t.Object({"a":t.Optional(ASchema)})\n\nexport type B=Static<typeof BSchema>',
    )
  })

  it('keeps a non-star SCC (no single hub, e.g. a 3-cycle) on the t.Module path', () => {
    expect(
      schemasCode({
        A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
        B: { type: 'object', properties: { c: { $ref: '#/components/schemas/C' } } },
        C: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
      }),
    ).toBe(
      "const CModule=t.Module({C:t.Object({\"a\":t.Optional(t.Ref('A'))}),B:t.Object({\"c\":t.Optional(t.Ref('C'))}),A:t.Object({\"b\":t.Optional(t.Ref('B'))})})\n\nexport const CSchema=CModule.Import('C')\n\nexport const BSchema=CModule.Import('B')\n\nexport const ASchema=CModule.Import('A')",
    )
  })
})

// The collapse only resolves TS2589 if the t.Recursive form validates identically to the
// t.Module form it replaces. Pin that equivalence on the canonical shapes (a primitive-union
// value ⇄ a record of it; an array ⇄ its element) the codegen actually collapses.
describe('star-collapse runtime equivalence (t.Module vs t.Recursive)', () => {
  const valueModule = t.Module({
    NestedCustomField: t.Record(t.String(), t.Ref('CustomFieldValue')),
    CustomFieldValue: t.Union([
      t.String(),
      t.Number(),
      t.Array(t.String()),
      t.Ref('NestedCustomField'),
    ]),
  })
  const cfvModule = valueModule.Import('CustomFieldValue')
  const cfvRecursive = t.Recursive((Self) =>
    t.Union([t.String(), t.Number(), t.Array(t.String()), t.Record(t.String(), Self)]),
  )

  const inputs: readonly unknown[] = [
    'leaf',
    7,
    ['a', 'b'],
    { k: 'v' },
    { a: { b: { c: 1 } } },
    { k: { bad: [1, 2] } },
    null,
    { mixed: ['x'], n: 3 },
  ]

  // Wrapped in a one-element tuple: `it.each` spreads an array row into arguments, and one of
  // the inputs is itself an array.
  it.each(inputs.map((input) => [input] as const))('matches Value.Check for %j', (input) => {
    expect(Value.Check(cfvRecursive, input)).toBe(Value.Check(cfvModule, input))
  })
})

describe('schemasCode — multiple disjoint groups', () => {
  it('joins independent SCC outputs with double newlines', () => {
    const result = schemasCode({
      Foo: { type: 'string' },
      Bar: { type: 'number' },
    })
    expect(result).toBe('export const FooSchema=t.String()\n\nexport const BarSchema=t.Number()')
  })
})

// A generator that names a component from outside the schemas module has to name the const
// `schemasCode` wrote, which is not the key's own once two keys differ only in case.
describe('schemaConstNames', () => {
  const schemas = {
    User: { type: 'object', properties: { id: { type: 'string' } } },
    user: { type: 'object', properties: { id: { type: 'integer' } } },
    Pet: { type: 'object', properties: { owner: { $ref: '#/components/schemas/User' } } },
  } as const

  it('is empty without schemas', () => {
    expect([...schemaConstNames(undefined)]).toStrictEqual([])
  })

  it('names every key by the const schemasCode exports for it', () => {
    const names = schemaConstNames(schemas)
    expect([...names]).toStrictEqual([
      ['User', 'UserSchema'],
      ['user', 'User2Schema'],
      ['Pet', 'PetSchema'],
    ])
    const code = schemasCode(schemas)
    for (const ident of names.values()) expect(code).toContain(`export const ${ident}=`)
  })

  // A `$ref` is rendered as the const of the key it names, not as the pascal-cased key: a ref to
  // `user` is `User2Schema`, the const written for it, and a ref to `User` stays `UserSchema`.
  it('points a $ref to a colliding key at the const written for it', () => {
    const code = schemasCode({
      ...schemas,
      Owner: { type: 'object', properties: { account: { $ref: '#/components/schemas/user' } } },
    })
    expect(code).toContain('export const PetSchema=t.Object({"owner":t.Optional(UserSchema)})')
    expect(code).toContain('export const OwnerSchema=t.Object({"account":t.Optional(User2Schema)})')
  })

  it('closes a self reference of a suffixed key with Self', () => {
    const code = schemasCode({
      Node: { type: 'string' },
      node: { type: 'object', properties: { next: { $ref: '#/components/schemas/node' } } },
    })
    expect(code).toBe(
      'export const NodeSchema=t.String()\n\nexport const Node2Schema=t.Recursive((Self)=>t.Object({"next":t.Optional(Self)}))',
    )
  })

  it('leaves a $ref member of an example or a default as the value it is', () => {
    const ref = { $ref: '#/components/schemas/user' } as const
    const unique = uniqueSchemas({
      User: { type: 'string' },
      user: { type: 'object', example: ref, default: ref, properties: { self: ref } },
    })
    expect(unique).toStrictEqual({
      User: { type: 'string' },
      User2: {
        type: 'object',
        example: ref,
        default: ref,
        properties: { self: { $ref: '#/components/schemas/User2' } },
      },
    })
  })

  // Under `properties` a key is a property's name: one called `default` or `example` holds a
  // schema, not a value.
  it('follows a $ref under a property named like a data keyword', () => {
    const ref = { $ref: '#/components/schemas/user' } as const
    const to = { $ref: '#/components/schemas/User2' } as const
    const unique = uniqueSchemas({
      User: { type: 'string' },
      user: { type: 'number' },
      Settings: { type: 'object', properties: { default: ref, example: ref, $ref: ref } },
    })
    expect(unique.Settings).toStrictEqual({
      type: 'object',
      properties: { default: to, example: to, $ref: to },
    })
  })

  it('leaves a $ref that does not decode as it is', () => {
    const broken = { $ref: '#/components/schemas/100%' } as const
    const unique = uniqueSchemas({
      User: { type: 'string' },
      user: { type: 'object', properties: { rate: broken } },
    })
    expect(unique.User2).toStrictEqual({ type: 'object', properties: { rate: broken } })
  })

  it('returns a document without colliding keys as it is', () => {
    const plain = { User: { type: 'string' }, user_profile: { type: 'string' } } as const
    expect(uniqueSchemas(plain)).toBe(plain)
  })

  it('names two keys that collide with each other in a cycle', () => {
    const cycle = {
      Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/node' } } },
      node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } },
    } as const
    const names = schemaConstNames(cycle)
    expect([...names.values()].toSorted()).toStrictEqual(['Node2Schema', 'NodeSchema'])
    const code = schemasCode(cycle)
    for (const ident of names.values()) expect(code).toContain(`export const ${ident}=`)
  })
})
