import type { Schema } from '../openapi/index.js'
import { normalizeBounds } from './typebox.js'

// True when the schema carries an explicit numeric bound. Such a constraint is
// first-class input and must win over the name-based format/property hints,
// which would otherwise emit values the generated TypeBox model rejects.
export function hasNumericConstraint(schema: Schema) {
  return (
    schema.minimum !== undefined ||
    schema.maximum !== undefined ||
    schema.exclusiveMinimum !== undefined ||
    schema.exclusiveMaximum !== undefined ||
    schema.multipleOf !== undefined
  )
}

// True when the schema constrains string shape (length or pattern).
export function hasStringConstraint(schema: Schema) {
  return (
    schema.minLength !== undefined || schema.maxLength !== undefined || schema.pattern !== undefined
  )
}

// faker.number.* expression honoring minimum/maximum/exclusive*/multipleOf. The
// bounds are literals at codegen time, so multipleOf is satisfied by picking an
// integer multiplier k in [ceil(lo/m), floor(hi/m)] and emitting `k * m`, which
// stays inside the range — no post-hoc rounding that could escape it. `exclusive*`
// is normalized (boolean draft-04 / numeric 2020-12) by normalizeBounds, then
// pulled one step inward (±1 for integers, ±0.01 for the 2-fraction-digit floats).
export function numericFakerExpr(schema: Schema, isInt: boolean) {
  const bounds = normalizeBounds(schema)
  const epsilon = isInt ? 1 : 0.01
  const lo =
    bounds.exclusiveMinimum !== undefined
      ? bounds.exclusiveMinimum + epsilon
      : (bounds.minimum ?? 1)
  const hi = Math.max(
    lo,
    bounds.exclusiveMaximum !== undefined
      ? bounds.exclusiveMaximum - epsilon
      : (bounds.maximum ?? 1000),
  )
  const multipleOf = schema.multipleOf
  if (multipleOf !== undefined && multipleOf > 0) {
    const kMin = Math.ceil(lo / multipleOf)
    const kMax = Math.max(kMin, Math.floor(hi / multipleOf))
    return `faker.number.int({ min: ${kMin}, max: ${kMax} }) * ${multipleOf}`
  }
  if (isInt) {
    return `faker.number.int({ min: ${lo}, max: ${hi} })`
  }
  return `faker.number.float({ min: ${lo}, max: ${hi}, fractionDigits: 2 })`
}

/**
 * Rewrites a `pattern` into the string `faker.helpers.fromRegExp` samples.
 *
 * faker strips `^`/`$` only from a `RegExp` argument; given a string it copies them into the
 * value (`^abc$`), which then fails the very pattern it was drawn from. The anchors are removed
 * here instead, together with the no-op `\/` escape that faker would copy verbatim as well.
 */
export function fakerPattern(pattern: string) {
  return pattern
    .replace(/^\^+/u, '')
    .replace(/(?<!\\)(?:\\\\)*\$+$/u, (anchor) => anchor.replaceAll('$', ''))
    .replaceAll(/\\([\s\S])/gu, (match: string, escaped: string) => (escaped === '/' ? '/' : match))
}

// faker.string.alpha expression honoring minLength/maxLength. A pattern wins via
// fromRegExp — the regex itself bounds the value, and expressing the length too
// is the input spec's responsibility (single source of truth).
export function stringFakerExpr(schema: Schema) {
  if (schema.pattern !== undefined) {
    return `faker.helpers.fromRegExp(${JSON.stringify(fakerPattern(schema.pattern))})`
  }
  const lower = schema.minLength ?? 5
  const max = schema.maxLength ?? Math.max(lower, 20)
  const min = Math.min(lower, max)
  return `faker.string.alpha({ length: { min: ${min}, max: ${max} } })`
}

// length expression for `Array.from` honoring minItems/maxItems. `arrayMin`/`arrayMax` (the mock
// config) then `1`/`5` fill an unconstrained side, clamped against the spec side so a config
// bound never inverts the range (`arrayMin: 5` with `maxItems: 3` → 3..3).
export function arrayLengthExpr(
  schema: Schema,
  options: { readonly arrayMin?: number; readonly arrayMax?: number } = {},
) {
  const min = schema.minItems ?? Math.min(options.arrayMin ?? 1, schema.maxItems ?? Infinity)
  const max = Math.max(schema.maxItems ?? options.arrayMax ?? 5, min)
  return `faker.number.int({ min: ${min}, max: ${max} })`
}

