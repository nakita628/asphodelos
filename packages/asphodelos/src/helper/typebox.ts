import type { Schema } from '../openapi/index.js'

const RAW = Symbol.for('asphodelos.options.raw')
type Raw = { readonly [RAW]: true; readonly expr: string }
export function raw(expr: string): Raw {
  return { [RAW]: true, expr }
}
function isRaw(v: unknown): v is Raw {
  return typeof v === 'object' && v !== null && RAW in v
}

function formatKey(k: string) {
  return /^[a-zA-Z_$][a-zA-Z_$0-9]*$/.test(k) ? k : JSON.stringify(k)
}

export function options(pairs: readonly (readonly [string, unknown])[]) {
  const filtered = pairs.filter(([, v]) => v !== undefined)
  if (filtered.length === 0) return ''
  return `{${filtered
    .map(([k, v]) => `${formatKey(k)}:${isRaw(v) ? v.expr : JSON.stringify(v)}`)
    .join(',')}}`
}

function exclusiveBound(flag: number | boolean | undefined, inclusive: number | undefined) {
  if (flag === true) return inclusive
  if (typeof flag === 'number') return flag
  return undefined
}

/**
 * Normalize OpenAPI 3.0's boolean `exclusiveMinimum`/`exclusiveMaximum` to the
 * JSON Schema 2020-12 numeric form TypeBox expects. In 3.0 a boolean `true`
 * makes the sibling `minimum`/`maximum` exclusive; 2020-12 (and TypeBox) carry
 * the bound value on `exclusiveMinimum`/`exclusiveMaximum` itself. `false`
 * collapses back to the inclusive bound.
 * https://spec.openapis.org/oas/v3.0.3#schema-object
 */
export function normalizeBounds(schema: Schema) {
  return {
    minimum: schema.exclusiveMinimum === true ? undefined : schema.minimum,
    maximum: schema.exclusiveMaximum === true ? undefined : schema.maximum,
    exclusiveMinimum: exclusiveBound(schema.exclusiveMinimum, schema.minimum),
    exclusiveMaximum: exclusiveBound(schema.exclusiveMaximum, schema.maximum),
  } as const
}

export function commonOpts(schema: Schema) {
  return [
    ['externalDocs', schema.externalDocs],
    ['example', schema.example],
    ['examples', schema.examples],
    ['title', schema.title],
    ['description', schema.description],
    ['default', schema.default],
    ['readOnly', schema.readOnly],
    ['writeOnly', schema.writeOnly],
    ['deprecated', schema.deprecated],
    ['x-error-message', schema['x-error-message']],
    ['x-required-message', schema['x-required-message']],
    ['x-const-message', schema['x-const-message']],
    ['x-enum-message', schema['x-enum-message']],
    ['x-minimum-message', schema['x-minimum-message']],
    ['x-maximum-message', schema['x-maximum-message']],
    ['x-exclusiveMinimum-message', schema['x-exclusiveMinimum-message']],
    ['x-exclusiveMaximum-message', schema['x-exclusiveMaximum-message']],
    ['x-multipleOf-message', schema['x-multipleOf-message']],
    ['x-minLength-message', schema['x-minLength-message']],
    ['x-maxLength-message', schema['x-maxLength-message']],
    ['x-pattern-message', schema['x-pattern-message']],
    ['x-length-message', schema['x-length-message']],
    ['x-minItems-message', schema['x-minItems-message']],
    ['x-maxItems-message', schema['x-maxItems-message']],
    ['x-uniqueItems-message', schema['x-uniqueItems-message']],
    ['x-contains-message', schema['x-contains-message']],
    ['x-minContains-message', schema['x-minContains-message']],
    ['x-maxContains-message', schema['x-maxContains-message']],
    ['x-prefixItems-message', schema['x-prefixItems-message']],
    ['x-items-message', schema['x-items-message']],
    ['x-minProperties-message', schema['x-minProperties-message']],
    ['x-maxProperties-message', schema['x-maxProperties-message']],
    ['x-additionalProperties-message', schema['x-additionalProperties-message']],
    ['x-propertyNames-message', schema['x-propertyNames-message']],
    ['x-patternProperties-message', schema['x-patternProperties-message']],
    ['x-dependentRequired-message', schema['x-dependentRequired-message']],
    ['x-dependentSchemas-message', schema['x-dependentSchemas-message']],
    ['x-properties-message', schema['x-properties-message']],
    ['x-unevaluatedProperties-message', schema['x-unevaluatedProperties-message']],
    ['x-unevaluatedItems-message', schema['x-unevaluatedItems-message']],
    ['x-if-message', schema['x-if-message']],
    ['x-then-message', schema['x-then-message']],
    ['x-else-message', schema['x-else-message']],
    ['x-allOf-message', schema['x-allOf-message']],
    ['x-anyOf-message', schema['x-anyOf-message']],
    ['x-oneOf-message', schema['x-oneOf-message']],
    ['x-not-message', schema['x-not-message']],
    ['x-implication-message', schema['x-implication-message']],
    ['x-brand', schema['x-brand']],
  ] as const
}

