import { commonOpts, errorCallback, options } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'
import { isFormMedia } from '../index.js'
import type { TypeboxCtx } from '../index.js'

export function boolean(schema: Schema, ctx: TypeboxCtx = {}) {
  const opts = options([
    ['format', schema.format],
    ...filterDefined([errorCallback(schema, 'boolean')]),
    ...commonOpts(schema),
  ])
  const factory =
    schema.format === 'boolean-string' || isFormMedia(ctx) ? 't.BooleanString' : 't.Boolean'
  return `${factory}(${opts})`
}
