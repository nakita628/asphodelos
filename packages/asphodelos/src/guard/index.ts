import type { Reference, Schema, Type } from '../openapi/index.js'

export function isReference(v: unknown): v is Reference {
  return (
    typeof v === 'object' && v !== null && '$ref' in v && typeof v.$ref === 'string' && !!v.$ref
  )
}

export function isStringRef(v: object): v is { readonly $ref: string } {
  return '$ref' in v && typeof v.$ref === 'string'
}

export function isRecord(v: unknown): v is { readonly [k: string]: unknown } {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function isMediaWithSchema(v: unknown): v is { readonly schema: Schema } {
  return typeof v === 'object' && v !== null && !Array.isArray(v) && 'schema' in v
}

export function isSecurityArray(
  v: unknown,
): v is readonly { readonly [k: string]: readonly string[] }[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'object' && x !== null)
}

export function isSchemaArray(v: Schema | readonly Schema[] | undefined): v is readonly Schema[] {
  return Array.isArray(v)
}

export function isTypeArray(v: Type | readonly Type[] | undefined): v is readonly Type[] {
  return Array.isArray(v)
}
