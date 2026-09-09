import { describe, expect, it } from 'bun:test'

import type { Operation, Parameter, RequestBody } from '../openapi/index.js'
import {
  bodyInfo,
  collectSchemaRefs,
  jsonSchema,
  makeParamsSchema,
  moduleComponentRefs,
  refSchemaName,
  responseInfo,
  sccSchemas,
  stringifyRefs,
  topoSortSchemas,
} from './schema.js'

describe('jsonSchema', () => {
  it('returns the application/json schema from a content map', () => {
    expect(jsonSchema({ 'application/json': { schema: { type: 'string' } } })).toStrictEqual({
      type: 'string',
    })
  })

  it('ignores non-json media types', () => {
    expect(
      jsonSchema({
        'application/xml': { schema: { type: 'integer' } },
        'application/json': { schema: { type: 'string' } },
      }),
    ).toStrictEqual({ type: 'string' })
  })

  it('returns undefined when application/json is absent', () => {
    expect(jsonSchema({ 'application/xml': { schema: { type: 'integer' } } })).toBeUndefined()
  })

  it('returns undefined when application/json has no schema', () => {
    expect(jsonSchema({ 'application/json': {} })).toBeUndefined()
  })

  it('returns undefined for undefined content', () => {
    expect(jsonSchema(undefined)).toBeUndefined()
  })

  it('returns undefined for empty content map', () => {
    expect(jsonSchema({})).toBeUndefined()
  })

  it('accepts entries that look like Reference (no schema field)', () => {
    expect(jsonSchema({ 'application/json': { $ref: '#/components/x' } })).toBeUndefined()
  })
})

describe('refSchemaName', () => {
  it('extracts bare name from #/components/schemas/Name', () => {
    expect(refSchemaName({ $ref: '#/components/schemas/Pet' })).toBe('Pet')
  })

  it('preserves names with dots / hyphens / underscores', () => {
    expect(refSchemaName({ $ref: '#/components/schemas/pet.entity' })).toBe('pet.entity')
    expect(refSchemaName({ $ref: '#/components/schemas/pet-entity' })).toBe('pet-entity')
    expect(refSchemaName({ $ref: '#/components/schemas/pet_entity' })).toBe('pet_entity')
  })

  it('returns null for refs outside #/components/schemas/', () => {
    expect(refSchemaName({ $ref: '#/components/parameters/X' })).toBeNull()
    expect(refSchemaName({ $ref: '#/components/responses/X' })).toBeNull()
  })

  it('returns null when $ref is missing', () => {
    expect(refSchemaName({ type: 'string' })).toBeNull()
  })

  it('returns null when schema is undefined', () => {
    expect(refSchemaName(undefined)).toBeNull()
  })

  it('returns null for an empty trailing segment', () => {
    expect(refSchemaName({ $ref: '#/components/schemas/' })).toBeNull()
  })
})