// int32 max — a large, schema-valid ceiling used when a numeric path param has no
// declared `maximum`. Safe for int32/int64 and big enough that the resource is
// extremely unlikely to exist, which is exactly what the 404 probe wants.
const NON_EXISTENT_CEIL = 2_147_483_647

// Collapse an OpenAPI 3.1 `type` (which may be an array like `['string','null']`)
// to a single representative, preferring the first non-null member.
function primaryType(schema: Schema) {
  const type = schema.type
  if (Array.isArray(type)) return type.find((t) => t !== 'null') ?? type[0]
  return type
}

// A concrete number that satisfies minimum/maximum/exclusive*/multipleOf, biased
// to a large value unlikely to map to a real record. Returns `undefined` when the
// constraints admit no value (e.g. no multiple in range) so the caller can drop
// the 404 test instead of emitting one the host rejects with 422.
function nonExistentNumber(schema: Schema, isInt: boolean) {
  const bounds = normalizeBounds(schema)
  const epsilon = isInt ? 1 : 0.01
  const lo =
    bounds.exclusiveMinimum !== undefined
      ? bounds.exclusiveMinimum + epsilon
      : (bounds.minimum ?? Number.NEGATIVE_INFINITY)
  const hiRaw =
    bounds.exclusiveMaximum !== undefined ? bounds.exclusiveMaximum - epsilon : bounds.maximum
  const hi =
    hiRaw ?? Math.max(lo === Number.NEGATIVE_INFINITY ? NON_EXISTENT_CEIL : lo, NON_EXISTENT_CEIL)
  const multipleOf = schema.multipleOf
  if (multipleOf !== undefined && multipleOf > 0) {
    const value =
      lo === Number.NEGATIVE_INFINITY
        ? Math.floor(NON_EXISTENT_CEIL / multipleOf) * multipleOf
        : Math.ceil(lo / multipleOf) * multipleOf
    if (value < lo || (hiRaw !== undefined && value > hi)) return undefined
    return String(value)
  }
  const value = isInt ? Math.floor(hi) : hi
  if (value < lo) return undefined
  return String(value)
}

// A literal string that satisfies minLength/maxLength, readable as an obvious
// probe. Padded/truncated only when the length bounds force it.
function nonExistentStringLiteral(schema: Schema) {
  const base = '__non_existent__'
  const min = schema.minLength ?? 0
  const max = schema.maxLength ?? Math.max(base.length, min)
  if (base.length > max) return 'x'.repeat(max)
  if (base.length < min) return base + 'x'.repeat(min - base.length)
  return base
}

// 404-probe value for a path param: a value the host's TypeBox layer accepts (so
// the request reaches the handler) yet the implementation will not find. Returns
// a `literal` to splice into the URL, an `expr` (faker) to bind and interpolate
// when only a runtime value can satisfy a `pattern`, or `undefined` when the
// schema admits no valid-yet-non-existent value (enum/const, empty numeric range)
// — the caller then omits the 404 test rather than emit a guaranteed 422.
export function nonExistentPathValue(
  schema: Schema,
):
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'expr'; readonly code: string }
  | undefined {
  if (schema.enum !== undefined || schema.const !== undefined) return undefined
  const type = primaryType(schema)
  if (type === 'integer' || type === 'number') {
    const value = nonExistentNumber(schema, type === 'integer')
    return value === undefined ? undefined : { kind: 'literal', value }
  }
  if (schema.format === 'uuid') {
    return { kind: 'literal', value: '00000000-0000-0000-0000-000000000000' }
  }
  if (schema.pattern !== undefined) {
    return {
      kind: 'expr',
      code: `faker.helpers.fromRegExp(${JSON.stringify(fakerPattern(schema.pattern))})`,
    }
  }
  return { kind: 'literal', value: nonExistentStringLiteral(schema) }
}
