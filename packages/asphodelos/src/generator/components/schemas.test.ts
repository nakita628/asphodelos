import { describe, expect, it } from 'bun:test'

import { Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'

import { schemaConstNames, schemasCode } from './schemas.js'

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

  it('resolves the names per file when the output is split', () => {
    // `User` and `user` are written to files of their own, where neither collides.
    expect(schemaConstNames(schemas, true).get('user')).toBe('UserSchema')
  })

  it('suffixes a colliding key within one split file', () => {
    const cycle = {
      Node: { type: 'object', properties: { next: { $ref: '#/components/schemas/node' } } },
      node: { type: 'object', properties: { next: { $ref: '#/components/schemas/Node' } } },
    } as const
    const names = schemaConstNames(cycle, true)
    expect([...names.values()].toSorted()).toStrictEqual(['Node2Schema', 'NodeSchema'])
    const code = schemasCode(cycle)
    for (const ident of names.values()) expect(code).toContain(`export const ${ident}=`)
  })
})