describe('bodyInfo', () => {
  const op = (requestBody: Operation['requestBody']): Operation => ({
    responses: {},
    requestBody,
  })

  it('returns {} when the operation has no request body', () => {
    expect(bodyInfo(op(undefined))).toStrictEqual({})
  })

  it('returns {} when the request body is itself a Reference', () => {
    expect(bodyInfo(op({ $ref: '#/components/requestBodies/Create' }))).toStrictEqual({})
  })

  it('returns { ref } when the json schema is a $ref to a component schema', () => {
    expect(
      bodyInfo(
        op({
          content: {
            'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
          },
        } satisfies RequestBody),
      ),
    ).toStrictEqual({ ref: 'Pet' })
  })

  it('returns { inline } when the json schema is an inline shape', () => {
    expect(
      bodyInfo(
        op({
          content: {
            'application/json': {
              schema: { type: 'object', properties: { id: { type: 'integer' } } },
            },
          },
        } satisfies RequestBody),
      ),
    ).toStrictEqual({ inline: { type: 'object', properties: { id: { type: 'integer' } } } })
  })

  it('returns {} when the body has no application/json content', () => {
    expect(
      bodyInfo(
        op({
          content: { 'application/xml': { schema: { type: 'string' } } },
        } satisfies RequestBody),
      ),
    ).toStrictEqual({})
  })

  it('hoists body-level x-* vendor extensions onto inline schema', () => {
    expect(
      bodyInfo(
        op({
          'x-required-message': 'body must be present',
          content: {
            'application/json': {
              schema: { type: 'object', properties: { id: { type: 'integer' } } },
            },
          },
        } satisfies RequestBody),
      ),
    ).toStrictEqual({
      inline: {
        'x-required-message': 'body must be present',
        type: 'object',
        properties: { id: { type: 'integer' } },
      },
    })
  })

  it('hoists media-level x-* vendor extensions onto inline schema', () => {
    expect(
      bodyInfo(
        op({
          content: {
            'application/json': {
              'x-minProperties-message': 'need at least one key',
              schema: { type: 'object' },
            },
          } as unknown as RequestBody['content'],
        } satisfies RequestBody),
      ),
    ).toStrictEqual({
      inline: {
        'x-minProperties-message': 'need at least one key',
        type: 'object',
      },
    })
  })

  it('schema-level x-* overrides body / media level when both set', () => {
    expect(
      bodyInfo(
        op({
          'x-required-message': 'from body',
          content: {
            'application/json': {
              'x-required-message': 'from media',
              schema: { type: 'object', 'x-required-message': 'from schema' },
            },
          } as unknown as RequestBody['content'],
        } satisfies RequestBody),
      ),
    ).toStrictEqual({
      inline: { type: 'object', 'x-required-message': 'from schema' },
    })
  })

  it('ignores body-level x-* when the body resolves to a ref', () => {
    expect(
      bodyInfo(
        op({
          'x-required-message': 'ignored',
          content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
        } satisfies RequestBody),
      ),
    ).toStrictEqual({ ref: 'Pet' })
  })

  it('returns multipart/form-data ctx for inline body schema (without mutating it)', () => {
    // Elysia requires `t.Form({...})` instead of `t.Object({...})` for
    // multipart bodies (FormData→Object coerce). The downstream emitter
    // dispatches on `ctx.mediaType` returned alongside the schema —
    // the schema itself is left untouched so it remains a faithful
    // OpenAPI value.
    expect(
      bodyInfo(
        op({
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' } },
              },
            },
          },
        } satisfies RequestBody),
      ),
    ).toStrictEqual({
      inline: {
        type: 'object',
        required: ['file'],
        properties: { file: { type: 'string', format: 'binary' } },
      },
      ctx: { mediaType: 'multipart/form-data' },
    })
  })

  it('returns application/octet-stream ctx for inline raw-bytes body schema', () => {
    expect(
      bodyInfo(
        op({
          content: {
            'application/octet-stream': {
              schema: { type: 'string', format: 'binary' },
            },
          },
        } satisfies RequestBody),
      ),
    ).toStrictEqual({
      inline: { type: 'string', format: 'binary' },
      ctx: { mediaType: 'application/octet-stream' },
    })
  })

  it('JSON body inline schema has NO ctx (default object emitter path)', () => {
    // `application/json` does not need a hint: `t.Object` / `t.String`
    // is already the correct default. JSON returns no ctx so the model
    // emission stays plain.
    expect(
      bodyInfo(
        op({
          content: {
            'application/json': {
              schema: { type: 'object', properties: { id: { type: 'integer' } } },
            },
          },
        } satisfies RequestBody),
      ),
    ).toStrictEqual({
      inline: { type: 'object', properties: { id: { type: 'integer' } } },
    })
  })

  it('prefers application/json over multipart when both are present', () => {
    // JSON has priority over multipart in `bodyInfo`'s media-type selector,
    // matching the OpenAPI client convention of routing JSON first when
    // the server offers both.
    expect(
      bodyInfo(
        op({
          content: {
            'application/json': {
              schema: { type: 'object', properties: { id: { type: 'integer' } } },
            },
            'multipart/form-data': {
              schema: { type: 'object', properties: { file: { type: 'string' } } },
            },
          },
        } satisfies RequestBody),
      ),
    ).toStrictEqual({
      inline: { type: 'object', properties: { id: { type: 'integer' } } },
    })
  })

  it('falls back to multipart/form-data when application/json is absent', () => {
    expect(
      bodyInfo(
        op({
          content: {
            'multipart/form-data': {
              schema: { type: 'object', properties: { file: { type: 'string' } } },
            },
          },
        } satisfies RequestBody),
      ),
    ).toStrictEqual({
      inline: {
        type: 'object',
        properties: { file: { type: 'string' } },
      },
      ctx: { mediaType: 'multipart/form-data' },
    })
  })
})

