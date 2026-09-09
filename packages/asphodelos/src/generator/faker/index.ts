import { isSchemaArray, isTypeArray } from '../../guard/index.js'
import {
  arrayLengthExpr,
  hasNumericConstraint,
  hasStringConstraint,
  numericFakerExpr,
  stringFakerExpr,
} from '../../helper/faker.js'
import type { OpenAPI, Schema, Type } from '../../openapi/index.js'

// A JS object key that is a valid identifier is emitted bare; anything else is
// quoted so a hostile property name cannot break out of the object literal.
function safeObjectKey(key: string) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key)
}

// Identifier for a schema's mock factory. Dots are dropped (`Foo.Bar` →
// `FooBar`) and any other non-identifier character is neutralized so a hostile
// `$ref`/component name cannot inject code at the call site.
export function mockName(schemaName: string) {
  return `mock${schemaName.replaceAll('.', '').replaceAll(/[^A-Za-z0-9_$]/g, '_')}`
}

const FORMAT_TO_FAKER: { [k: string]: string } = {
  date: 'faker.date.past().toISOString().slice(0, 10)',
  'date-time': 'faker.date.past().toISOString()',
  time: 'faker.date.past().toISOString().slice(11, 19)',
  uri: 'faker.internet.url()',
  url: 'faker.internet.url()',
  email: 'faker.internet.email()',
  ipv4: 'faker.internet.ipv4()',
  ipv6: 'faker.internet.ipv6()',
  hostname: 'faker.internet.domainName()',
  uuid: 'faker.string.uuid()',
  password: 'faker.internet.password()',
  binary: 'new Blob([faker.string.alphanumeric(100)])',
  byte: 'btoa(faker.string.alphanumeric(10))',
  int32: 'faker.number.int({ min: -2147483648, max: 2147483647 })',
  int64: 'faker.number.int({ min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER })',
  float: 'faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })',
  double: 'faker.number.float({ min: 0, max: 1000000, fractionDigits: 4 })',
}

const TYPE_TO_FAKER: { [k: string]: string } = {
  string: 'faker.string.alpha({ length: { min: 5, max: 20 } })',
  number: 'faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })',
  integer: 'faker.number.int({ min: 1, max: 1000 })',
  boolean: 'faker.datatype.boolean()',
  date: 'faker.date.past().toISOString()',
  null: 'null',
}

const PROPERTY_NAME_TO_FAKER: { [k: string]: string } = {
  id: 'faker.number.int({ min: 1, max: 99999 })',
  uuid: 'faker.string.uuid()',
  email: 'faker.internet.email()',
  name: 'faker.person.fullName()',
  firstName: 'faker.person.firstName()',
  lastName: 'faker.person.lastName()',
  username: 'faker.internet.username()',
  password: 'faker.internet.password()',
  phone: 'faker.phone.number()',
  address: 'faker.location.streetAddress()',
  city: 'faker.location.city()',
  state: 'faker.location.state()',
  country: 'faker.location.country()',
  zip: 'faker.location.zipCode()',
  zipCode: 'faker.location.zipCode()',
  url: 'faker.internet.url()',
  website: 'faker.internet.url()',
  createdAt: 'faker.date.past().toISOString()',
  updatedAt: 'faker.date.recent().toISOString()',
  deletedAt: 'faker.date.past().toISOString()',
  title: 'faker.lorem.sentence()',
  description: 'faker.lorem.paragraph()',
  content: 'faker.lorem.paragraphs(2)',
  status: "faker.helpers.arrayElement(['active', 'inactive', 'pending'])",
  type: "faker.helpers.arrayElement(['A', 'B', 'C'])",
  price: 'faker.number.float({ min: 1, max: 10000, fractionDigits: 2 })',
  quantity: 'faker.number.int({ min: 1, max: 100 })',
  count: 'faker.number.int({ min: 0, max: 1000 })',
  age: 'faker.number.int({ min: 1, max: 120 })',
}

// OpenAPI 3.1 / JSON Schema allow `type` to be an array (`['string', 'null']`).
// Collapse to a single representative type, preferring the first non-null member.
function primaryType(type: Type | readonly Type[] | undefined) {
  if (isTypeArray(type)) return type.find((t) => t !== 'null') ?? type[0]
  return type
}