export type ErrorKind =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'array'
  | 'object'
  | 'composition'

function branch(message: string | undefined, hasConstraint: boolean, type: number, note: string) {
  return message !== undefined && hasConstraint ? [{ type, note, message }] : []
}

function branches(schema: Schema, kind: ErrorKind) {
  const requiredMessage = schema['x-required-message']
  const constMessage = schema['x-const-message']
  const enumMessage = schema['x-enum-message']
  const minLength = schema['x-minLength-message']
  const maxLength = schema['x-maxLength-message']
  const length = schema['x-length-message']
  const pattern = schema['x-pattern-message']
  const minimum = schema['x-minimum-message']
  const maximum = schema['x-maximum-message']
  const exclusiveMinimum = schema['x-exclusiveMinimum-message']
  const exclusiveMaximum = schema['x-exclusiveMaximum-message']
  const multipleOf = schema['x-multipleOf-message']
  const minItems = schema['x-minItems-message']
  const maxItems = schema['x-maxItems-message']
  const uniqueItems = schema['x-uniqueItems-message']
  const contains = schema['x-contains-message']
  const minContains = schema['x-minContains-message']
  const maxContains = schema['x-maxContains-message']
  const minProperties = schema['x-minProperties-message']
  const maxProperties = schema['x-maxProperties-message']
  const additionalPropertiesMessage = schema['x-additionalProperties-message']
  const oneOf = schema['x-oneOf-message']
  const anyOf = schema['x-anyOf-message']
  const allOf = schema['x-allOf-message']
  const not = schema['x-not-message']
  const implication = schema['x-implication-message']

  if (kind === 'string') {
    const isFixed =
      length !== undefined &&
      schema.minLength !== undefined &&
      schema.minLength === schema.maxLength
    return [
      ...(isFixed
        ? [
            { type: 52, note: 'StringMinLength', message: length },
            { type: 51, note: 'StringMaxLength', message: length },
          ]
        : [
            ...branch(minLength, schema.minLength !== undefined, 52, 'StringMinLength'),
            ...branch(maxLength, schema.maxLength !== undefined, 51, 'StringMaxLength'),
          ]),
      ...branch(pattern, schema.pattern !== undefined, 53, 'StringPattern'),
      ...branch(pattern, schema.pattern !== undefined, 48, 'RegExp'),
    ]
  }
  if (kind === 'number') {
    return [
      ...branch(minimum, schema.minimum !== undefined, 39, 'NumberMinimum'),
      ...branch(maximum, schema.maximum !== undefined, 38, 'NumberMaximum'),
      ...branch(
        exclusiveMinimum,
        schema.exclusiveMinimum !== undefined,
        37,
        'NumberExclusiveMinimum',
      ),
      ...branch(
        exclusiveMaximum,
        schema.exclusiveMaximum !== undefined,
        36,
        'NumberExclusiveMaximum',
      ),
      ...branch(multipleOf, schema.multipleOf !== undefined, 40, 'NumberMultipleOf'),
    ]
  }
  if (kind === 'integer') {
    return [
      ...branch(minimum, schema.minimum !== undefined, 25, 'IntegerMinimum'),
      ...branch(maximum, schema.maximum !== undefined, 24, 'IntegerMaximum'),
      ...branch(
        exclusiveMinimum,
        schema.exclusiveMinimum !== undefined,
        23,
        'IntegerExclusiveMinimum',
      ),
      ...branch(
        exclusiveMaximum,
        schema.exclusiveMaximum !== undefined,
        22,
        'IntegerExclusiveMaximum',
      ),
      ...branch(multipleOf, schema.multipleOf !== undefined, 26, 'IntegerMultipleOf'),
    ]
  }
  if (kind === 'boolean') {
    return []
  }
  if (kind === 'array') {
    const isFixed =
      length !== undefined && schema.minItems !== undefined && schema.minItems === schema.maxItems
    return [
      ...(isFixed
        ? [
            { type: 4, note: 'ArrayMinItems', message: length },
            { type: 2, note: 'ArrayMaxItems', message: length },
          ]
        : [
            ...branch(minItems, schema.minItems !== undefined, 4, 'ArrayMinItems'),
            ...branch(maxItems, schema.maxItems !== undefined, 2, 'ArrayMaxItems'),
          ]),
      ...branch(uniqueItems, schema.uniqueItems === true, 5, 'ArrayUniqueItems'),
      ...branch(contains, schema.contains !== undefined, 0, 'ArrayContains'),
      ...branch(minContains, schema.minContains !== undefined, 3, 'ArrayMinContains'),
      ...branch(maxContains, schema.maxContains !== undefined, 1, 'ArrayMaxContains'),
    ]
  }
  if (kind === 'object') {
    const requiredArr = Array.isArray(schema.required) ? schema.required : []
    return [
      ...branch(minProperties, schema.minProperties !== undefined, 44, 'ObjectMinProperties'),
      ...branch(maxProperties, schema.maxProperties !== undefined, 43, 'ObjectMaxProperties'),
      ...branch(requiredMessage, requiredArr.length > 0, 45, 'ObjectRequiredProperty'),
      ...branch(
        additionalPropertiesMessage,
        schema.additionalProperties === false,
        42,
        'ObjectAdditionalProperties',
      ),
    ]
  }
  const compositionMessage =
    (schema.anyOf ? implication : undefined) ?? oneOf ?? anyOf ?? enumMessage
  return [
    ...branch(
      compositionMessage,
      Boolean(schema.oneOf ?? schema.anyOf ?? schema.enum),
      62,
      'Union',
    ),
    ...branch(allOf, Boolean(schema.allOf), 29, 'Intersect'),
    ...branch(not, Boolean(schema.not), 34, 'Not'),
    ...branch(constMessage, schema.const !== undefined, 32, 'Literal'),
  ]
}