describe('makeParamsSchema', () => {
  it('returns undefined when no parameter matches the location', () => {
    expect(makeParamsSchema([], 'query')).toBeUndefined()
  })

  it('returns undefined when only refs are passed', () => {
    expect(makeParamsSchema([{ $ref: '#/components/parameters/X' }], 'query')).toBeUndefined()
  })

  it('builds a composite object from parameters of one location (query → parameterLocation ctx)', () => {
    const param: Parameter = {
      name: 'page',
      in: 'query',
      schema: { type: 'integer' },
    }
    expect(makeParamsSchema([param], 'query')).toStrictEqual({
      schema: {
        type: 'object',
        properties: { page: { type: 'integer' } },
      },
      ctx: { parameterLocation: 'query' },
    })
  })

  it('adds required[] entries when parameters are marked required', () => {
    const param: Parameter = {
      name: 'page',
      in: 'query',
      required: true,
      schema: { type: 'integer' },
    }
    expect(makeParamsSchema([param], 'query')).toStrictEqual({
      schema: {
        type: 'object',
        properties: { page: { type: 'integer' } },
        required: ['page'],
      },
      ctx: { parameterLocation: 'query' },
    })
  })

  it('hoists inner-schema x-* extensions onto the parent t.Object', () => {
    const param: Parameter = {
      name: 'flag',
      in: 'query',
      required: true,
      schema: { type: 'string', 'x-required-message': 'flag is required' },
    }
    expect(makeParamsSchema([param], 'query')).toStrictEqual({
      schema: {
        type: 'object',
        properties: { flag: { type: 'string', 'x-required-message': 'flag is required' } },
        required: ['flag'],
        'x-required-message': 'flag is required',
      },
      ctx: { parameterLocation: 'query' },
    })
  })

  it('hoists parameter-level x-* extensions onto the parent t.Object', () => {
    const param: Parameter = {
      name: 'flag',
      in: 'query',
      required: true,
      schema: { type: 'string' },
      'x-required-message': 'flag is required',
    }
    expect(makeParamsSchema([param], 'query')).toStrictEqual({
      schema: {
        type: 'object',
        properties: { flag: { type: 'string' } },
        required: ['flag'],
        'x-required-message': 'flag is required',
      },
      ctx: { parameterLocation: 'query' },
    })
  })

  it('first-non-undefined-wins across multiple parameters with same key', () => {
    const a: Parameter = {
      name: 'a',
      in: 'query',
      required: true,
      schema: { type: 'string', 'x-required-message': 'first' },
    }
    const b: Parameter = {
      name: 'b',
      in: 'query',
      required: true,
      schema: { type: 'string', 'x-required-message': 'second' },
    }
    expect(makeParamsSchema([a, b], 'query')).toStrictEqual({
      schema: {
        type: 'object',
        properties: {
          a: { type: 'string', 'x-required-message': 'first' },
          b: { type: 'string', 'x-required-message': 'second' },
        },
        required: ['a', 'b'],
        'x-required-message': 'first',
      },
      ctx: { parameterLocation: 'query' },
    })
  })

  it('parameter-level x-* takes precedence over inner-schema x-*', () => {
    const param: Parameter = {
      name: 'flag',
      in: 'query',
      schema: { type: 'string', 'x-required-message': 'inner' },
      'x-required-message': 'outer',
    }
    expect(makeParamsSchema([param], 'query')).toStrictEqual({
      schema: {
        type: 'object',
        properties: { flag: { type: 'string', 'x-required-message': 'inner' } },
        'x-required-message': 'outer',
      },
      ctx: { parameterLocation: 'query' },
    })
  })

  it('filters out parameters from other locations', () => {
    const inQuery: Parameter = { name: 'a', in: 'query', schema: { type: 'string' } }
    const inHeader: Parameter = { name: 'b', in: 'header', schema: { type: 'string' } }
    expect(makeParamsSchema([inQuery, inHeader], 'query')).toStrictEqual({
      schema: {
        type: 'object',
        properties: { a: { type: 'string' } },
      },
      ctx: { parameterLocation: 'query' },
    })
  })

  it('keeps object-typed in:query parameter schema untouched and exposes parameterLocation ctx', () => {
    // The schema returned is the faithful OpenAPI shape. Downstream the
    // typebox emitter consumes `ctx.parameterLocation === 'query'` and
    // promotes every `type:object` property to t.ObjectString — without
    // mutating the schema with an internal vendor extension.
    const param: Parameter = {
      name: 'filter',
      in: 'query',
      schema: {
        type: 'object',
        properties: { kind: { type: 'string' } },
      },
    }
    expect(makeParamsSchema([param], 'query')).toStrictEqual({
      schema: {
        type: 'object',
        properties: {
          filter: {
            type: 'object',
            properties: { kind: { type: 'string' } },
          },
        },
      },
      ctx: { parameterLocation: 'query' },
    })
  })

  it('does NOT emit parameterLocation ctx for in:path / in:header parameters', () => {
    const inPath: Parameter = {
      name: 'filter',
      in: 'path',
      schema: { type: 'object', properties: { kind: { type: 'string' } } },
    }
    expect(makeParamsSchema([inPath], 'path')).toStrictEqual({
      schema: {
        type: 'object',
        properties: {
          filter: { type: 'object', properties: { kind: { type: 'string' } } },
        },
      },
    })
  })

  it('marks the cookie container with elysiaKind: cookie ctx', () => {
    // The synthesized `*Cookie` schema becomes `t.Cookie({...})` so Eden
    // Treaty types it as a typed cookie. No `secrets` option is set.
    const param: Parameter = {
      name: 'session',
      in: 'cookie',
      schema: { type: 'string' },
    }
    expect(makeParamsSchema([param], 'cookie')).toStrictEqual({
      schema: {
        type: 'object',
        properties: { session: { type: 'string' } },
      },
      ctx: { elysiaKind: 'cookie' },
    })
  })

  it('does NOT emit any ctx for in:header containers', () => {
    const param: Parameter = { name: 'a', in: 'header', schema: { type: 'string' } }
    expect(makeParamsSchema([param], 'header')).toStrictEqual({
      schema: {
        type: 'object',
        properties: { a: { type: 'string' } },
      },
    })
  })
})

