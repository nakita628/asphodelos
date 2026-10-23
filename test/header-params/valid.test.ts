// Every parameter shape the generator supports, sent as a real header and checked for the
// JavaScript type and value it arrives as. A header is text like a query value, but Elysia reads it
// out of the header map, whose names are lower-case and whose values the Fetch API has trimmed: a
// schema keyed by the declared spelling, or written for a typed value, rejects its own input.
//
// How to read a test:
//   Every route answers the headers its handler received, by name, each described as
//   `{ valueType, valueText }`: the runtime type and the value as text. A header that was not sent
//   and has no default is absent from the answer, and so is one the schema does not declare. A
//   rejected request answers 422 with `{ issues: [...] }`, the name of every header that failed —
//   or `''` where Elysia validates a coerced number on its own and reports it without a path.
//
// Routes:
//   /headers   every shape as `x-<shape>`, and the arrays `x-ids` and `x-tags`, all optional
//   /optional  literals, constraints, transforms, a $ref, an object, null and odd names
//   /defaults  headers with a default
//   /required  required headers
//
// This file holds the requests that are accepted. Each answers 200, and the test asserts the type
// and the value that reached the handler.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { resumeHappyDom, suspendHappyDom } from '../happydom.js'
import { headerParamsApp } from './app.js'

// The runtime's own `Request`, not happy-dom's: a header name is lower-cased and a value trimmed
// by the Fetch API, which is what the generated schema is keyed for.
beforeAll(suspendHappyDom)
afterAll(resumeHappyDom)

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await headerParamsApp.handle(new Request(`http://localhost${path}`, { headers }))
  const body: unknown = await res.json()
  return { status: res.status, body }
}

// One canonical value per shape, sent alone. The value is compared as well as the type: a coercion
// that changes the value is as wrong as one that changes the type.
describe('shapes: every supported shape accepts its own value', () => {
  it.each([
    // An integer with no format, and every numeric format, arrives as a number.
    ['x-integer', '42', 'number', '42'],
    ['x-int32', '42', 'number', '42'],
    // `int64` is read into a number: exact up to Number.MAX_SAFE_INTEGER, refused beyond it.
    ['x-int64', '9007199254740991', 'number', '9007199254740991'],
    ['x-number', '1.5', 'number', '1.5'],
    ['x-float', '1.5', 'number', '1.5'],
    ['x-double', '1.5', 'number', '1.5'],
    // A boolean arrives as a boolean, not as the text "true".
    ['x-boolean', 'true', 'boolean', 'true'],
    ['x-boolean', 'false', 'boolean', 'false'],
    // A string arrives unchanged.
    ['x-string', 'plain', 'string', 'plain'],
    ['x-email', 'user@example.com', 'string', 'user@example.com'],
    [
      'x-uuid',
      '0190b1f4-0000-7000-8000-000000000000',
      'string',
      '0190b1f4-0000-7000-8000-000000000000',
    ],
    ['x-uri', 'https://example.com', 'string', 'https://example.com'],
    ['x-url', 'https://example.com', 'string', 'https://example.com'],
    ['x-hostname', 'example.com', 'string', 'example.com'],
    ['x-ipv4', '192.168.0.1', 'string', '192.168.0.1'],
    ['x-ipv6', '2001:db8::1', 'string', '2001:db8::1'],
    // `format: date` and `format: date-time` are generated as `t.Date()`, so they arrive as a Date.
    ['x-date', '2020-01-02', 'Date', '2020-01-02T00:00:00.000Z'],
    ['x-datetime', '2020-01-02T03:04:05Z', 'Date', '2020-01-02T03:04:05.000Z'],
    // An RFC 3339 time carries its offset.
    ['x-time', '12:34:56Z', 'string', '12:34:56Z'],
    ['x-duration', 'P1Y2M3DT4H5M6S', 'string', 'P1Y2M3DT4H5M6S'],
    ['x-byte', 'aGVsbG8=', 'string', 'aGVsbG8='],
    // `format: password` is a hint to hide the text; the value is a plain string.
    ['x-password', 'hunter2', 'string', 'hunter2'],
  ])('%s accepts %j', async (name, value, valueType, valueText) => {
    const { status, body } = await get('/headers', { [name]: value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: { valueType, valueText } })
  })

  // The schema is keyed by the lower-case name, and the Fetch API lower-cases the name sent.
  it('reads a header whatever case it is sent in', async () => {
    const { status, body } = await get('/headers', { 'X-INTEGER': '42' })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ 'x-integer': { valueType: 'number', valueText: '42' } })
  })
})

describe('integers: accepted boundaries', () => {
  it.each([
    ['x-integer', '-7'],
    ['x-integer', '0'],
    ['x-integer', '9007199254740991'],
    ['x-integer', '-9007199254740991'],
    ['x-int32', '2147483647'],
    ['x-int32', '-2147483648'],
  ])('%s accepts %j', async (name, value) => {
    const { status, body } = await get('/headers', { [name]: value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: { valueType: 'number', valueText: value } })
  })
})

