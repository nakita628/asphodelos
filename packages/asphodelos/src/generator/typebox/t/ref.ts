import type { Schema } from '../../../openapi/index.js'
import { pascalCase } from '../../../utils/index.js'

export function ref(schema: Schema) {
  if (!schema.$ref) return 't.Unknown()'
  const m = /^#\/components\/schemas\/([^/]+)$/u.exec(schema.$ref)
  if (m?.[1]) return `${pascalCase(decodeURIComponent(m[1]))}Schema`
  return 't.Unknown()'
}