describe('responseInfo', () => {
  it('returns { void } when the response has no content', () => {
    expect(responseInfo({ description: 'no body' })).toStrictEqual({ void: true })
  })

  it('returns { void } when application/json is absent', () => {
    expect(
      responseInfo({
        description: 'xml',
        content: { 'application/xml': { schema: { type: 'string' } } },
      }),
    ).toStrictEqual({ void: true })
  })

  it('returns { ref } for a $ref schema', () => {
    expect(
      responseInfo({
        description: 'r',
        content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
      }),
    ).toStrictEqual({ ref: 'Pet' })
  })

  it('returns { inline } for an inline schema', () => {
    expect(
      responseInfo({
        description: 'r',
        content: { 'application/json': { schema: { type: 'integer' } } },
      }),
    ).toStrictEqual({ inline: { type: 'integer' } })
  })
})

describe('collectSchemaRefs', () => {
  it('returns empty set for primitives', () => {
    expect([...collectSchemaRefs({ type: 'string' })]).toStrictEqual([])
  })

  it('extracts top-level $ref', () => {
    expect([...collectSchemaRefs({ $ref: '#/components/schemas/Pet' })]).toStrictEqual(['Pet'])
  })

  it('walks into properties', () => {
    expect([
      ...collectSchemaRefs({
        type: 'object',
        properties: { owner: { $ref: '#/components/schemas/User' } },
      }),
    ]).toStrictEqual(['User'])
  })

  it('walks into array items', () => {
    expect([
      ...collectSchemaRefs({
        type: 'array',
        items: { $ref: '#/components/schemas/Pet' },
      }),
    ]).toStrictEqual(['Pet'])
  })

  it('walks into oneOf/anyOf/allOf', () => {
    expect(
      [
        ...collectSchemaRefs({
          oneOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
        }),
      ].toSorted(),
    ).toStrictEqual(['A', 'B'])
  })

  it('ignores non-component refs', () => {
    expect([...collectSchemaRefs({ $ref: '#/components/parameters/X' })]).toStrictEqual([])
  })

  it('walks into allOf sub-schemas', () => {
    expect(
      [
        ...collectSchemaRefs({
          allOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
        }),
      ].toSorted(),
    ).toStrictEqual(['A', 'B'])
  })

  it('walks into anyOf sub-schemas', () => {
    expect(
      [
        ...collectSchemaRefs({
          anyOf: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
        }),
      ].toSorted(),
    ).toStrictEqual(['A', 'B'])
  })

  it('walks into not sub-schema', () => {
    expect([
      ...collectSchemaRefs({ not: { $ref: '#/components/schemas/Forbidden' } }),
    ]).toStrictEqual(['Forbidden'])
  })

  it('walks into prefixItems sub-schemas', () => {
    expect(
      [
        ...collectSchemaRefs({
          type: 'array',
          prefixItems: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
        }),
      ].toSorted(),
    ).toStrictEqual(['A', 'B'])
  })

  it('walks into items when items is an array (tuple form)', () => {
    expect(
      [
        ...collectSchemaRefs({
          type: 'array',
          items: [{ $ref: '#/components/schemas/A' }, { $ref: '#/components/schemas/B' }],
        }),
      ].toSorted(),
    ).toStrictEqual(['A', 'B'])
  })

  it('walks into additionalProperties when it is an object schema', () => {
    expect([
      ...collectSchemaRefs({
        type: 'object',
        additionalProperties: { $ref: '#/components/schemas/Extra' },
      }),
    ]).toStrictEqual(['Extra'])
  })

  it('walks patternProperties / propertyNames / dependentSchemas / contains (JSON Schema 2020-12)', () => {
    expect(
      [
        ...collectSchemaRefs({
          type: 'object',
          patternProperties: {
            '^x-': { $ref: '#/components/schemas/A' },
          },
          propertyNames: { $ref: '#/components/schemas/B' },
          dependentSchemas: {
            k: { $ref: '#/components/schemas/C' },
          },
          contains: { $ref: '#/components/schemas/D' },
        }),
      ].toSorted(),
    ).toStrictEqual(['A', 'B', 'C', 'D'])
  })
})

