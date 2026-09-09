import { isTypeArray } from '../../guard/index.js'
import { brand, commonOpts, errorCallback, options, readonly, wrap } from '../../helper/typebox.js'
import type { Schema, Type } from '../../openapi/index.js'
import { filterDefined } from '../../utils/index.js'
import {
  _enum,
  array,
  boolean,
  integer,
  intersect,
  literalSchema,
  notType,
  nullType,
  number,
  object,
  ref,
  string,
  union,
} from './t/index.js'

export type TypeboxCtx = {
  readonly mediaType?: 'multipart/form-data' | 'application/octet-stream'
  readonly elysiaKind?: 'object-string' | 'cookie'
  readonly parameterLocation?: 'query'
}

export function typebox(schema: Schema, ctx: TypeboxCtx = {}): string {
  const enabled = schema['x-readonly'] === true
  const rawTransform = schema['x-transform']
  if (typeof rawTransform === 'string' && rawTransform.length > 0) {
    return readonly(wrap(brand(rawTransform, schema), schema), enabled)
  }
  if (schema.$ref) return ref(schema)
  if (schema.allOf) return readonly(wrap(intersect(schema.allOf, schema), schema), enabled)
  if (schema.oneOf) return readonly(wrap(union(schema.oneOf, schema), schema), enabled)
  if (schema.anyOf) return readonly(wrap(union(schema.anyOf, schema), schema), enabled)
  if (schema.not) return readonly(wrap(notType(schema.not, schema), schema), enabled)
  if (schema.enum) return readonly(wrap(brand(_enum(schema), schema), schema), enabled)
  if (schema.const !== undefined) {
    const opts = options([
      ...filterDefined([errorCallback(schema, 'composition')]),
      ...commonOpts(schema),
    ])
    // t.Literal only accepts string | number | boolean; `const: null` is t.Null()
    // and a composite const (array/object) is the structural literal.
    const optsPart = opts ? `,${opts}` : ''
    const literal =
      schema.const === null
        ? `t.Null(${opts})`
        : typeof schema.const === 'object'
          ? literalSchema(schema.const)
          : `t.Literal(${JSON.stringify(schema.const)}${optsPart})`
    return readonly(wrap(brand(literal, schema), schema), enabled)
  }
  const primaryType = (): Type | undefined => {
    if (typeof schema.type === 'string') return schema.type
    if (isTypeArray(schema.type)) return schema.type.find((t) => t !== 'null')
    if (schema.properties ?? schema.additionalProperties !== undefined) return 'object'
    if (schema.items ?? schema.prefixItems) return 'array'
    return undefined
  }
  // Bound to a const so TypeScript can see the switch below is exhaustive over `Type`.
  const primary = primaryType()
  switch (primary) {
    case 'string':
      return readonly(wrap(brand(string(schema, ctx), schema), schema), enabled)
    case 'integer':
      return readonly(wrap(brand(integer(schema), schema), schema), enabled)
    case 'number':
      return readonly(wrap(brand(number(schema), schema), schema), enabled)
    case 'boolean':
      return readonly(wrap(brand(boolean(schema), schema), schema), enabled)
    case 'array':
      return readonly(wrap(array(schema, ctx), schema), enabled)
    case 'object':
      return readonly(wrap(object(schema, ctx), schema), enabled)
    case 'null':
      return nullType()
    // `date` never arrives from a parsed document — OpenAPI spells dates as
    // `type: 'string', format: 'date'`, which the `string` arm handles — and `undefined` is a
    // schema with no type at all. Both are named rather than folded into a `default`, so that
    // adding a member to `Type` is a lint error here instead of silent `t.Unknown()`.
    case 'date':
    case undefined:
      return 't.Unknown()'
    default:
      return 't.Unknown()'
  }
}
