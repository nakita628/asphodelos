function isIdentifierSegment(seg: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(seg)
}

function bracketKey(seg: string) {
  return `['${seg.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}']`
}

function accessSegment(seg: string) {
  return isIdentifierSegment(seg) ? `.${seg}` : bracketKey(seg)
}

export function edenChain(pathStr: string, client: string, method: string) {
  const segments = pathStr.split('/').filter(Boolean)
  const { callChain, typeChain, typeIsValue, typeChainHasBracket, paramArgs } = segments.reduce<{
    callChain: string
    typeChain: string
    typeIsValue: boolean
    typeChainHasBracket: boolean
    paramArgs: readonly { readonly name: string; readonly typeExpr: string }[]
  }>(
    (acc, seg) => {
      const m = /^\{([^}]+)\}$/.exec(seg)
      if (m) {
        const t = acc.typeIsValue ? `typeof ${acc.typeChain}` : acc.typeChain
        const name = acc.paramArgs.length === 0 ? 'params' : `params${acc.paramArgs.length + 1}`
        return {
          callChain: `${acc.callChain}(${name})`,
          typeChain: `ReturnType<${t}>`,
          typeIsValue: false,
          typeChainHasBracket: acc.typeChainHasBracket,
          paramArgs: [...acc.paramArgs, { name, typeExpr: `Parameters<${t}>[0]` }],
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