describe('topoSortSchemas', () => {
  it('orders dependencies before dependents', () => {
    const result = topoSortSchemas([
      {
        name: 'Pets',
        schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
      },
      { name: 'Pet', schema: { type: 'object', properties: { id: { type: 'integer' } } } },
    ])
    expect(result.map((r) => r.name)).toStrictEqual(['Pet', 'Pets'])
  })

  it('handles independent schemas in input order', () => {
    const result = topoSortSchemas([
      { name: 'A', schema: { type: 'string' } },
      { name: 'B', schema: { type: 'number' } },
    ])
    expect(result.map((r) => r.name)).toStrictEqual(['A', 'B'])
  })

  it('breaks self-referential cycles without infinite recursion', () => {
    const result = topoSortSchemas([
      {
        name: 'Node',
        schema: {
          type: 'object',
          properties: { next: { $ref: '#/components/schemas/Node' } },
        },
      },
    ])
    expect(result.map((r) => r.name)).toStrictEqual(['Node'])
  })
})

describe('stringifyRefs — primitives', () => {
  it('returns "null" for null', () => {
    expect(stringifyRefs(null)).toBe('null')
  })

  it('returns "undefined" for undefined', () => {
    expect(stringifyRefs(undefined)).toBe('undefined')
  })

  it('quotes strings via JSON.stringify', () => {
    expect(stringifyRefs('hello')).toBe('"hello"')
  })

  it('escapes special characters in strings', () => {
    expect(stringifyRefs('a"b\\c')).toBe('"a\\"b\\\\c"')
  })

  it('emits numbers verbatim', () => {
    expect(stringifyRefs(42)).toBe('42')
    expect(stringifyRefs(3.14)).toBe('3.14')
    expect(stringifyRefs(0)).toBe('0')
    expect(stringifyRefs(-1)).toBe('-1')
  })

  it('emits booleans verbatim', () => {
    expect(stringifyRefs(true)).toBe('true')
    expect(stringifyRefs(false)).toBe('false')
  })
})

