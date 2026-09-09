import { describe, expect, it, spyOn } from 'bun:test'

import {
  headersCode,
  mediaTypesCode,
  parametersCode,
  requestBodiesCode,
  responsesCode,
} from './typeboxKinds.js'

describe('responsesCode', () => {
  it('returns empty string for undefined section', () => {
    expect(responsesCode(undefined)).toBe('')
  })

  it('returns empty string for empty section', () => {
    expect(responsesCode({})).toBe('')
  })

  it('emits t.Void() when response has no content', () => {
    expect(responsesCode({ NotFound: { description: 'Not Found' } })).toBe(
      'export const NotFoundResponseSchema=t.Void()',
    )
  })

  it('emits typebox expression for application/json content', () => {
    expect(
      responsesCode({
        Ok: {
          description: 'OK',
          content: { 'application/json': { schema: { type: 'string' } } },
        },
      }),
    ).toBe('export const OkResponseSchema=t.String()')
  })

  it('emits Static<typeof ...> alias when exportTypes=true (suffix without Schema)', () => {
    expect(responsesCode({ NotFound: { description: 'Not Found' } }, false, true)).toBe(
      'export const NotFoundResponseSchema=t.Void()\n\nexport type NotFoundResponse=Static<typeof NotFoundResponseSchema>',
    )
  })

  it('wraps with t.Readonly when readonly=true', () => {
    expect(
      responsesCode(
        {
          Ok: {
            description: 'OK',
            content: { 'application/json': { schema: { type: 'string' } } },
          },
        },
        true,
      ),
    ).toBe('export const OkResponseSchema=t.Readonly(t.String())')
  })

  it('omits export keyword when exported=false', () => {
    expect(responsesCode({ NotFound: { description: 'x' } }, false, false, false)).toBe(
      'const NotFoundResponseSchema=t.Void()',
    )
  })

  it('joins multiple entries with double newlines', () => {
    expect(
      responsesCode({
        A: { description: 'a' },
        B: { description: 'b' },
      }),
    ).toBe('export const AResponseSchema=t.Void()\n\nexport const BResponseSchema=t.Void()')
  })
})

describe('parametersCode', () => {
  it('emits typebox from parameter.schema', () => {
    expect(
      parametersCode({
        IdParam: { name: 'id', in: 'path', schema: { type: 'string' } },
      }),
    ).toBe('export const IdParamParamsSchema=t.String()')
  })

  it('emits t.Unknown() when parameter has no schema', () => {
    expect(parametersCode({ X: { name: 'x', in: 'header' } } as never)).toBe(
      'export const XParamsSchema=t.Unknown()',
    )
  })

  it('warns and emits t.Unknown() when parameter uses content field (OpenAPI 3.1)', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const result = parametersCode({
        Filter: {
          name: 'filter',
          in: 'query',
          content: { 'application/json': { schema: { type: 'object' } } },
        } as never,
      })
      expect(result).toBe('export const FilterParamsSchema=t.Unknown()')
      expect(warn).toHaveBeenCalledTimes(1)
      expect(warn.mock.calls[0]?.[0]).toBe(
        "asphodelos: Component parameter 'Filter' uses 'content' field (OpenAPI 3.1 alternative to 'schema'). This is not yet supported; emitting t.Unknown() placeholder.",
      )
    } finally {
      warn.mockRestore()
    }
  })

  it('PascalCases the parameter name in the ident', () => {
    expect(
      parametersCode({
        'kebab-case': { name: 'x', in: 'query', schema: { type: 'number' } },
      }),
    ).toBe('export const KebabCaseParamsSchema=t.Number()')
  })
})

describe('requestBodiesCode', () => {
  it('emits typebox from application/json content', () => {
    expect(
      requestBodiesCode({
        CreateUser: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: { name: { type: 'string' } },
                required: ['name'],
              },
            },
          },
        },
      }),
    ).toBe('export const CreateUserRequestBodySchema=t.Object({"name":t.String()})')
  })

  it('emits t.Unknown() for empty content', () => {
    expect(requestBodiesCode({ X: { content: {} } })).toBe(
      'export const XRequestBodySchema=t.Unknown()',
    )
  })
})

describe('headersCode', () => {
  it('emits alias to refIdent for top-level $ref', () => {
    expect(headersCode({ AuthHeader: { $ref: '#/components/headers/Other' } })).toBe(
      'export const AuthHeaderHeaderSchema=OtherHeaderSchema',
    )
  })

  it('emits typebox from header.schema', () => {
    expect(headersCode({ XReq: { schema: { type: 'string' } } })).toBe(
      'export const XReqHeaderSchema=t.String()',
    )
  })

  it('emits t.Unknown() when header has no schema', () => {
    expect(headersCode({ X: {} as never })).toBe('export const XHeaderSchema=t.Unknown()')
  })
})

describe('mediaTypesCode', () => {
  it('emits alias to refIdent for top-level $ref', () => {
    expect(mediaTypesCode({ Json: { $ref: '#/components/mediaTypes/Other' } })).toBe(
      'export const JsonMediaTypeSchema=OtherMediaTypeSchema',
    )
  })

  it('emits typebox from media.schema', () => {
    expect(mediaTypesCode({ Json: { schema: { type: 'string' } } })).toBe(
      'export const JsonMediaTypeSchema=t.String()',
    )
  })

  it('emits t.Unknown() when media has no schema', () => {
    expect(mediaTypesCode({ Json: {} as never })).toBe(
      'export const JsonMediaTypeSchema=t.Unknown()',
    )
  })
})