export function schemaToFaker(schema: Schema, propertyName?: string): string {
  if (schema.const !== undefined) {
    return `${JSON.stringify(schema.const)} as const`
  }
  if (schema.enum && schema.enum.length > 0) {
    const values = schema.enum.map((v) => JSON.stringify(v)).join(', ')
    return `faker.helpers.arrayElement([${values}] as const)`
  }
  if (schema.$ref) {
    const refName = schema.$ref.split('/').pop() || 'unknown'
    return `${mockName(refName)}()`
  }
  const type = primaryType(schema.type)
  if (type === 'array' && schema.items) {
    const itemSchema = isSchemaArray(schema.items) ? schema.items[0] : schema.items
    if (!itemSchema) return '[]'
    const itemFaker = schemaToFaker(itemSchema)
    return `Array.from({ length: ${arrayLengthExpr(schema)} }, () => (${itemFaker}))`
  }
  const renderProps = (
    properties: { readonly [k: string]: Schema },
    required: readonly string[] | undefined,
  ) => {
    const requiredSet = new Set(required)
    return Object.entries(properties)
      .map(([k, v]) => {
        const key = safeObjectKey(k)
        const value = schemaToFaker(v, k)
        if (!(requiredSet.has(k) || v.nullable)) {
          return `${key}: faker.helpers.arrayElement([${value}, undefined])`
        }
        if (v.nullable) {
          return `${key}: faker.helpers.arrayElement([${value}, null])`
        }
        return `${key}: ${value}`
      })
      .join(', ')
  }
  if (type === 'object' && schema.properties) {
    return `{ ${renderProps(schema.properties, schema.required)} }`
  }
  if (type === 'object' && !schema.properties && schema.additionalProperties) {
    return '{}'
  }
  if (schema.allOf && schema.allOf.length > 0) {
    const merged = schema.allOf
      .map((s) => schemaToFaker(s, propertyName))
      .map((m) => `...${m}`)
      .join(', ')
    if (schema.properties) {
      return `{ ${merged}, ${renderProps(schema.properties, schema.required)} }`
    }
    return `{ ${merged} }`
  }
  const union =
    schema.oneOf && schema.oneOf.length > 0
      ? schema.oneOf
      : schema.anyOf && schema.anyOf.length > 0
        ? schema.anyOf
        : undefined
  if (union) {
    const variants = union.map((s) => schemaToFaker(s, propertyName)).join(', ')
    return `faker.helpers.arrayElement([${variants}])`
  }
  // An explicit numeric constraint is first-class input that the host (Elysia)
  // enforces, so it must win over the numeric format hints (int32/int64/float/
  // double) whose hard-coded ranges ignore it. A declared *string* format
  // (email/uuid/date-time…) is itself host-enforced, so it must be KEPT even
  // alongside a length constraint: dropping it for `alpha` would satisfy length
  // but guarantee a format rejection. The property-name map, by contrast, is a
  // name-based guess the host does not enforce, so a length/numeric constraint
  // suppresses it in favor of the constraint-aware type path.
  const constrainedNumeric =
    (type === 'integer' || type === 'number') && hasNumericConstraint(schema)
  const constrainedString = type === 'string' && hasStringConstraint(schema)
  const formatFaker = schema.format ? FORMAT_TO_FAKER[schema.format] : undefined
  if (formatFaker && !constrainedNumeric) {
    return formatFaker
  }
  if (
    propertyName &&
    PROPERTY_NAME_TO_FAKER[propertyName] &&
    !constrainedNumeric &&
    !constrainedString
  ) {
    const hint = PROPERTY_NAME_TO_FAKER[propertyName]
    const isNumberHint = hint.includes('faker.number.')
    if (!(isNumberHint && type === 'string')) {
      return hint
    }
  }
  if (type && TYPE_TO_FAKER[type]) {
    if (type === 'string') {
      return stringFakerExpr(schema)
    }
    if (type === 'integer') {
      return numericFakerExpr(schema, true)
    }
    if (type === 'number') {
      return numericFakerExpr(schema, false)
    }
    return TYPE_TO_FAKER[type]
  }
  return 'undefined'
}

