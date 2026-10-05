import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import { edenChain, HTTP_METHODS, resolveOperationId } from '../../helper/index.js'
import type { OpenAPI, Operation } from '../../openapi/index.js'
import { toSafeIdentifier } from '../../utils/index.js'

function makeOperation(
  pathStr: string,
  method: (typeof HTTP_METHODS)[number],
  operation: Operation,
  client: string,
) {
  const funcName = toSafeIdentifier(resolveOperationId(operation, method, pathStr))
  const { callExpr, methodHostTypeExpr, paramArgs } = edenChain(pathStr, client, method)
  const sigParts = [
    ...paramArgs.map((p) => `${p.name}: ${p.typeExpr}`),
    `...args: Parameters<${methodHostTypeExpr}>`,
  ]
  return `export async function ${funcName}(${sigParts.join(', ')}) {\n  return ${callExpr}(...args)\n}`
}

export function eden(
  openAPI: OpenAPI,
  output: string,
  importPath: string,
  client: string,
  basePath?: string,
) {
  return Effect.gen(function* () {
    const prefix = basePath && basePath !== '/' ? basePath : ''
    const operations: string[] = []
    for (const [pathStr, pathItem] of Object.entries(openAPI.paths)) {
      if (!pathItem) continue
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method]
        if (!operation) continue
        operations.push(makeOperation(`${prefix}${pathStr}`, method, operation, client))
      }
    }
    if (operations.length === 0) return 'No operations found'
    const header = `import { ${client} } from '${importPath}'\n\n`
    const body = `${operations.join('\n\n')}\n`
    yield* emit(`${header}${body}`, path.dirname(output), output)
    return `Generated eden code written to ${output}`
  })
}