export function errorCallback(schema: Schema, kind: ErrorKind) {
  const fallback = schema['x-error-message']
  const branchList = branches(schema, kind)
  if (branchList.length === 0) {
    return fallback !== undefined ? (['error', fallback] as const) : undefined
  }
  const fallbackExpr = fallback !== undefined ? JSON.stringify(fallback) : 'undefined'
  const grouped = branchList.reduce<
    readonly { readonly message: string; readonly types: readonly number[] }[]
  >((acc, b) => {
    const last = acc.at(-1)
    if (last && last.message === b.message) {
      return [...acc.slice(0, -1), { message: last.message, types: [...last.types, b.type] }]
    }
    // One entry per distinct message on a numeric type union: a handful of items, where the
    // immutable shape is worth more than the copy.
    // oxlint-disable-next-line oxc/no-accumulating-spread
    return [...acc, { message: b.message, types: [b.type] }]
  }, [])
  const ifs = grouped
    .map((g) => {
      const cond = [...g.types]
        .toSorted((a, b) => a - b)
        .map((t) => `type===${t}`)
        .join('||')
      return `if(${cond})return ${JSON.stringify(g.message)}`
    })
    .join(';')
  const body = `(error)=>{const type=error?.errors?.[0]?.type;${ifs};return ${fallbackExpr}}`
  return ['error', raw(body)] as const
}

export function enumErrorCallback(schema: Schema) {
  const enumMessage = schema['x-enum-message']
  const fallback = schema['x-error-message']
  if (enumMessage === undefined) {
    return fallback !== undefined ? (['error', fallback] as const) : undefined
  }
  if (fallback === undefined) {
    return ['error', enumMessage] as const
  }
  const body = `(error)=>{const type=error?.errors?.[0]?.type;if(type===62)return ${JSON.stringify(enumMessage)};return ${JSON.stringify(fallback)}}`
  return ['error', raw(body)] as const
}

export function transformWrap(
  expr: string,
  schema: Schema,
  renderSubSchema?: (sub: Schema) => string,
) {
  const sections: readonly (Section | null)[] = [
    propertyNamesSection(schema),
    patternPropertiesSection(schema),
    dependentRequiredSection(schema),
    dependentSchemasSection(schema, renderSubSchema),
  ]
  const active = sections.filter((s): s is Section => s !== null)
  if (active.length === 0) return expr
  const prelude = active.flatMap((s) => s.prelude)
  const checks = active.map((s) => s.check)
  const preludeStr = prelude.length > 0 ? `${prelude.join(';')};` : ''
  const body = `(v)=>{${preludeStr}if(v&&typeof v==='object'){${checks.join(';')}}return v}`
  return `t.Transform(${expr}).Decode(${body}).Encode((v)=>v)`
}

