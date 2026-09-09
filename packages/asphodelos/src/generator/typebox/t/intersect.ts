import { commonOpts, errorCallback, options } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'
import { typebox } from '../index.js'

export function intersect(schemas: readonly Schema[], parent?: Schema) {
  if (schemas.length === 0) return 't.Unknown()'
  if (schemas.length === 1 && schemas[0]) return typebox(schemas[0])
  const opts = parent
    ? options([...filterDefined([errorCallback(parent, 'composition')]), ...commonOpts(parent)])
    : ''
  return opts
    ? `t.Intersect([${schemas.map((s) => typebox(s)).join(',')}],${opts})`
    : `t.Intersect([${schemas.map((s) => typebox(s)).join(',')}])`
}
