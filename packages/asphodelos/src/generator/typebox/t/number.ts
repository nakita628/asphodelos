import { commonOpts, errorCallback, normalizeBounds, options } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'

export function number(schema: Schema) {
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
  const factory = schema.format === 'numeric' ? 't.Numeric' : 't.Number'
  return `${factory}(${opts})`
}