type Section = { readonly prelude: readonly string[]; readonly check: string }

function propertyNamesSection(schema: Schema): Section | null {
  const message = schema['x-propertyNames-message']
  if (message === undefined) return null
  const pattern = schema.propertyNames?.pattern
  if (typeof pattern === 'string') {
    return {
      prelude: [`const propNamesRe=new RegExp(${JSON.stringify(pattern)})`],
      check: `for(const k of Object.keys(v)){if(!propNamesRe.test(k))throw new Error(${JSON.stringify(message)})}`,
    }
  }
  if (schema.propertyNames !== undefined) {
    const unsupported = Object.keys(schema.propertyNames).filter((k) => k !== 'pattern')
    if (unsupported.length > 0) {
      console.warn(
        `[asphodelos] x-propertyNames-message: only \`pattern\` is enforced via transform; ` +
          `ignoring ${unsupported.map((k) => `\`${k}\``).join(', ')} on propertyNames`,
      )
    }
  }
  return null
}

function patternPropertiesSection(schema: Schema): Section | null {
  const message = schema['x-patternProperties-message']
  const map = schema.patternProperties
  if (
    message === undefined ||
    !map ||
    Object.keys(map).length === 0 ||
    schema.additionalProperties !== false
  ) {
    return null
  }
  const arrLit = Object.keys(map)
    .map((p) => `new RegExp(${JSON.stringify(p)})`)
    .join(',')
  const declaredKeys = Object.keys(schema.properties ?? {})
  return {
    prelude: [
      `const patternPropsRes=[${arrLit}]`,
      `const declaredProps=new Set<string>(${JSON.stringify(declaredKeys)})`,
    ],
    check: `for(const k of Object.keys(v)){if(declaredProps.has(k))continue;if(!patternPropsRes.some(r=>r.test(k)))throw new Error(${JSON.stringify(message)})}`,
  }
}

function dependentRequiredSection(schema: Schema): Section | null {
  const message = schema['x-dependentRequired-message']
  const map = schema.dependentRequired
  if (message === undefined || !map || Object.keys(map).length === 0) return null
  const emptyEntries = Object.entries(map)
    .filter(([, requiredKeys]) => !requiredKeys || requiredKeys.length === 0)
    .map(([trigger]) => trigger)
  if (emptyEntries.length > 0) {
    console.warn(
      `[asphodelos] x-dependentRequired-message: dependentRequired entries with empty ` +
        `arrays are silently skipped — ${emptyEntries.map((t) => `\`${t}\``).join(', ')} ` +
        `produce no runtime check. Add at least one required key or remove the entry.`,
    )
  }
  const check = Object.entries(map)
    .map(([trigger, requiredKeys]) => {
      const triggerJson = JSON.stringify(trigger)
      const missing = (requiredKeys ?? []).map((k) => `!(${JSON.stringify(k)} in v)`).join('||')
      return missing
        ? `if(${triggerJson} in v&&(${missing}))throw new Error(${JSON.stringify(message)})`
        : null
    })
    .filter((s): s is string => s !== null)
    .join(';')
  return check ? { prelude: [], check } : null
}

function dependentSchemasSection(
  schema: Schema,
  renderSubSchema?: (sub: Schema) => string,
): Section | null {
  const message = schema['x-dependentSchemas-message']
  const map = schema.dependentSchemas
  if (message === undefined || !map || Object.keys(map).length === 0) return null
  if (renderSubSchema) {
    for (const [trigger, sub] of Object.entries(map)) {
      if (sub?.additionalProperties === false) {
        const declared = Object.keys(sub.properties ?? {})
        if (!declared.includes(trigger)) {
          console.warn(
            `[asphodelos] x-dependentSchemas-message: sub-schema for \`${trigger}\` has ` +
              `\`additionalProperties: false\` but does not list \`${trigger}\` in its ` +
              `properties. Per JSON Schema spec the dependent schema applies to the ` +
              `whole instance, so the trigger key itself is rejected as unexpected — ` +
              `every payload (including conforming ones) will fail. Add \`${trigger}\` ` +
              `to the sub-schema's properties, drop \`additionalProperties: false\`, ` +
              `or restructure the dependency.`,
          )
        }
      }
      const subType = sub?.type
      if (subType !== undefined && subType !== 'object') {
        console.warn(
          `[asphodelos] x-dependentSchemas-message: sub-schema for \`${trigger}\` has ` +
            `\`type: ${typeof subType === 'string' ? subType : JSON.stringify(subType)}\` — ` +
            `non-object sub-schemas can't match the parent object at runtime so every ` +
            `payload will fail. dependentSchemas applies to the whole instance; the ` +
            `sub-schema must be \`type: 'object'\` (or omit \`type\`).`,
        )
      }
    }
    const subsLit = Object.entries(map)
      .map(([trigger, sub]) => `${JSON.stringify(trigger)}:${renderSubSchema(sub)}`)
      .join(',')
    const check = Object.keys(map)
      .map(
        (trigger) =>
          `if(${JSON.stringify(trigger)} in v&&!Value.Check(depSubs[${JSON.stringify(trigger)}],v))throw new Error(${JSON.stringify(message)})`,
      )
      .join(';')
    return { prelude: [`const depSubs={${subsLit}}`], check }
  }
  console.warn(
    `[asphodelos] x-dependentSchemas-message: deep enforcement requires a renderSubSchema ` +
      `callback. Falling back to shallow \`required[]\`-only check; nested constraints in ` +
      `dependent sub-schemas (pattern, enum, …) will not be enforced at runtime.`,
  )
  const check = Object.entries(map)
    .map(([trigger, sub]) => {
      const triggerJson = JSON.stringify(trigger)
      const requiredKeys = Array.isArray(sub?.required) ? sub.required : []
      const missing = requiredKeys.map((k) => `!(${JSON.stringify(k)} in v)`).join('||')
      return missing
        ? `if(${triggerJson} in v&&(${missing}))throw new Error(${JSON.stringify(message)})`
        : null
    })
    .filter((s): s is string => s !== null)
    .join(';')
  return check ? { prelude: [], check } : null
}

