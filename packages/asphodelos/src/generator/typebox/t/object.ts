import { commonOpts, errorCallback, options, transformWrap } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'
import { typebox } from '../index.js'
import type { TypeboxCtx } from '../index.js'

function pickObjectFactory(ctx: TypeboxCtx) {
  if (ctx.elysiaKind === 'object-string') return 'ObjectString'
  if (ctx.elysiaKind === 'cookie') return 'Cookie'
  if (ctx.mediaType === 'multipart/form-data') return 'Form'
  return 'Object'
}

function childCtxFor(parentCtx: TypeboxCtx, propSchema: Schema): TypeboxCtx {
  const inheritedMedia = parentCtx.mediaType ? { mediaType: parentCtx.mediaType } : {}
  if (parentCtx.parameterLocation === 'query' && propSchema.type === 'object') {
    return { ...inheritedMedia, elysiaKind: 'object-string' }
  }
  return inheritedMedia
}

export function object(schema: Schema, ctx: TypeboxCtx = {}) {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required)
  const propEntries = Object.entries(properties).map(([key, propSchema]) => {
    const inner = typebox(propSchema, childCtxFor(ctx, propSchema))
    const isRequired = required.has(key)
    const isReadOnly = propSchema.readOnly === true
    const wrapped = isReadOnly
      ? isRequired
        ? `t.Readonly(${inner})`
        : `t.ReadonlyOptional(${inner})`
      : isRequired
        ? inner
        : `t.Optional(${inner})`
    return `${JSON.stringify(key)}:${wrapped}`
  })

  const additional = schema.additionalProperties
  if (Object.keys(properties).length === 0 && additional && typeof additional === 'object') {
    const additionalCtx = childCtxFor(ctx, additional)
    const valueExpr = typebox(additional, additionalCtx)
    const opts = options([
      ['minProperties', schema.minProperties],
      ['maxProperties', schema.maxProperties],
      ...filterDefined([errorCallback(schema, 'object')]),
      ...commonOpts(schema),
    ])
    const recordExpr = opts
      ? `t.Record(t.String(),${valueExpr},${opts})`
      : `t.Record(t.String(),${valueExpr})`
    return transformWrap(recordExpr, schema, (s) => typebox(s, additionalCtx))
  }

  const opts = options([
    ['minProperties', schema.minProperties],
    ['maxProperties', schema.maxProperties],
    ['additionalProperties', additional === false ? false : undefined],
    ...filterDefined([errorCallback(schema, 'object')]),
    ...commonOpts(schema),
  ])
  const body = `{${propEntries.join(',')}}`
  const factory = pickObjectFactory(ctx)
  const objectExpr = opts ? `t.${factory}(${body},${opts})` : `t.${factory}(${body})`
  const subCtx: TypeboxCtx = ctx.mediaType ? { mediaType: ctx.mediaType } : {}
  return transformWrap(objectExpr, schema, (s) => typebox(s, subCtx))
}
