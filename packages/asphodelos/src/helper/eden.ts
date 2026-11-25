import { elysiaPath } from './path-params.js'

function isIdentifierSegment(seg: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(seg)
}

function bracketKey(seg: string) {
  return `['${seg.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}']`
}

function accessSegment(seg: string) {
  return isIdentifierSegment(seg) ? `.${seg}` : bracketKey(seg)
}

/**
 * The Eden treaty call of one route, and the types it is read by. Treaty walks the route tree
 * Elysia keys on the path as the app registers it ({@link elysiaPath}), one key per segment: a
 * segment that starts with `:` is a parameter, called as a function, and any other is a property
 * of that spelling. So a segment with a parameter after its start, `/v{version}`, would be the
 * property `v:version`; such a key gets no wrapper or hook ({@link isTreatyPath}). A key with static
 * text after a parameter (`/{Sid}.json`) never reaches it either: the app leaves such a key out.
 */
export function edenChain(pathStr: string, client: string, method: string) {
  const segments = elysiaPath(pathStr).split('/').filter(Boolean)
  const { callChain, typeChain, typeIsValue, typeChainHasBracket, paramArgs } = segments.reduce<{
    callChain: string
    typeChain: string
    typeIsValue: boolean
    typeChainHasBracket: boolean
    paramArgs: readonly { readonly name: string; readonly typeExpr: string }[]
  }>(
    (acc, seg) => {
      if (seg.startsWith(':')) {
        const fnType = acc.typeIsValue ? `typeof ${acc.typeChain}` : acc.typeChain
        const name = acc.paramArgs.length === 0 ? 'params' : `params${acc.paramArgs.length + 1}`
        return {
          callChain: `${acc.callChain}(${name})`,
          typeChain: `ReturnType<${fnType}>`,
          typeIsValue: false,
          typeChainHasBracket: acc.typeChainHasBracket,
          paramArgs: [...acc.paramArgs, { name, typeExpr: `Parameters<${fnType}>[0]` }],
        }
      }
      const isIdent = isIdentifierSegment(seg)
      const valueTypeAccess = acc.typeChainHasBracket || !isIdent ? bracketKey(seg) : `.${seg}`
      return {
        callChain: `${acc.callChain}${accessSegment(seg)}`,
        typeChain: acc.typeIsValue
          ? `${acc.typeChain}${valueTypeAccess}`
          : `${acc.typeChain}${bracketKey(seg)}`,
        typeIsValue: acc.typeIsValue,
        typeChainHasBracket: acc.typeChainHasBracket || (acc.typeIsValue && !isIdent),
        paramArgs: acc.paramArgs,
      }
    },
    {
      callChain: client,
      typeChain: client,
      typeIsValue: true,
      typeChainHasBracket: false,
      paramArgs: [],
    },
  )
  const methodHostTypeExpr = typeIsValue
    ? typeChainHasBracket
      ? `typeof ${typeChain}${bracketKey(method)}`
      : `typeof ${typeChain}.${method}`
    : `${typeChain}['${method}']`
  return { callExpr: `${callChain}.${method}`, methodHostTypeExpr, paramArgs }
}
