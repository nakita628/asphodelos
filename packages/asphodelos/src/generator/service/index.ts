import { pascalCase } from '../../utils/index.js'

export function serviceFile(tag: string) {
  const className = pascalCase(tag)
  return `export abstract class ${className}{}
`
}
