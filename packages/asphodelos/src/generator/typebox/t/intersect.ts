import { commonOpts, errorCallback, options } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'
import { typebox } from '../index.js'

/**
 * Whether an `allOf` member is a bare scalar or a bag of constraints, with nothing of its own to
 * intersect: no reference, no properties, no items and no composition.
 */
function isScalarMember(schema: Schema) {
  return (
    schema.$ref === undefined &&
    schema.properties === undefined &&
    schema.items === undefined &&
    schema.allOf === undefined &&
    schema.anyOf === undefined &&
    schema.oneOf === undefined &&
    schema.not === undefined &&
    !Array.isArray(schema.type) &&
    schema.type !== 'object' &&
    schema.type !== 'array'
  )
}

export function intersect(schemas: readonly Schema[], parent?: Schema) {
  if (schemas.length === 0) return 't.Unknown()'
  if (schemas.length === 1 && schemas[0]) return typebox(schemas[0])
  // Scalars are merged, not intersected: `allOf: [{ type: integer }, { minimum: 5 }]` is one
  // bounded integer. Elysia's `t.Integer()` is a coercing union, which TypeBox refuses to put
  // inside `t.Intersect`, and an intersection of constraint bags has no type for TypeBox to check
  // anyway. The parent's own annotations ride along; a later member wins a repeated keyword.
  if (schemas.every(isScalarMember) && schemas.some((s) => typeof s.type === 'string')) {
    const { allOf: _allOf, ...annotations } = parent ?? {}
    const merged: Schema = {}
    for (const part of [...schemas, annotations]) Object.assign(merged, part)
    return typebox(merged)
  }
  const opts = parent
    ? options([...filterDefined([errorCallback(parent, 'composition')]), ...commonOpts(parent)])
    : ''
  return opts
    ? `t.Intersect([${schemas.map((s) => typebox(s)).join(',')}],${opts})`
    : `t.Intersect([${schemas.map((s) => typebox(s)).join(',')}])`
}
