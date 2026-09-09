import { commonOpts, errorCallback, options } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'
import { typebox } from '../index.js'

export function notType(inner: Schema, parent: Schema) {
  const innerExpr = typebox(inner)
  const opts = options([
    ...filterDefined([errorCallback(parent, 'composition')]),
    ...commonOpts(parent),
  ])
  return opts ? `t.Not(${innerExpr},${opts})` : `t.Not(${innerExpr})`
}
