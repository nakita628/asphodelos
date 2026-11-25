import { describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Type as t } from '@sinclair/typebox'
import { Value } from '@sinclair/typebox/value'
import { parseSync } from 'oxc-parser'

import type { OpenAPI, Schema } from '../../openapi/index.js'
import { schemaConstNames, schemasCode, uniqueSchemaKeys, uniqueSchemas } from './schemas.js'

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
      'const CModule=t.Module({C:t.Object({"a":t.Optional(t.Ref("A"))}),B:t.Object({"c":t.Optional(t.Ref("C"))}),A:t.Object({"b":t.Optional(t.Ref("B"))})})\n\nexport const CSchema=CModule.Import("C")\n\nexport const BSchema=CModule.Import("B")\n\nexport const ASchema=CModule.Import("A")',
    )
  })

  // A key that is not an identifier (`x.y`, as in the Stripe document) is quoted as a module key.
  it('quotes a member key that is not an identifier, so the module parses', () => {
    const code = schemasCode({
      a: { type: 'object', properties: { b: { $ref: '#/components/schemas/x.y' } } },
      'x.y': { type: 'object', properties: { c: { $ref: '#/components/schemas/c' } } },
      c: { type: 'object', properties: { a: { $ref: '#/components/schemas/a' } } },
    })
    expect(code).toContain('"x.y":t.Object({"c":t.Optional(t.Ref("c"))})')
    expect(code).toContain('t.Optional(t.Ref("x.y"))')
    expect(code).toContain('=CModule.Import("x.y")')
    expect(parseSync('schemas.ts', code).errors).toStrictEqual([])
  })

  it('leaves a string literal that spells a member const as the document wrote it', () => {
    const description = 'see ASchema and \'BSchema\' or "CSchema"'
    const module = schemasCode({
      A: {
        type: 'object',
        description,
        properties: { b: { $ref: '#/components/schemas/B' } },
      },
      B: { type: 'object', properties: { c: { $ref: '#/components/schemas/C' } } },
      C: {
        type: 'object',
        properties: {
          a: { $ref: '#/components/schemas/A' },
          kind: { type: 'string', enum: ['ASchema'], default: 'BSchema' },
        },
      },
    })
    expect(module).toContain('t.Module(')
    expect(module).toContain(JSON.stringify(description))
    expect(module).toContain('t.Literal("ASchema",{default:"BSchema"})')
    const star = schemasCode({
      Node: {
        type: 'object',
        description: 'a NodeSchema or a LeafSchema',
        properties: { leaf: { $ref: '#/components/schemas/Leaf' } },
      },
      Leaf: {
        type: 'object',
        description: 'back to NodeSchema',
        properties: { node: { $ref: '#/components/schemas/Node' } },
      },
    })
    expect(star).toContain('"a NodeSchema or a LeafSchema"')
    expect(star).toContain('"back to NodeSchema"')
    const self = schemasCode({
      Tree: {
        type: 'object',
        description: 'a TreeSchema',
        properties: { child: { $ref: '#/components/schemas/Tree' } },
      },
    })
    expect(self).toContain('"a TreeSchema"')
    expect(self).toContain('t.Optional(Self)')
  })

  it('writes a `__proto__` key as a computed module key, so it stays an entry', () => {
    const schemas = JSON.parse(
      '{"__proto__":{"type":"object","properties":{"b":{"$ref":"#/components/schemas/b"}}},"b":{"type":"object","properties":{"c":{"$ref":"#/components/schemas/c"}}},"c":{"type":"object","properties":{"p":{"$ref":"#/components/schemas/__proto__"}}}}',
    ) as { readonly [k: string]: Schema }
    const code = schemasCode(schemas)
    expect(code).toContain('["__proto__"]:t.Object(')
    expect(parseSync('schemas.ts', code).errors).toStrictEqual([])
  })

  it('escapes a quote in a brand, so the refs after it are still replaced', () => {
    const code = schemasCode({
      a: {
        type: 'object',
        properties: {
          id: { type: 'string', 'x-brand': "B'x" },
          b: { $ref: '#/components/schemas/b' },
        },
      },
      b: { type: 'object', properties: { c: { $ref: '#/components/schemas/c' } } },
      c: { type: 'object', properties: { a: { $ref: '#/components/schemas/a' } } },
    } as unknown as { readonly [k: string]: Schema })
    expect(code).toContain("__brand: 'B\\'x'")
    expect(code).toContain('"b":t.Optional(t.Ref("b"))')
    expect(parseSync('schemas.ts', code).errors).toStrictEqual([])
  })

  it('quotes a module key and a ref with a quote in it', () => {
    const code = schemasCode({
      "it's": { type: 'object', properties: { b: { $ref: '#/components/schemas/b' } } },
      b: { type: 'object', properties: { c: { $ref: '#/components/schemas/c' } } },
      c: { type: 'object', properties: { a: { $ref: "#/components/schemas/it's" } } },
    })
    expect(parseSync('schemas.ts', code).errors).toStrictEqual([])
    expect(code).toContain('"it\'s":t.Object(')
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

// Every generator names a schema by its key, so the rename is made once over the whole document:
// the key in `components.schemas`, and every `$ref` to it wherever the document holds one.
describe('uniqueSchemaKeys', () => {
  const ref = { $ref: '#/components/schemas/user' } as const
  const to = { $ref: '#/components/schemas/User2' } as const
  const document = (schema: object, example: object) =>
    ({
      openapi: '3.1.0',
      info: { title: 'Collide', version: '1' },
      paths: {
        '/users': {
          get: {
            parameters: [{ name: 'filter', in: 'query', schema }],
            requestBody: { content: { 'application/json': { schema, example } } },
            responses: {
              default: { description: 'any', content: { 'application/json': { schema } } },
            },
          },
        },
      },
      components: {
        schemas: {
          User: { type: 'string' },
          user: { type: 'object', properties: { self: schema } },
          Pet: {
            oneOf: [schema],
            discriminator: {
              propertyName: 'kind',
              mapping: { a: '#/components/schemas/user', b: 'user', c: 'User', d: 'other' },
            },
          },
        },
        responses: { Missing: { description: 'missing', content: { 'text/plain': { schema } } } },
        examples: { Sample: { value: example } },
      },
    }) as unknown as OpenAPI

  it('renames the key and every $ref to it, and leaves examples as the data they are', () => {
    const renamed = uniqueSchemaKeys(document(ref, ref))
    const expected = document(to, ref)
    expect(renamed).toStrictEqual({
      ...expected,
      components: {
        ...expected.components,
        schemas: {
          User: { type: 'string' },
          User2: { type: 'object', properties: { self: to } },
          Pet: {
            oneOf: [to],
            discriminator: {
              propertyName: 'kind',
              mapping: { a: '#/components/schemas/User2', b: 'User2', c: 'User', d: 'other' },
            },
          },
        },
      },
    })
  })

  // `mapping` is a discriminator's only inside a discriminator: a property, a `dependentRequired`
  // entry or a security requirement called `mapping` is left as it is.
  it('renames a mapping and a defaultMapping only inside a discriminator', () => {
    const doc = {
      openapi: '3.2.0',
      info: { title: 'Mapping', version: '1' },
      paths: {},
      security: [{ mapping: ['read'] }],
      servers: [{ url: '/', variables: { mapping: { default: 'user' } } }],
      components: {
        schemas: {
          User: { type: 'string' },
          user: { type: 'number' },
          Form: {
            type: 'object',
            properties: { mapping: { type: 'string' } },
            dependentRequired: { mapping: ['target'] },
            discriminator: { propertyName: 'kind', defaultMapping: '#/components/schemas/user' },
          },
        },
      },
    } as unknown as OpenAPI
    const renamed = uniqueSchemaKeys(doc)
    expect(renamed.security).toStrictEqual([{ mapping: ['read'] }])
    expect(renamed.servers).toStrictEqual(doc.servers)
    expect(renamed.components?.schemas?.Form).toStrictEqual({
      type: 'object',
      properties: { mapping: { type: 'string' } },
      dependentRequired: { mapping: ['target'] },
      discriminator: { propertyName: 'kind', defaultMapping: '#/components/schemas/User2' },
    })
  })

  it('keeps a key that already is the suffixed name of another', () => {
    expect([
      ...schemaConstNames({
        User: { type: 'string' },
        user: { type: 'number' },
        User2: { type: 'boolean' },
      }),
    ]).toStrictEqual([
      ['User', 'UserSchema'],
      ['user', 'User3Schema'],
      ['User2', 'User2Schema'],
    ])
  })

  it('leaves a non-schema $ref alone when the empty key is renamed', () => {
    const missing = { $ref: '#/components/responses/Missing' } as const
    const unique = uniqueSchemas({
      Schema: { type: 'string' },
      '': { type: 'number' },
      Holder: { type: 'object', properties: { x: missing } },
    })
    expect(unique.Holder).toStrictEqual({ type: 'object', properties: { x: missing } })
  })

  it('follows a $ref under a dependencies entry named like a data keyword', () => {
    const unique = uniqueSchemas({
      User: { type: 'string' },
      user: { type: 'number' },
      Dep: { dependencies: { default: { $ref: '#/components/schemas/user' } } },
    } as unknown as { readonly [k: string]: Schema })
    expect(unique.Dep as unknown).toStrictEqual({
      dependencies: { default: { $ref: '#/components/schemas/User2' } },
    })
  })

  it('points a $ref to the renamed empty key, and a pointer into a renamed key, at the new key', () => {
    const unique = uniqueSchemas({
      Schema: { type: 'string' },
      '': { type: 'number' },
      user: { type: 'object', properties: { x: { type: 'string' } } },
      User: { type: 'string' },
      Holder: {
        type: 'object',
        properties: {
          empty: { $ref: '#/components/schemas/' },
          deep: { $ref: '#/components/schemas/User/properties/x' },
          deeper: { $ref: '#/components/schemas/Schema' },
        },
      },
    })
    expect(Object.keys(unique)).toStrictEqual(['Schema', 'Schema2', 'user', 'User2', 'Holder'])
    expect(unique.Holder).toStrictEqual({
      type: 'object',
      properties: {
        empty: { $ref: '#/components/schemas/Schema2' },
        deep: { $ref: '#/components/schemas/User2/properties/x' },
        deeper: { $ref: '#/components/schemas/Schema' },
      },
    })
  })

  it('leaves the values of a link and of an extension as the data they are', () => {
    const doc = {
      openapi: '3.1.0',
      info: { title: 'Links', version: '1' },
      paths: {
        '/users': {
          get: {
            'x-sample': ref,
            responses: {
              '200': { description: 'ok', links: { Next: { operationId: 'n', requestBody: ref } } },
            },
          },
        },
      },
      components: {
        schemas: { User: { type: 'string' }, user: { type: 'number' } },
        links: { Self: { operationId: 's', parameters: { id: ref } } },
      },
    } as unknown as OpenAPI
    const renamed = uniqueSchemaKeys(doc)
    expect(renamed.paths).toStrictEqual(doc.paths)
    expect(renamed.components?.links).toStrictEqual(doc.components?.links)
  })

  it('returns a document without colliding keys, or without schemas, as it is', () => {
    const plain = {
      openapi: '3.1.0',
      info: { title: 'Plain', version: '1' },
      paths: {},
      components: { schemas: { User: { type: 'string' }, user_profile: { type: 'string' } } },
    } as unknown as OpenAPI
    expect(uniqueSchemaKeys(plain)).toBe(plain)
    const bare = { openapi: '3.1.0', info: { title: 'Bare', version: '1' }, paths: {} } as OpenAPI
    expect(uniqueSchemaKeys(bare)).toBe(bare)
  })
})

// A dependent schema is checked inside the `.Decode` closure, which runs after every const exists:
// it names the const, since a `t.Ref` or `Self` there resolves to nothing outside its scope.
describe('schemasCode — a dependent schema inside its own recursive group', () => {
  const dependent = (target: string) =>
    ({
      dependentSchemas: { k: { $ref: `#/components/schemas/${target}` } },
      'x-dependentSchemas-message': 'k needs its schema',
    }) as const
  const load = async (code: string) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-dependent-'))
    const file = path.join(dir, 'schemas.ts')
    writeFileSync(
      file,
      // The file sits outside the package, so TypeBox is imported by where it resolves from here.
      `import { Type as t } from '${import.meta.resolve('@sinclair/typebox')}'\nimport { Value } from '${import.meta.resolve('@sinclair/typebox/value')}'\n${code}\n`,
    )
    try {
      return (await import(file)) as { readonly [name: string]: Parameters<typeof Value.Decode>[0] }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('names the const of a member of a module', async () => {
    const code = schemasCode({
      A: {
        type: 'object',
        properties: { b: { $ref: '#/components/schemas/B' }, k: { type: 'string' } },
        ...dependent('B'),
      },
      B: { type: 'object', properties: { c: { $ref: '#/components/schemas/C' } } },
      C: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
    } as unknown as { readonly [k: string]: Schema })
    expect(code).toContain('t.Module(')
    expect(code).toContain('const depSubs={"k":BSchema}')
    const { ASchema } = await load(code)
    if (!ASchema) throw new Error('ASchema is not exported')
    expect(Value.Decode(ASchema, { k: 'x', b: {} })).toStrictEqual({ k: 'x', b: {} })
  })

  it('names the const of a self-recursive schema', async () => {
    const code = schemasCode({
      T: {
        type: 'object',
        properties: { t: { $ref: '#/components/schemas/T' }, k: { type: 'string' } },
        ...dependent('T'),
      },
    } as unknown as { readonly [k: string]: Schema })
    expect(code).toContain('t.Optional(Self)')
    expect(code).toContain('const depSubs={"k":TSchema}')
    const { TSchema } = await load(code)
    if (!TSchema) throw new Error('TSchema is not exported')
    expect(Value.Decode(TSchema, { k: 'x' })).toStrictEqual({ k: 'x' })
  })

  it('names the const of a spoke of a star', () => {
    const code = schemasCode({
      Hub: {
        type: 'object',
        properties: { leaf: { $ref: '#/components/schemas/Leaf' }, k: { type: 'string' } },
        ...dependent('Leaf'),
      },
      Leaf: { type: 'object', properties: { hub: { $ref: '#/components/schemas/Hub' } } },
    } as unknown as { readonly [k: string]: Schema })
    expect(code).toContain('t.Recursive(')
    expect(code).toContain('const depSubs={"k":LeafSchema}')
  })
})
