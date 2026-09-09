import type { Route } from '../../helper/index.js'
import { filterDefined, pascalCase, safeStatusKey, toSafeIdentifier } from '../../utils/index.js'

function schemaIdent(name: string) {
  return `${pascalCase(name)}Schema`
}

function join(entries: readonly (string | null)[], sep: string) {
  return filterDefined(entries).join(sep)
}

function toElysiaPath(p: string) {
  return p.replaceAll(/\{([^}]+)\}/g, ':$1')
}

function componentKey(name: string) {
  return `'${pascalCase(name)}'`
}

export function controllerFile(
  tag: string,
  routes: readonly Route[],
  componentImports: readonly string[] = [],
  componentNames: ReadonlySet<string> = new Set(),
  schemasImportPath = '../../components',
) {
  const className = `${pascalCase(tag)}Model`
  const isComponent = (name: string) => componentNames.has(name)
  const inlineRef = (name: string) => `${className}.${name}`
  const refValue = (name: string) => (isComponent(name) ? componentKey(name) : inlineRef(name))

  const renderRoute = (route: Route) => {
    const renderResponseValue = (schema: { kind: 'ref'; name: string } | { kind: 'void' }) =>
      schema.kind === 'ref' ? refValue(schema.name) : 't.Void()'
    const argKeys = filterDefined([
      route.paramsRef ? 'params' : null,
      route.queryRef ? 'query' : null,
      route.headersRef ? 'headers' : null,
      route.cookieRef ? 'cookie' : null,
      route.bodyRef ? 'body' : null,
    ])
    const handlerArg = argKeys.length > 0 ? `({${argKeys.join(',')}})` : '()'
    const handler = `${handlerArg}=>{}`
    const responseEntries = route.responses
      .map((res) => `${safeStatusKey(res.status)}:${renderResponseValue(res.schema)}`)
      .join(',')
    const detail = join(
      [
        `tags:${JSON.stringify(route.tags)}`,
        route.summary ? `summary:${JSON.stringify(route.summary)}` : null,
        route.description ? `description:${JSON.stringify(route.description)}` : null,
        `operationId:${JSON.stringify(route.operationId)}`,
        route.callbacks ? `callbacks:${JSON.stringify(route.callbacks)}` : null,
        route.security.length > 0 ? `security:${JSON.stringify(route.security)}` : null,
      ],
      ',',
    )
    const opts = join(
      [
        route.paramsRef ? `params:${refValue(route.paramsRef)}` : null,
        route.queryRef ? `query:${refValue(route.queryRef)}` : null,
        route.headersRef ? `headers:${refValue(route.headersRef)}` : null,
        route.cookieRef ? `cookie:${refValue(route.cookieRef)}` : null,
        route.bodyRef ? `body:${refValue(route.bodyRef)}` : null,
        responseEntries ? `response:{${responseEntries}}` : null,
        `detail:{${detail}}`,
      ],
      ',',
    )
    return `.${route.method}(${JSON.stringify(toElysiaPath(route.path))},${handler},{${opts}})`
  }
  const chain = routes.map(renderRoute).join('')
  const importedSchemaIdents = componentImports.map(schemaIdent)
  const componentImport =
    componentImports.length > 0
      ? `import {${importedSchemaIdents.join(',')}} from '${schemasImportPath}'\n`
      : ''
  const componentRegister =
    componentImports.length > 0
      ? `.model({${componentImports.map((n) => `${pascalCase(n)}:${schemaIdent(n)}`).join(',')}})`
      : ''
  const usesTypebox = /\bt\.[A-Z]\w*\(/.test(chain)
  const elysiaImport = usesTypebox
    ? `import {Elysia,t} from 'elysia'`
    : `import {Elysia} from 'elysia'`
  return `${elysiaImport}
${componentImport}import {${className}} from './model'

export const ${toSafeIdentifier(tag)}=new Elysia()${componentRegister}${chain}
`
}