function regexEscape(s: string) {
  return s.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function stringPatternFrom(schema: Schema) {
  if (schema.format === 'email' && typeof schema['x-emailRegex'] === 'string') {
    return schema['x-emailRegex']
  }
  const start = schema['x-startsWith']
  const incl = schema['x-includes']
  const end = schema['x-endsWith']
  if (start === undefined && incl === undefined && end === undefined) {
    return schema.pattern
  }
  const parts = [
    start !== undefined ? `^${regexEscape(start)}` : '',
    incl !== undefined ? regexEscape(incl) : '',
    end !== undefined ? `${regexEscape(end)}$` : '',
  ].filter((p) => p !== '')
  return parts.join('.*')
}

export function stringTransformWrap(expr: string, schema: Schema) {
  const steps: string[] = []
  if (schema['x-trim'] === true) steps.push('v.trim()')
  if (schema['x-toLowerCase'] === true || schema['x-lowercase'] === true) {
    steps.push('v.toLowerCase()')
  }
  if (schema['x-toUpperCase'] === true || schema['x-uppercase'] === true) {
    steps.push('v.toUpperCase()')
  }
  const norm = schema['x-normalize']
  if (norm === 'NFC' || norm === 'NFD' || norm === 'NFKC' || norm === 'NFKD') {
    steps.push(`v.normalize(${JSON.stringify(norm)})`)
  }
  if (steps.length === 0) return expr
  const body = steps.map((s) => `v=${s}`).join(';')
  return `t.Transform(${expr}).Decode((v)=>{${body};return v}).Encode((v)=>v)`
}

export function wrap(expr: string, schema: Schema) {
  const nullable =
    schema.nullable === true || (Array.isArray(schema.type) && schema.type.includes('null'))
  return nullable ? `t.Union([${expr},t.Null()])` : expr
}

export function readonly(expr: string, enabled?: boolean) {
  return enabled ? `t.Readonly(${expr})` : expr
}

export function brand(expr: string, schema: Schema) {
  const name = schema['x-brand']
  if (!name) return expr
  const TS_BASE_TYPE: { [k: string]: string } = {
    string: 'string',
    integer: 'number',
    number: 'number',
    boolean: 'boolean',
  }
  const primary =
    typeof schema.type === 'string'
      ? schema.type
      : Array.isArray(schema.type)
        ? schema.type.find((t) => t !== 'null')
        : undefined
  const base = primary ? TS_BASE_TYPE[primary] : undefined
  if (!base) return expr
  return `t.Unsafe<${base} & { readonly __brand: '${name}' }>(${expr})`
}
