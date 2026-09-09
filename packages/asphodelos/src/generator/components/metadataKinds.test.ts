import { describe, expect, it } from 'bun:test'

import {
  callbacksCode,
  examplesCode,
  linksCode,
  pathItemsCode,
  securitySchemesCode,
} from './metadataKinds.js'

describe('examplesCode', () => {
  it('returns empty string for undefined section', () => {
    expect(examplesCode(undefined)).toBe('')
  })

  it('returns empty string for empty section', () => {
    expect(examplesCode({})).toBe('')
  })

  it('emits `as const` literal for each example', () => {
    expect(examplesCode({ Hello: { value: 'hi' } })).toBe(
      'export const HelloExample={"value":"hi"} as const',
    )
  })

  it('emits bare alias for top-level $ref', () => {
    expect(examplesCode({ Foo: { $ref: '#/components/examples/Bar' } })).toBe(
      'export const FooExample=BarExample',
    )
  })

  it('omits export when exported=false', () => {
    expect(examplesCode({ Hello: { value: 'hi' } }, false)).toBe(
      'const HelloExample={"value":"hi"} as const',
    )
  })

  it('PascalCases entry names in the const ident', () => {
    expect(examplesCode({ 'hello-world': { value: 1 } })).toBe(
      'export const HelloWorldExample={"value":1} as const',
    )
  })
})

describe('securitySchemesCode', () => {
  it('emits `as const` literal for each scheme', () => {
    expect(
      securitySchemesCode({ ApiKey: { type: 'apiKey', name: 'X-Api-Key', in: 'header' } }),
    ).toBe(
      'export const ApiKeySecurityScheme={"type":"apiKey","name":"X-Api-Key","in":"header"} as const',
    )
  })

  it('emits bare alias for top-level $ref', () => {
    expect(securitySchemesCode({ X: { $ref: '#/components/securitySchemes/Y' } })).toBe(
      'export const XSecurityScheme=YSecurityScheme',
    )
  })
})

describe('linksCode', () => {
  it('emits `as const` literal for each link', () => {
    expect(
      linksCode({ GetUser: { operationId: 'getUser', parameters: { id: '$response.body#/id' } } }),
    ).toBe(
      'export const GetUserLink={"operationId":"getUser","parameters":{"id":"$response.body#/id"}} as const',
    )
  })

  it('emits bare alias for top-level $ref', () => {
    expect(linksCode({ X: { $ref: '#/components/links/Y' } })).toBe('export const XLink=YLink')
  })
})

describe('callbacksCode', () => {
  it('emits `as const` literal for each callback', () => {
    expect(
      callbacksCode({
        Cb: { '{$request.body#/url}': { post: { responses: { '200': { description: 'ok' } } } } },
      }),
    ).toBe(
      'export const CbCallback={"{$request.body#/url}":{"post":{"responses":{"200":{"description":"ok"}}}}} as const',
    )
  })

  it('emits bare alias for top-level $ref', () => {
    expect(callbacksCode({ X: { $ref: '#/components/callbacks/Y' } })).toBe(
      'export const XCallback=YCallback',
    )
  })

  it('rewrites nested $refs into bare identifiers', () => {
    expect(
      callbacksCode({
        Cb: {
          '{$request.body#/url}': {
            post: {
              responses: {},
              requestBody: {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Event' } } },
              },
            },
          },
        },
      } as never),
    ).toBe(
      'export const CbCallback={"{$request.body#/url}":{"post":{"responses":{},"requestBody":{"content":{"application/json":{"schema":EventSchema}}}}}} as const',
    )
  })
})

describe('pathItemsCode', () => {
  it('emits `as const` literal for each path item', () => {
    expect(
      pathItemsCode({ Health: { get: { responses: { '200': { description: 'ok' } } } } }),
    ).toBe(
      'export const HealthPathItem={"get":{"responses":{"200":{"description":"ok"}}}} as const',
    )
  })

  it('emits bare alias for top-level $ref', () => {
    expect(pathItemsCode({ X: { $ref: '#/components/pathItems/Y' } })).toBe(
      'export const XPathItem=YPathItem',
    )
  })
})
