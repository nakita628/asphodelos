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

const UUID_HEX = '[0-9a-fA-F]'
function uuidOfVersion(version: string) {
  return `^${UUID_HEX}{8}-${UUID_HEX}{4}-${version}${UUID_HEX}{3}-[89abAB]${UUID_HEX}{3}-${UUID_HEX}{12}$`
}
const OCTET = '(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])'
const H16 = '[0-9a-fA-F]{1,4}'
/** Every spelling of an IPv6 address, `::` compression included (RFC 4291 §2.2). */
const IPV6 = `(?:${[
  `(?:${H16}:){7}${H16}`,
  `(?:${H16}:){1,7}:`,
  `(?:${H16}:){1,6}:${H16}`,
  `(?:${H16}:){1,5}(?::${H16}){1,2}`,
  `(?:${H16}:){1,4}(?::${H16}){1,3}`,
  `(?:${H16}:){1,3}(?::${H16}){1,4}`,
  `(?:${H16}:){1,2}(?::${H16}){1,5}`,
  `${H16}:(?::${H16}){1,6}`,
  `:(?:(?::${H16}){1,7}|:)`,
].join('|')})`

/**
 * The string formats Elysia does not register but a regular expression decides, as the same
 * patterns Zod checks them with (hono-takibi generates those). They are emitted as `pattern`, so
 * the value is validated rather than passed through. A format that needs a checksum or a list —
 * `creditCard`, `iban`, `currencyCode` — or the Unicode property escapes TypeBox does not compile
 * (`emoji`) has none, and is still left off with a warning.
 */
const FORMAT_PATTERNS: { readonly [format: string]: string } = {
  ...Object.fromEntries(
    ['1', '2', '3', '4', '5', '6', '7', '8'].map((v) => [`uuidv${v}`, uuidOfVersion(v)]),
  ),
  guid: `^${UUID_HEX}{8}-${UUID_HEX}{4}-${UUID_HEX}{4}-${UUID_HEX}{4}-${UUID_HEX}{12}$`,
  hex: '^[0-9a-fA-F]*$',
  base64: '^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$',
  base64url: '^[A-Za-z0-9_-]*$',
  nanoid: '^[a-zA-Z0-9_-]{21}$',
  cuid2: '^[0-9a-z]+$',
  // cspell:ignore HJKMNP hjkmnp -- the ULID alphabet: Crockford's base32 leaves out I, L, O and U.
  ulid: '^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$',
  ksuid: '^[A-Za-z0-9]{27}$',
  xid: '^[0-9a-vA-V]{20}$',
  cidrv4: `^(?:${OCTET}\\.){3}${OCTET}\\/(?:[0-9]|[1-2][0-9]|3[0-2])$`,
  cidrv6: `^${IPV6}\\/(?:12[0-8]|1[01][0-9]|[1-9]?[0-9])$`,
  mac: '^(?:[0-9A-F]{2}:){5}[0-9A-F]{2}$|^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$',
  e164: '^\\+[0-9]{6,14}[0-9]$',
  httpUrl:
    '^https?:\\/\\/(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\\.)+[A-Za-z]{2,}(?::[0-9]{1,5})?(?:[/?#][^\\s]*)?$',
}

/**
 * Both patterns at once: the format's, checked from the start of the value, and the document's,
 * which JSON Schema matches anywhere in it.
 */
function bothPatterns(formatPattern: string, pattern: string) {
  return `^(?=(?:${formatPattern}))[\\s\\S]*?(?:${pattern})`
}

function validatedFormat(format: string | undefined) {
  if (format === undefined || ELYSIA_STRING_FORMATS.has(format)) return format
  if (format !== 'password' && FORMAT_PATTERNS[format] === undefined) {
    console.warn(
      `[asphodelos] format '${format}' is not one Elysia validates; the string is emitted without it`,
    )
  }
  return undefined
}

function patternOf(schema: Schema) {
  const pattern = stringPatternFrom(schema)
  const formatPattern = schema.format === undefined ? undefined : FORMAT_PATTERNS[schema.format]
  if (formatPattern === undefined) return pattern
  return pattern === undefined ? formatPattern : bothPatterns(formatPattern, pattern)
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
    ['pattern', patternOf(schema)],
    ['minLength', schema.minLength],
    ['maxLength', schema.maxLength],
    ...filterDefined([errorCallback(schema, 'string')]),
    ...commonOpts(schema),
  ])
  return stringTransformWrap(`t.String(${opts})`, schema)
}
