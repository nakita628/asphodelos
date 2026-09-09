import {
  commonOpts,
  errorCallback,
  options,
  stringPatternFrom,
  stringTransformWrap,
} from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'
import type { TypeboxCtx } from '../index.js'

export function string(schema: Schema, ctx: TypeboxCtx = {}) {
  if (schema.format === 'date' || schema.format === 'date-time') {
    return `t.Date(${options([...commonOpts(schema)])})`
  }
  if (schema.format === 'binary') {
    if (ctx.mediaType === 'application/octet-stream') {
      return `t.Uint8Array(${options([
        ['minByteLength', schema.minLength],
        ['maxByteLength', schema.maxLength],
        ...commonOpts(schema),
      ])})`
    }
    return `t.File(${options([
      ['type', schema.contentMediaType],
      ['minSize', schema.minLength],
      ['maxSize', schema.maxLength],
      ...commonOpts(schema),
    ])})`
  }
  const opts = options([
    ['format', schema.format],
    ['pattern', stringPatternFrom(schema)],
    ['minLength', schema.minLength],
    ['maxLength', schema.maxLength],
    ...filterDefined([errorCallback(schema, 'string')]),
    ...commonOpts(schema),
  ])
  return stringTransformWrap(`t.String(${opts})`, schema)
}