// Transitively collect every `#/components/schemas/*` name reachable from a
// schema (through properties / items / allOf|oneOf|anyOf), guarding against
// cycles via `visited`.
export function collectSchemaRefs(
  schema: Schema,
  schemas?: { readonly [k: string]: Schema },
  visited: Set<string> = new Set<string>(),
): readonly string[] {
  if (schema.$ref) {
    const refName = schema.$ref.replace('#/components/schemas/', '')
    if (visited.has(refName)) return [] as const
    visited.add(refName)
    const referenced = schemas?.[refName]
    return [
      refName,
      ...(referenced ? collectSchemaRefs(referenced, schemas, visited) : ([] as const)),
    ]
  }
  const propRefs = schema.properties
    ? Object.values(schema.properties).flatMap((p) => collectSchemaRefs(p, schemas, visited))
    : []
  const items: readonly Schema[] = schema.items
    ? isSchemaArray(schema.items)
      ? schema.items
      : [schema.items]
    : []
  const itemRefs = items.flatMap((item) => collectSchemaRefs(item, schemas, visited))
  const compositeRefs = (['allOf', 'oneOf', 'anyOf'] as const).flatMap((k) => {
    const composite = schema[k]
    return composite ? composite.flatMap((sub) => collectSchemaRefs(sub, schemas, visited)) : []
  })
  return [...propRefs, ...itemRefs, ...compositeRefs] as const
}

function shallowRefs(schema: Schema): readonly string[] {
  const selfRef = schema.$ref ? [schema.$ref.replace('#/components/schemas/', '')] : []
  const propRefs = schema.properties ? Object.values(schema.properties).flatMap(shallowRefs) : []
  const items = schema.items ? (Array.isArray(schema.items) ? schema.items : [schema.items]) : []
  const itemRefs = items.flatMap(shallowRefs)
  const compositeRefs = (['allOf', 'oneOf', 'anyOf'] as const).flatMap((k) => {
    const composite = schema[k]
    return composite ? composite.flatMap(shallowRefs) : ([] as const)
  })
  return [...selfRef, ...propRefs, ...itemRefs, ...compositeRefs] as const
}

function reachesSelf(
  start: string,
  target: string,
  schemas: { [k: string]: Schema },
  visited: Set<string> = new Set<string>(),
): boolean {
  if (start === target) return true
  if (visited.has(start)) return false
  visited.add(start)
  const schema = schemas[start]
  if (!schema) return false
  return shallowRefs(schema).some((dep) => reachesSelf(dep, target, schemas, visited))
}

function detectCircularSchemas(schemas: { [k: string]: Schema }): Set<string> {
  return new Set(
    Object.keys(schemas).filter((name) => {
      const schema = schemas[name]
      if (!schema) return false
      return shallowRefs(schema).some((dep) => reachesSelf(dep, name, schemas))
    }),
  )
}

function topologicalOrder(
  usedSchemaNames: Set<string>,
  schemas: { [k: string]: Schema },
): readonly string[] {
  const visit = (name: string, visited: Set<string>, visiting: Set<string>): string[] => {
    if (visited.has(name) || !usedSchemaNames.has(name) || visiting.has(name)) return [] as const
    const nextVisiting = new Set(visiting).add(name)
    const schema = schemas[name]
    const depOrder = schema
      ? collectSchemaRefs(schema, schemas, new Set([name])).flatMap((dep) => {
          const subOrder = visit(dep, visited, nextVisiting)
          for (const n of subOrder) {
            visited.add(n)
          }
          return subOrder
        })
      : ([] as const)
    visited.add(name)
    return [...depOrder, name] as const
  }
  const visited = new Set<string>()
  return [...usedSchemaNames].flatMap((name) => visit(name, visited, new Set()))
}

// One `function mockX() { return <faker> }` per used component schema, ordered so
// a factory is declared before the factories that call it. Schemas on a reference
// cycle get a `: any` return type to escape TypeScript's infinite type expansion.
export function makeMockFunctions(spec: OpenAPI, usedSchemaNames: Set<string>) {
  if (!spec.components?.schemas || usedSchemaNames.size === 0) return ''
  const schemas = spec.components.schemas
  const circular = detectCircularSchemas(schemas)
  return topologicalOrder(usedSchemaNames, schemas)
    .map((name) => {
      const schema = schemas[name]
      const returnType = circular.has(name) ? ': any' : ''
      const value = schema ? schemaToFaker(schema) : 'undefined'
      return `function ${mockName(name)}()${returnType} {\n  return ${value}\n}`
    })
    .join('\n\n')
}