describe('stringifyRefs — arrays', () => {
  it('renders empty arrays as []', () => {
    expect(stringifyRefs([])).toBe('[]')
  })

  it('renders primitive arrays without spaces', () => {
    expect(stringifyRefs([1, 'two', true, null])).toBe('[1,"two",true,null]')
  })

  it('rewrites $ref objects nested in arrays to bare identifiers', () => {
    expect(stringifyRefs([{ $ref: '#/components/schemas/Pet' }, { type: 'string' }])).toBe(
      '[PetSchema,{"type":"string"}]',
    )
  })
})

describe('stringifyRefs — plain objects', () => {
  it('renders empty objects as {}', () => {
    expect(stringifyRefs({})).toBe('{}')
  })

  it('quotes keys and recurses into values', () => {
    expect(stringifyRefs({ a: 1, b: 'x' })).toBe('{"a":1,"b":"x"}')
  })

  it('preserves objects whose only property happens to be named $ref but is not a string', () => {
    expect(stringifyRefs({ $ref: 42 })).toBe('{"$ref":42}')
  })

  it('preserves $ref values that do not match the components pattern', () => {
    expect(stringifyRefs({ $ref: '#/definitions/Pet' })).toBe('{"$ref":"#/definitions/Pet"}')
  })

  it('preserves $ref values for unknown component kinds', () => {
    expect(stringifyRefs({ $ref: '#/components/unknown/Pet' })).toBe(
      '{"$ref":"#/components/unknown/Pet"}',
    )
  })
})

describe('stringifyRefs — $ref rewriting per kind', () => {
  it('rewrites schemas refs to <Name>Schema', () => {
    expect(stringifyRefs({ $ref: '#/components/schemas/Pet' })).toBe('PetSchema')
  })

  it('rewrites parameters refs to <Name>ParamsSchema', () => {
    expect(stringifyRefs({ $ref: '#/components/parameters/PetId' })).toBe('PetIdParamsSchema')
  })

  it('rewrites headers refs to <Name>HeaderSchema', () => {
    expect(stringifyRefs({ $ref: '#/components/headers/RateLimit' })).toBe('RateLimitHeaderSchema')
  })

  it('rewrites securitySchemes refs to <Name>SecurityScheme', () => {
    expect(stringifyRefs({ $ref: '#/components/securitySchemes/bearerAuth' })).toBe(
      'BearerAuthSecurityScheme',
    )
  })

  it('rewrites requestBodies refs to <Name>RequestBodySchema', () => {
    expect(stringifyRefs({ $ref: '#/components/requestBodies/PetBody' })).toBe(
      'PetBodyRequestBodySchema',
    )
  })

  it('rewrites responses refs to <Name>ResponseSchema', () => {
    expect(stringifyRefs({ $ref: '#/components/responses/PetList' })).toBe('PetListResponseSchema')
  })

  it('rewrites examples refs to <Name>Example', () => {
    expect(stringifyRefs({ $ref: '#/components/examples/PetSample' })).toBe('PetSampleExample')
  })

  it('rewrites links refs to <Name>Link', () => {
    expect(stringifyRefs({ $ref: '#/components/links/GetPetById' })).toBe('GetPetByIdLink')
  })

  it('rewrites callbacks refs to <Name>Callback', () => {
    expect(stringifyRefs({ $ref: '#/components/callbacks/onPetUpdate' })).toBe(
      'OnPetUpdateCallback',
    )
  })

  it('rewrites pathItems refs to <Name>PathItem', () => {
    expect(stringifyRefs({ $ref: '#/components/pathItems/SharedPet' })).toBe('SharedPetPathItem')
  })

  it('rewrites mediaTypes refs to <Name>MediaTypeSchema', () => {
    expect(stringifyRefs({ $ref: '#/components/mediaTypes/PetJson' })).toBe(
      'PetJsonMediaTypeSchema',
    )
  })
})

