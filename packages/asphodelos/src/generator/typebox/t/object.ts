import { commonOpts, errorCallback, options, raw, transformWrap } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'
import { isFormMedia, typebox } from '../index.js'
import type { TypeboxCtx } from '../index.js'

function pickObjectFactory(ctx: TypeboxCtx) {
  if (ctx.elysiaKind === 'object-string' || ctx.elysiaKind === 'json-string') return 'ObjectString'
  if (ctx.elysiaKind === 'cookie') return 'Cookie'
  if (ctx.mediaType === 'multipart/form-data') return 'Form'
  return 'Object'
}

/**
 * The context of a property. The properties of a parameter container and of a form body arrive as
 * text, so each is marked `text` and keeps the location it is read from; an object nested in one
 * of those is a single JSON document, whose own properties carry their types and are left alone.
 */
function childCtxFor(parentCtx: TypeboxCtx, propSchema: Schema, key?: string): TypeboxCtx {
  const media = parentCtx.mediaType ? { mediaType: parentCtx.mediaType } : {}
  if (parentCtx.text === true) return media
  const location = parentCtx.parameterLocation
  if (location === undefined && !isFormMedia(parentCtx)) return media
  const text: TypeboxCtx = {
    ...media,
    text: true,
    ...(location === undefined ? {} : { parameterLocation: location }),
  }
  if (key !== undefined && parentCtx.jsonProperties?.includes(key)) {
    return { ...text, elysiaKind: 'json-string' }
  }
  if (location === 'query' && propSchema.type === 'object') {
    return { ...text, elysiaKind: 'object-string' }
  }
  return text
}

export function object(schema: Schema, ctx: TypeboxCtx = {}) {
  const properties = schema.properties ?? {}
  const required = new Set(schema.required)
  const propEntries = Object.entries(properties).map(([key, propSchema]) => {
    const inner = typebox(propSchema, childCtxFor(ctx, propSchema, key))
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

  // A schema beside the declared properties types every other key; `true` is TypeBox's default.
  const additionalOption =
    additional === false
      ? false
      : additional && typeof additional === 'object'
        ? raw(typebox(additional, childCtxFor(ctx, additional)))
        : undefined
  const opts = options([
    ['minProperties', schema.minProperties],
    ['maxProperties', schema.maxProperties],
    ['additionalProperties', additionalOption],
    ...filterDefined([errorCallback(schema, 'object')]),
    ...commonOpts(schema),
  ])
  const body = `{${propEntries.join(',')}}`
  const factory = pickObjectFactory(ctx)
  const objectExpr = opts ? `t.${factory}(${body},${opts})` : `t.${factory}(${body})`
  const subCtx: TypeboxCtx = ctx.mediaType ? { mediaType: ctx.mediaType } : {}
  return transformWrap(objectExpr, schema, (s) => typebox(s, subCtx))
}
