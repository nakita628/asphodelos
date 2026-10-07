import { commonOpts, errorCallback, normalizeBounds, options } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'

// WHY: t.Integer() silently rounds beyond JS Number safe range; cap unbounded maximum.
function autoMaximum(
  format: Schema['format'],
  maximum: number | undefined,
  exclusiveMaximum: number | undefined,
) {
  if (maximum !== undefined) return maximum
  if (exclusiveMaximum !== undefined) return undefined
  if (format === 'int32') return 2_147_483_647
  return Number.MAX_SAFE_INTEGER
}

// TypeBox checks `format` on strings only, so the int32 range is written out as a bound on the
// value; a document that sets its own lower bound keeps it.
function autoMinimum(
  format: Schema['format'],
  minimum: number | undefined,
  exclusiveMinimum: number | undefined,
) {
  if (minimum !== undefined) return minimum
  if (exclusiveMinimum !== undefined) return undefined
  if (format === 'int32') return -2_147_483_648
  return undefined
}

export function integer(schema: Schema) {
  const bounds = normalizeBounds(schema)
  const opts = options([
    ['format', schema.format],
    ['minimum', autoMinimum(schema.format, bounds.minimum, bounds.exclusiveMinimum)],
    ['maximum', autoMaximum(schema.format, bounds.maximum, bounds.exclusiveMaximum)],
    ['exclusiveMinimum', bounds.exclusiveMinimum],
    ['exclusiveMaximum', bounds.exclusiveMaximum],
    ['multipleOf', schema.multipleOf],
    ...filterDefined([errorCallback(schema, 'integer')]),
    ...commonOpts(schema),
  ])
  const factory = schema.format === 'numeric' ? 't.Numeric' : 't.Integer'
  return `${factory}(${opts})`
}
