import { toSafeIdentifier } from '../../utils/index.js'

// Must match the binding exported by controllerFile (toSafeIdentifier).
function exportName(name: string) {
  return toSafeIdentifier(name)
}

export function appFile(
  resources: readonly string[],
  {
    prefix,
    integration,
    port = '3000',
  }: {
    readonly prefix?: string
    readonly integration?: boolean
    readonly port?: string
  } = {},
) {
  const ROOT_NAME = 'app'
  const localAlias = (name: string) =>
    exportName(name) === ROOT_NAME ? `${ROOT_NAME}Module` : exportName(name)
  const moduleImports = resources
    .map((name) => {
      const exported = exportName(name)
      const alias = localAlias(name)
      return alias === exported
        ? `import {${exported}} from './modules/${name}'`
        : `import {${exported} as ${alias}} from './modules/${name}'`
    })
    .join('\n')
  const moduleUses = resources.map((name) => `.use(${localAlias(name)})`).join('')
  const ctorArgs = prefix ? `{prefix:${JSON.stringify(prefix)}}` : ''
  // `app` is exported so tests can import the assembled instance and call
  // `app.handle(...)` against the real routing. `.listen()` is guarded by
  // `import.meta.main` so importing the module never starts an HTTP server.
  const listenBlock = integration
    ? ''
    : '\n\nif (import.meta.main) {\n' +
      `  app.listen(${port})\n` +
      '  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)\n' +
      '}'
  return `import {Elysia} from 'elysia'
${moduleImports}

export const app=new Elysia(${ctorArgs})${moduleUses}${listenBlock}
`
}
