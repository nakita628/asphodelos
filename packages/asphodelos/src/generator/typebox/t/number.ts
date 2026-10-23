import { commonOpts, errorCallback, normalizeBounds, options } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'
import { isFormMedia } from '../index.js'
import type { TypeboxCtx } from '../index.js'

export function number(schema: Schema, ctx: TypeboxCtx = {}) {
  const bounds = normalizeBounds(schema)
  const opts = options([
    ['format', schema.format],
    ['minimum', bounds.minimum],
    ['maximum', bounds.maximum],
    ['exclusiveMinimum', bounds.exclusiveMinimum],
    ['exclusiveMaximum', bounds.exclusiveMaximum],
    ['multipleOf', schema.multipleOf],
    ...filterDefined([errorCallback(schema, 'number')]),
    ...commonOpts(schema),
  ])
  const factory = schema.format === 'numeric' || isFormMedia(ctx) ? 't.Numeric' : 't.Number'
  return `${factory}(${opts})`
}
