import { isSchemaArray } from '../../../guard/index.js'
import { commonOpts, errorCallback, options, raw } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'
import { readsTextItself, typebox } from '../index.js'
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
/**
 * A `pipeDelimited` or `spaceDelimited` array: one value whose elements are joined with the
 * separator, which Elysia does not split. The text — or each repetition of it, for a client that
 * repeats the name — is split, and the elements decoded against the array schema, read from text.
 */
function delimited(arrayExpr: string, separator: '|' | ' ') {
  const sep = JSON.stringify(separator)
  return `t.Transform(t.Union([t.String(),t.Array(t.String())])).Decode((v)=>Value.Decode(${arrayExpr},(Array.isArray(v)?v:[v]).flatMap((s)=>s.split(${sep})))).Encode((v)=>v.join(${sep}))`
}

function arrayFactory(ctx: TypeboxCtx) {
  if (ctx.elysiaKind === 'json-string') return 't.ArrayString'
  if (readsTextItself(ctx)) return 't.ArrayQuery'
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
  const itemCtx: TypeboxCtx = ctx.delimiter ? { text: true, readsText: true } : childCtx
  const itemExpr = items ? typebox(items, itemCtx) : 't.Unknown()'
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
  if (ctx.delimiter) {
    return delimited(opts ? `t.Array(${itemExpr},${opts})` : `t.Array(${itemExpr})`, ctx.delimiter)
  }
  const factory = arrayFactory(ctx)
  return opts ? `${factory}(${itemExpr},${opts})` : `${factory}(${itemExpr})`
}
