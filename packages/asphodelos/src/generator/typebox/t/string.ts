import {
  commonOpts,
  errorCallback,
  options,
  stringPatternFrom,
  stringTransformWrap,
} from '../../../helper/typebox.js'
import type { Schema } from '../../../openapi/index.js'
import { filterDefined } from '../../../utils/index.js'
import type { TypeboxCtx } from '../index.js'

/**
 * The string formats Elysia registers with TypeBox (`elysia/type-system/format`).
 *
 * TypeBox rejects every value of a format it does not know, so a `format` outside this set is left
 * off the schema rather than turned into a validator that fails on its own input. `password` is
 * OpenAPI's hint to hide the text in a UI and says nothing about the value, so it is dropped in
 * silence; any other unknown format is reported, since the document meant something by it.
 */
const ELYSIA_STRING_FORMATS: ReadonlySet<string> = new Set([
  'date',
  'time',
  'date-time',
  'iso-time',
  'iso-date-time',
  'duration',
  'uri',
  'uri-reference',
  'uri-template',
  'url',
  'email',
  'hostname',
  'ipv4',
  'ipv6',
  'regex',
  'uuid',
  'json-pointer',
  'json-pointer-uri-fragment',
  'relative-json-pointer',
  'byte',
])

function validatedFormat(format: string | undefined) {
  if (format === undefined || ELYSIA_STRING_FORMATS.has(format)) return format
  if (format !== 'password') {
    console.warn(
      `[asphodelos] format '${format}' is not one Elysia validates; the string is emitted without it`,
    )
  }
  return undefined
}

export function string(schema: Schema, ctx: TypeboxCtx = {}) {
  if (schema.format === 'date' || schema.format === 'date-time') {
    return `t.Date(${options([...commonOpts(schema)])})`
  }
  if (schema.format === 'binary') {
    if (ctx.mediaType === 'application/octet-stream') {
      return `t.Uint8Array(${options([
        ['minByteLength', schema.minLength],
        ['maxByteLength', schema.maxLength],
        ...commonOpts(schema),
      ])})`
    }
    return `t.File(${options([
      ['type', schema.contentMediaType],
      ['minSize', schema.minLength],
      ['maxSize', schema.maxLength],
      ...commonOpts(schema),
    ])})`
  }
  const opts = options([
    ['format', validatedFormat(schema.format)],
    ['pattern', stringPatternFrom(schema)],
    ['minLength', schema.minLength],
    ['maxLength', schema.maxLength],
    ...filterDefined([errorCallback(schema, 'string')]),
    ...commonOpts(schema),
  ])
  return stringTransformWrap(`t.String(${opts})`, schema)
}
