import { describe, expect, it } from 'bun:test'

import { edenChain } from './eden.js'

describe('edenChain', () => {
  it('emits bare client.method chain for the root path', () => {
    expect(edenChain('/', 'app', 'get')).toStrictEqual({
      callExpr: 'app.get',
      methodHostTypeExpr: 'typeof app.get',
      paramArgs: [],
    })
  })

  it('appends literal segments as value chain', () => {
    expect(edenChain('/items', 'app', 'get')).toStrictEqual({
      callExpr: 'app.items.get',
      methodHostTypeExpr: 'typeof app.items.get',
      paramArgs: [],
    })
  })

  it('materializes a path param as `params` and switches the type chain to ReturnType', () => {
    expect(edenChain('/items/{id}', 'app', 'get')).toStrictEqual({
      callExpr: 'app.items(params).get',
      methodHostTypeExpr: "ReturnType<typeof app.items>['get']",
      paramArgs: [{ name: 'params', typeExpr: 'Parameters<typeof app.items>[0]' }],
    })
  })

  it('suffixes additional path params positionally (params, params2, ...)', () => {
    expect(edenChain('/a/{x}/b/{y}', 'app', 'post')).toStrictEqual({
      callExpr: 'app.a(params).b(params2).post',
      methodHostTypeExpr: "ReturnType<ReturnType<typeof app.a>['b']>['post']",
      paramArgs: [
        { name: 'params', typeExpr: 'Parameters<typeof app.a>[0]' },
        { name: 'params2', typeExpr: "Parameters<ReturnType<typeof app.a>['b']>[0]" },
      ],
    })
  })

  it('uses bracket lookup on the type chain once a path param has been consumed', () => {
    expect(edenChain('/users/{id}/posts', 'app', 'get')).toStrictEqual({
      callExpr: 'app.users(params).posts.get',
      methodHostTypeExpr: "ReturnType<typeof app.users>['posts']['get']",
      paramArgs: [{ name: 'params', typeExpr: 'Parameters<typeof app.users>[0]' }],
    })
  })

  it('drops empty segments from leading / trailing slashes', () => {
    expect(edenChain('//items//', 'app', 'get')).toStrictEqual({
      callExpr: 'app.items.get',
      methodHostTypeExpr: 'typeof app.items.get',
      paramArgs: [],
    })
  })

  it('honours custom client names', () => {
    expect(edenChain('/x', 'client', 'put')).toStrictEqual({
      callExpr: 'client.x.put',
      methodHostTypeExpr: 'typeof client.x.put',
      paramArgs: [],
    })
  })

  it('emits the method as bracket lookup once the chain has become a type', () => {
    const result = edenChain('/items/{id}', 'app', 'delete')
    expect(result.methodHostTypeExpr).toBe("ReturnType<typeof app.items>['delete']")
  })

  it('uses bracket access for hyphenated segments on both call and type chains', () => {
    expect(edenChain('/multi-auth', 'app', 'get')).toStrictEqual({
      callExpr: "app['multi-auth'].get",
      methodHostTypeExpr: "typeof app['multi-auth']['get']",
      paramArgs: [],
    })
  })

  it('switches the value type chain to all-bracket access after the first bracket segment', () => {
    expect(edenChain('/audio-features/info', 'app', 'get')).toStrictEqual({
      callExpr: "app['audio-features'].info.get",
      methodHostTypeExpr: "typeof app['audio-features']['info']['get']",
      paramArgs: [],
    })
  })

  it('keeps the value type chain dotted until the first bracket then switches', () => {
    expect(edenChain('/oauth2/v2.1/tokens/kid', 'app', 'get')).toStrictEqual({
      callExpr: "app.oauth2['v2.1'].tokens.kid.get",
      methodHostTypeExpr: "typeof app.oauth2['v2.1']['tokens']['kid']['get']",
      paramArgs: [],
    })
  })

  it('uses bracket access for hyphenated segments after a path param', () => {
    expect(edenChain('/users/{id}/multi-auth', 'app', 'post')).toStrictEqual({
      callExpr: "app.users(params)['multi-auth'].post",
      methodHostTypeExpr: "ReturnType<typeof app.users>['multi-auth']['post']",
      paramArgs: [{ name: 'params', typeExpr: 'Parameters<typeof app.users>[0]' }],
    })
  })

  it('escapes single quotes in non-identifier segments', () => {
    expect(edenChain("/a'b", 'app', 'get')).toStrictEqual({
      callExpr: "app['a\\'b'].get",
      methodHostTypeExpr: "typeof app['a\\'b']['get']",
      paramArgs: [],
    })
  })
})