describe('floats: accepted values', () => {
  it.each([
    ['.5', '0.5'],
    ['5.', '5'],
    ['1e3', '1000'],
    ['-0', '0'],
  ])('x-number accepts %j', async (value, valueText) => {
    const { status, body } = await get('/headers', { 'x-number': value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ 'x-number': { valueType: 'number', valueText } })
  })
})

describe('formats: what each string format accepts', () => {
  it.each([
    ['x-email', 'USER@EXAMPLE.COM'],
    ['x-email', 'user+tag@example.com'],
    ['x-uuid', '0190B1F4-0000-7000-8000-000000000000'],
    ['x-uri', 'urn:isbn:0451450523'],
    ['x-url', 'ftp://example.com'],
    ['x-hostname', 'localhost'],
    ['x-ipv4', '0.0.0.0'],
    ['x-ipv6', '::1'],
    ['x-time', '12:34:56+09:00'],
    ['x-duration', 'PT1S'],
    ['x-byte', 'YQ=='],
  ])('%s accepts %j', async (name, value) => {
    const { status, body } = await get('/headers', { [name]: value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: { valueType: 'string', valueText: value } })
  })
})

describe('literals: enum and const', () => {
  it.each(['asc', 'desc'])('x-senum accepts %j', async (value) => {
    const { status, body } = await get('/optional', { 'x-senum': value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ 'x-senum': { valueType: 'string', valueText: value } })
  })

  it('x-sconst accepts its one value', async () => {
    const { status, body } = await get('/optional', { 'x-sconst': 'fixed' })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ 'x-sconst': { valueType: 'string', valueText: 'fixed' } })
  })

  // A `oneOf` with an integer member coerces the member that fits.
  it.each([
    ['5', { valueType: 'number', valueText: '5' }],
    ['all', { valueType: 'string', valueText: 'all' }],
  ])('x-oneof accepts %j', async (value, echo) => {
    const { status, body } = await get('/optional', { 'x-oneof': value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ 'x-oneof': echo })
  })

  // An optional enum without a default is absent when it is not sent.
  it('an absent enum stays absent', async () => {
    const { status, body } = await get('/optional')
    expect(status).toBe(200)
    expect(body).toStrictEqual({})
  })
})

// A constraint on a numeric header applies to the coerced value, not to the text.
describe('constraints', () => {
  it.each([
    ['x-range', '1', { valueType: 'number', valueText: '1' }],
    ['x-range', '100', { valueType: 'number', valueText: '100' }],
    ['x-length', 'ab', { valueType: 'string', valueText: 'ab' }],
    ['x-length', 'abcd', { valueType: 'string', valueText: 'abcd' }],
    ['x-pattern', 'abc-12', { valueType: 'string', valueText: 'abc-12' }],
  ])('%s accepts %j', async (name, value, echo) => {
    const { status, body } = await get('/optional', { [name]: value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })
})

// The `x-*` extensions transform the value before the handler sees it; paired with a format, the
// transform runs and the format still validates.
describe('transforms: x-* extensions', () => {
  it.each([
    ['x-lower', 'MiXeD', 'mixed'],
    ['x-email-lower', 'User@Example.COM', 'user@example.com'],
  ])('%s reads %j as %j', async (name, value, valueText) => {
    const { status, body } = await get('/optional', { [name]: value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: { valueType: 'string', valueText } })
  })
})

describe('references: a schema behind $ref', () => {
  // The component is written for a typed value; the text is read before it reaches it.
  it.each(['3', '0'])('x-ref-int accepts %j through the component', async (value) => {
    const { status, body } = await get('/optional', { 'x-ref-int': value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ 'x-ref-int': { valueType: 'number', valueText: value } })
  })
})

// An object header is read from one JSON-encoded value, each property typed.
describe('objects: an object in one header', () => {
  it('x-obj is read from a JSON-encoded value', async () => {
    const { status, body } = await get('/optional', { 'x-obj': '{"a":1,"b":"x"}' })
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      'x-obj': {
        a: { valueType: 'number', valueText: '1' },
        b: { valueType: 'string', valueText: 'x' },
      },
    })
  })
})

// A header name is case-insensitive on the wire, and Elysia hands every header over in lower
// case: the generated schema keys a mixed-case declaration by its lower-case name, which is how
// the handler sees it.
describe('names: what a header is called', () => {
  it.each([
    ['X-Request-Id', 'x-request-id', '0190b1f4-0000-7000-8000-000000000000', 'string'],
    ['x-request-id', 'x-request-id', '0190b1f4-0000-7000-8000-000000000000', 'string'],
    ['X-Rate-Limit', 'x-rate-limit', '5', 'number'],
    ['x-rate-limit', 'x-rate-limit', '5', 'number'],
    ['accept-version', 'accept-version', '2', 'number'],
    ['x_underscore', 'x_underscore', '3', 'number'],
  ])('%s is read as %s', async (sent, key, value, valueType) => {
    const { status, body } = await get('/optional', { [sent]: value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [key]: { valueType, valueText: value } })
  })
})

