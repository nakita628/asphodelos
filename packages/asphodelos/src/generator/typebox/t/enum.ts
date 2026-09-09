import { isRecord } from '../../../guard/index.js'
import { commonOpts, enumErrorCallback, options } from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'

// WHY: t.UnionEnum preserves the literal-union TS type but only accepts
// string | number (numbers included — t.NumericEnum is string-keyed and breaks on
// numeric members). `null` is not a TEnumValue, so a null-bearing enum falls back
// to t.Union with a t.Null() member.
function isUnionEnumValue(v: unknown): v is string | number {
  return typeof v === 'string' || typeof v === 'number'
}

// t.Literal only accepts string | number | boolean. A composite const/enum value
// (array/object — valid JSON Schema) must become the structural literal so it
// typechecks: array → t.Tuple of element literals, object → t.Object of property
// literals. `null` is t.Null().
export function literalSchema(value: unknown): string {
  if (value === null) return 't.Null()'
  if (Array.isArray(value)) return `t.Tuple([${value.map(literalSchema).join(',')}])`
  if (isRecord(value)) {
    return `t.Object({${Object.entries(value)
      .map(([key, v]) => `${JSON.stringify(key)}:${literalSchema(v)}`)
      .join(',')}})`
  }
  return `t.Literal(${JSON.stringify(value)})`
}

export function _enum(schema: Schema) {
  const values = schema.enum ?? []
  const opts = options([...filterDefined([enumErrorCallback(schema)]), ...commonOpts(schema)])
  if (values.length === 0) return 't.Never()'
  if (values.length === 1) {
    const v = values[0]
    if (v === null) return opts ? `t.Null(${opts})` : 't.Null()'
    if (opts && typeof v !== 'object') return `t.Literal(${JSON.stringify(v)},${opts})`
    return literalSchema(v)
  }
  if (values.every(isUnionEnumValue)) {
    const list = JSON.stringify(values)
    return opts ? `t.UnionEnum(${list},${opts})` : `t.UnionEnum(${list})`
  }
  return opts
    ? `t.Union([${values.map(literalSchema).join(',')}],${opts})`
    : `t.Union([${values.map(literalSchema).join(',')}])`
}
