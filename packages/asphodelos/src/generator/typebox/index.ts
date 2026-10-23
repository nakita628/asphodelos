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
  readonly mediaType?:
    | 'multipart/form-data'
    | 'application/x-www-form-urlencoded'
    | 'application/octet-stream'
  /**
   * How Elysia reads the value: `cookie` is the cookie container, `object-string` an object read
   * from one JSON-encoded query value, `json-string` a parameter declared with
   * `content: application/json`, one JSON document.
   */
  readonly elysiaKind?: 'object-string' | 'cookie' | 'json-string'
  /** On a parameter container, where its parameters are read from; on a parameter, where it is. */
  readonly parameterLocation?: 'query' | 'path' | 'header' | 'cookie'
  /** The parameters of the container declared with `content` rather than `schema`. */
  readonly jsonProperties?: readonly string[]
  /**
   * The value arrives as text: a parameter, or a field of a form body. A number, a boolean or
   * `null` is then read from its spelling, where a JSON body would carry the value itself.
   */
  readonly text?: true
}

/** Whether the value this schema describes reaches Elysia as text. */
export function isTextInput(ctx: TypeboxCtx) {
  return ctx.text === true
}

/**
 * Whether the schema describes a form body, whose every field reaches Elysia as text. A number or
 * a boolean there is read through `t.Numeric` / `t.BooleanString`, the way Elysia itself reads a
 * query or a header; a JSON body carries its own types and keeps the plain factories.
 */
export function isFormMedia(ctx: TypeboxCtx) {
  return (
    ctx.mediaType === 'multipart/form-data' || ctx.mediaType === 'application/x-www-form-urlencoded'
  )
}

/**
 * A literal of a number or a boolean, where the value arrives as text: the text of each member is
 * accepted beside the member itself and read into it, so `?level=2` reaches the handler as `2`
 * and is typed `1 | 2 | 3`. A string member needs no reading, and a value that is not text, a JSON
 * body, is left as it is.
 */
function readLiteralsFromText(expr: string, values: readonly unknown[], ctx: TypeboxCtx) {
  if (!isTextInput(ctx) || values.length === 0) return expr
  if (!values.every((v) => typeof v === 'number' || typeof v === 'boolean')) return expr
  const spelled = values.map((v) => `t.Literal(${JSON.stringify(String(v))})`)
  const asText = spelled.length === 1 ? spelled[0] : `t.Union([${spelled.join(',')}])`
  const type = values.map(String).join('|')
  return `t.Transform(t.Union([${asText},${expr}])).Decode((v):${type}=>(typeof v==='string'?JSON.parse(v):v)).Encode((v)=>v)`
}

export function typebox(schema: Schema, ctx: TypeboxCtx = {}): string {
  const enabled = schema['x-readonly'] === true
  const rawTransform = schema['x-transform']
  if (typeof rawTransform === 'string' && rawTransform.length > 0) {
    return readonly(wrap(brand(rawTransform, schema), schema, ctx), enabled)
  }
  if (schema.$ref) return ref(schema)
  if (schema.allOf) return readonly(wrap(intersect(schema.allOf, schema), schema, ctx), enabled)
  if (schema.oneOf) return readonly(wrap(union(schema.oneOf, schema), schema, ctx), enabled)
  if (schema.anyOf) return readonly(wrap(union(schema.anyOf, schema), schema, ctx), enabled)
  if (schema.not) return readonly(wrap(notType(schema.not, schema), schema, ctx), enabled)
  if (schema.enum) {
    const literal = readLiteralsFromText(_enum(schema), schema.enum, ctx)
    return readonly(wrap(brand(literal, schema), schema, ctx), enabled)
  }
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
    const read = readLiteralsFromText(literal, [schema.const], ctx)
    return readonly(wrap(brand(read, schema), schema, ctx), enabled)
  }
  // `type: [integer, string]` is a union of the types it lists, each read with the constraints
  // that apply to it; `null` among them is added by `wrap`, as it is for a single type.
  const listed = isTypeArray(schema.type) ? schema.type.filter((t) => t !== 'null') : []
  if (listed.length > 1) {
    const members = listed.map((t) => typebox({ ...schema, type: t, nullable: undefined }, ctx))
    return readonly(wrap(`t.Union([${members.join(',')}])`, schema, ctx), enabled)
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
      return readonly(wrap(brand(string(schema, ctx), schema), schema, ctx), enabled)
    case 'integer':
      return readonly(wrap(brand(integer(schema), schema), schema, ctx), enabled)
    case 'number':
      return readonly(wrap(brand(number(schema, ctx), schema), schema, ctx), enabled)
    case 'boolean':
      return readonly(wrap(brand(boolean(schema, ctx), schema), schema, ctx), enabled)
    case 'array':
      return readonly(wrap(array(schema, ctx), schema, ctx), enabled)
    case 'object':
      return readonly(wrap(object(schema, ctx), schema, ctx), enabled)
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