describe('stringifyRefs — name handling', () => {
  it('PascalCases lower_snake names', () => {
    expect(stringifyRefs({ $ref: '#/components/schemas/pet_owner' })).toBe('PetOwnerSchema')
  })

  it('PascalCases kebab-cased names', () => {
    expect(stringifyRefs({ $ref: '#/components/schemas/pet-owner' })).toBe('PetOwnerSchema')
  })

  it('preserves PascalCase names', () => {
    expect(stringifyRefs({ $ref: '#/components/schemas/PetOwner' })).toBe('PetOwnerSchema')
  })
})

describe('stringifyRefs — nesting', () => {
  it('rewrites $ref nested inside object properties', () => {
    expect(
      stringifyRefs({
        operationId: 'getPet',
        responses: {
          '200': {
            content: {
              'application/json': { schema: { $ref: '#/components/schemas/Pet' } },
            },
          },
        },
      }),
    ).toBe(
      '{"operationId":"getPet","responses":{"200":{"content":{"application/json":{"schema":PetSchema}}}}}',
    )
  })

  it('rewrites multiple $refs across mixed kinds in the same value', () => {
    expect(
      stringifyRefs({
        body: { $ref: '#/components/requestBodies/PetBody' },
        responses: {
          '200': { $ref: '#/components/responses/PetList' },
          '404': { $ref: '#/components/responses/NotFound' },
        },
        parameters: [{ $ref: '#/components/parameters/PetId' }],
      }),
    ).toBe(
      '{"body":PetBodyRequestBodySchema,"responses":{"200":PetListResponseSchema,"404":NotFoundResponseSchema},"parameters":[PetIdParamsSchema]}',
    )
  })

  it('collapses to a bare identifier even when sibling fields exist alongside $ref', () => {
    expect(stringifyRefs({ $ref: '#/components/schemas/Pet', summary: 'override' })).toBe(
      'PetSchema',
    )
  })
})

describe('stringifyRefs — output is valid JS expression syntax', () => {
  it('does not insert whitespace between members (compact form)', () => {
    expect(stringifyRefs({ a: 1, b: [2, 3], c: { d: 'x' } })).toBe(
      '{"a":1,"b":[2,3],"c":{"d":"x"}}',
    )
  })
})

describe('sccSchemas', () => {
  it('groups mutually recursive 2-node cycle into a single SCC of size 2', () => {
    const groups = sccSchemas([
      {
        name: 'A',
        schema: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
      },
      {
        name: 'B',
        schema: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
      },
    ])
    expect(groups.length).toBe(1)
    expect(groups[0]?.length).toBe(2)
    const names = new Set(groups[0]?.map((m) => m.name))
    expect(names).toStrictEqual(new Set(['A', 'B']))
  })

  it('returns independent SCCs in reverse topological order (dependency before dependent)', () => {
    const groups = sccSchemas([
      { name: 'A', schema: { type: 'object', properties: { id: { type: 'string' } } } },
      {
        name: 'B',
        schema: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
      },
    ])
    expect(groups.map((g) => g.map((m) => m.name))).toStrictEqual([['A'], ['B']])
  })

  it('handles a 3-node cycle (A→B→C→A) as a single SCC of size 3', () => {
    const groups = sccSchemas([
      {
        name: 'A',
        schema: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
      },
      {
        name: 'B',
        schema: { type: 'object', properties: { c: { $ref: '#/components/schemas/C' } } },
      },
      {
        name: 'C',
        schema: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
      },
    ])
    expect(groups.length).toBe(1)
    expect(new Set(groups[0]?.map((m) => m.name))).toStrictEqual(new Set(['A', 'B', 'C']))
  })

  it('filters out $refs to schemas not in the input set', () => {
    const groups = sccSchemas([
      {
        name: 'A',
        schema: { type: 'object', properties: { ext: { $ref: '#/components/schemas/External' } } },
      },
    ])
    expect(groups).toStrictEqual([
      [
        {
          name: 'A',
          schema: {
            type: 'object',
            properties: { ext: { $ref: '#/components/schemas/External' } },
          },
        },
      ],
    ])
  })
})