describe('optional: absent and present', () => {
  it.each([
    ['x-int-opt', '1', { valueType: 'number', valueText: '1' }],
    ['x-bool-opt', 'true', { valueType: 'boolean', valueText: 'true' }],
    // An empty string is a value for a string.
    ['x-str-opt', '', { valueType: 'string', valueText: '' }],
  ])('%s is present when sent', async (name, value, echo) => {
    const { status, body } = await get('/optional', { [name]: value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })

  it('accepts several headers in one request', async () => {
    const { status, body } = await get('/optional', { 'x-int-opt': '1', 'x-str-opt': 's' })
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      'x-int-opt': { valueType: 'number', valueText: '1' },
      'x-str-opt': { valueType: 'string', valueText: 's' },
    })
  })

  // A header the schema does not declare is dropped.
  it('drops an undeclared header', async () => {
    const { status, body } = await get('/optional', { 'x-unknown': '1' })
    expect(status).toBe(200)
    expect(body).toStrictEqual({})
  })

  // A nullable integer takes an integer; what it cannot take is in invalid.test.ts.
  it('x-inull reads an integer', async () => {
    const { status, body } = await get('/optional', { 'x-inull': '5' })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ 'x-inull': { valueType: 'number', valueText: '5' } })
  })
})

describe('defaults', () => {
  const DEFAULTS = {
    'x-int-def': { valueType: 'number', valueText: '20' },
    'x-bool-def': { valueType: 'boolean', valueText: 'false' },
    'x-str-def': { valueType: 'string', valueText: 'fallback' },
    'x-enum-def': { valueType: 'string', valueText: 'asc' },
  }

  // Every absent header falls back to its default, typed as the schema says.
  it('fills every absent header with its default', async () => {
    const { status, body } = await get('/defaults')
    expect(status).toBe(200)
    expect(body).toStrictEqual(DEFAULTS)
  })

  it.each([
    ['x-int-def', '7', { valueType: 'number', valueText: '7' }],
    ['x-bool-def', 'true', { valueType: 'boolean', valueText: 'true' }],
    ['x-enum-def', 'desc', { valueType: 'string', valueText: 'desc' }],
    // An empty string is a sent value, not an absent one.
    ['x-str-def', '', { valueType: 'string', valueText: '' }],
  ])('%s keeps the value that was sent', async (name, value, echo) => {
    const { status, body } = await get('/defaults', { [name]: value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ ...DEFAULTS, [name]: echo })
  })
})

describe('required', () => {
  it('accepts every required header', async () => {
    const { status, body } = await get('/required', {
      'x-id': '1',
      'x-flag': 'true',
      'x-name': 'n',
    })
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      'x-id': { valueType: 'number', valueText: '1' },
      'x-flag': { valueType: 'boolean', valueText: 'true' },
      'x-name': { valueType: 'string', valueText: 'n' },
    })
  })

  // A required string may be empty: present is what required means.
  it('accepts an empty required string', async () => {
    const { status, body } = await get('/required', {
      'x-id': '1',
      'x-flag': 'true',
      'x-name': '',
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ 'x-name': { valueType: 'string', valueText: '' } })
  })

  it('accepts the optional header beside the required ones', async () => {
    const { status, body } = await get('/required', {
      'x-id': '1',
      'x-flag': 'true',
      'x-name': 'n',
      'x-note': '5',
    })
    expect(status).toBe(200)
    expect(body).toMatchObject({ 'x-note': { valueType: 'number', valueText: '5' } })
  })
})

// What Elysia reads beyond the plainest spelling. Pinned so a change in Elysia is noticed, not
// endorsed: a server that wants to refuse these needs a `pattern` of its own.
describe('leniency: what is read beyond the plainest spelling (pinned, not endorsed)', () => {
  it.each([
    // `Number()` reads a leading zero, an exponent and a hex literal.
    ['x-integer', '007', { valueType: 'number', valueText: '7' }],
    ['x-integer', '1e3', { valueType: 'number', valueText: '1000' }],
    ['x-integer', '0x10', { valueType: 'number', valueText: '16' }],
    // The Fetch API trims the whitespace around a header value before it is sent.
    ['x-integer', ' 42 ', { valueType: 'number', valueText: '42' }],
    // `Date` reads past the end of a month, and a date-time without its time.
    ['x-date', '2020-02-30', { valueType: 'Date', valueText: '2020-03-01T00:00:00.000Z' }],
    ['x-datetime', '2020-01-02', { valueType: 'Date', valueText: '2020-01-02T00:00:00.000Z' }],
  ])('%s reads %j', async (name, value, echo) => {
    const { status, body } = await get('/headers', { [name]: value })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })
})
