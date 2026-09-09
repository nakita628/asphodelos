import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import { edenChain, HTTP_METHODS, resolveOperationId } from '../../helper/index.js'
import { pathEntries } from '../../openapi/index.js'
import type { OpenAPI, Operation } from '../../openapi/index.js'
import { toSafeIdentifier } from '../../utils/index.js'

export function makeJsDocs(
  method: (typeof HTTP_METHODS)[number],
  pathStr: string,
  operation: Operation,
) {
  const blocks: string[][] = []
  if (operation.summary) blocks.push([operation.summary])
  if (operation.description) blocks.push(operation.description.split('\n'))
  blocks.push([`${method.toUpperCase()} ${pathStr}`])
  const tagLines: string[] = []
  if (operation.deprecated) tagLines.push('@deprecated')
  if (tagLines.length > 0) blocks.push(tagLines)
  const body = blocks
    .map((lines) => lines.map((l) => (l === '' ? ' *' : ` * ${l}`)).join('\n'))
    .join('\n *\n')
  return `/**\n${body}\n */`
}

function makeOperation(
  pathStr: string,
  method: (typeof HTTP_METHODS)[number],
  operation: Operation,
  client: string,
  docs: boolean,
) {
  const funcName = toSafeIdentifier(resolveOperationId(operation, method, pathStr))
  const { callExpr, methodHostTypeExpr, paramArgs } = edenChain(pathStr, client, method)
  const sigParts = [
    ...paramArgs.map((p) => `${p.name}: ${p.typeExpr}`),
    `...args: Parameters<${methodHostTypeExpr}>`,
  ]
  const fn = `export async function ${funcName}(${sigParts.join(', ')}) {\n  return ${callExpr}(...args)\n}`
  return docs ? `${makeJsDocs(method, pathStr, operation)}\n${fn}` : fn
}

export function eden(
  openAPI: OpenAPI,
  output: string,
  importPath: string,
  client: string,
  basePath?: string,
  docs = false,
) {
  return Effect.gen(function* () {
    const prefix = basePath && basePath !== '/' ? basePath : ''
    const operations: string[] = []
    for (const [pathStr, pathItem] of pathEntries(openAPI)) {
      if (!pathItem) continue
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method]
        if (!operation) continue
        operations.push(makeOperation(`${prefix}${pathStr}`, method, operation, client, docs))
      }
    }
    if (operations.length === 0) return 'No operations found'
    const header = `import { ${client} } from '${importPath}'\n\n`
    const body = `${operations.join('\n\n')}\n`
    yield* emit(`${header}${body}`, path.dirname(output), output)
    return `Generated eden code written to ${output}`
  })
}