describe('moduleComponentRefs', () => {
  it('collects direct route.bodyRef into the closure', () => {
    const closure = moduleComponentRefs([{ bodyRef: 'Pet', responses: [] }], [], new Set(['Pet']), {
      Pet: { type: 'object', properties: { id: { type: 'integer' } } },
    })
    expect(closure).toStrictEqual(new Set(['Pet']))
  })

  it("collects response.kind='ref' name into the closure", () => {
    const closure = moduleComponentRefs(
      [{ responses: [{ schema: { kind: 'ref', name: 'Error' } }] }],
      [],
      new Set(['Error']),
      { Error: { type: 'object', properties: { msg: { type: 'string' } } } },
    )
    expect(closure).toStrictEqual(new Set(['Error']))
  })

  it('collects $refs found inside inline schemas', () => {
    const closure = moduleComponentRefs(
      [],
      [
        {
          name: 'CreatePetBody',
          schema: {
            type: 'object',
            properties: { x: { $ref: '#/components/schemas/X' } },
          },
        },
      ],
      new Set(['X']),
      { X: { type: 'object' } },
    )
    expect(closure).toStrictEqual(new Set(['X']))
  })

  it('expands transitively (Pet -> Tag -> Category)', () => {
    const closure = moduleComponentRefs(
      [{ bodyRef: 'Pet', responses: [] }],
      [],
      new Set(['Pet', 'Tag', 'Category']),
      {
        Pet: {
          type: 'object',
          properties: { tag: { $ref: '#/components/schemas/Tag' } },
        },
        Tag: {
          type: 'object',
          properties: { category: { $ref: '#/components/schemas/Category' } },
        },
        Category: {
          type: 'object',
          properties: { name: { type: 'string' } },
        },
      },
    )
    expect(closure).toStrictEqual(new Set(['Pet', 'Tag', 'Category']))
  })

  it('filters out refs not present in componentNames', () => {
    const closure = moduleComponentRefs(
      [],
      [
        {
          name: 'Inline',
          schema: {
            type: 'object',
            properties: {
              x: { $ref: '#/components/schemas/X' },
              ext: { $ref: '#/components/schemas/External' },
            },
          },
        },
      ],
      new Set(['X']),
      { X: { type: 'object' } },
    )
    expect(closure).toStrictEqual(new Set(['X']))
  })

  it("ignores response.kind='void' entries", () => {
    const closure = moduleComponentRefs(
      [
        {
          responses: [{ schema: { kind: 'void' } }, { schema: { kind: 'ref', name: 'Pet' } }],
        },
      ],
      [],
      new Set(['Pet']),
      { Pet: { type: 'object' } },
    )
    expect(closure).toStrictEqual(new Set(['Pet']))
  })

  it('skips bodyRef whose component schema is missing (no crash, name not in closure)', () => {
    // `bodyRef: 'Missing'` is filtered at the direct-add step because
    // `componentNames` does not contain it — so the closure is empty.
    // This test also confirms the transitive loop tolerates an empty
    // queue without crashing.
    const closure = moduleComponentRefs(
      [{ bodyRef: 'Missing', responses: [] }],
      [],
      new Set<string>(),
      {},
    )
    expect(closure).toStrictEqual(new Set<string>())
  })

  it('tolerates bodyRef present in componentNames but missing from componentSchemas (continue branch)', () => {
    // Hits the `if (!def) continue` branch in the transitive expansion:
    // the name is added directly (because it's in componentNames) but
    // there is no schema definition to walk for further dependencies.
    const closure = moduleComponentRefs(
      [{ bodyRef: 'Missing', responses: [] }],
      [],
      new Set(['Missing']),
      {},
    )
    expect(closure).toStrictEqual(new Set(['Missing']))
  })
})
