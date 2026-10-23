import { isSchemaArray } from '../../../guard/index.js'
import { commonOpts, errorCallback, options, raw } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'
import { isFormMedia, typebox } from '../index.js'
import type { TypeboxCtx } from '../index.js'

function isMultipartBinaryArray(items: Schema, ctx: TypeboxCtx) {
  return items.format === 'binary' && ctx.mediaType === 'multipart/form-data'
}

/**
 * How an array is read where it arrives as text. A parameter declared with `content` is one JSON
 * document. A form field repeats its name for each element and is a bare value when sent once,
 * which `t.Array` would refuse, and a header or a cookie holds one value, comma-separated;
 * `t.ArrayQuery` reads all of those the way Elysia reads a query array. A query array is read by
 * Elysia itself, and a JSON body carries the array.
 */
function arrayFactory(ctx: TypeboxCtx) {
  if (ctx.elysiaKind === 'json-string') return 't.ArrayString'
  if (isFormMedia(ctx)) return 't.ArrayQuery'
  if (ctx.parameterLocation === 'header' || ctx.parameterLocation === 'cookie') {
    return 't.ArrayQuery'
  }
  return 't.Array'
}

export function array(schema: Schema, ctx: TypeboxCtx = {}) {
  const childCtx: TypeboxCtx = ctx.mediaType ? { mediaType: ctx.mediaType } : {}
  if (schema.prefixItems) {
    return `t.Tuple([${schema.prefixItems.map((s) => typebox(s, childCtx)).join(',')}])`
  }
  const items = schema.items
  if (items && isSchemaArray(items)) {
    return `t.Tuple([${items.map((s) => typebox(s, childCtx)).join(',')}])`
  }
  if (items && !isSchemaArray(items) && isMultipartBinaryArray(items, ctx)) {
    const filesOpts = options([
      ['type', items.contentMediaType],
      ['minItems', schema.minItems],
      ['maxItems', schema.maxItems],
      ['minSize', items.minLength],
      ['maxSize', items.maxLength],
      ...filterDefined([errorCallback(schema, 'array')]),
      ...commonOpts(schema),
    ])
    return filesOpts ? `t.Files(${filesOpts})` : 't.Files()'
  }
  const itemExpr = items ? typebox(items, childCtx) : 't.Unknown()'
  const containsExpr = schema.contains ? raw(typebox(schema.contains, childCtx)) : undefined
  const opts = options([
    ['minItems', schema.minItems],
    ['maxItems', schema.maxItems],
    ['uniqueItems', schema.uniqueItems],
    ['contains', containsExpr],
    ['minContains', schema.minContains],
    ['maxContains', schema.maxContains],
    ...filterDefined([errorCallback(schema, 'array')]),
    ...commonOpts(schema),
  ])
  const factory = arrayFactory(ctx)
  return opts ? `${factory}(${itemExpr},${opts})` : `${factory}(${itemExpr})`
}
