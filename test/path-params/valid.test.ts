// Every parameter shape the generator supports, sent as a real path segment. A path value is
// always single and always required, so each shape has a route of its own (`/<shape>/{value}`) and
// fails alone.
//
// How to read a test:
//   Every route answers `{ valueType, valueText }`: the runtime type the parameter arrived as in the
//   handler, and the value as text. A rejected request answers 422 with `{ issues: [...] }`, the
//   name of each parameter that failed — or `''` where Elysia validates a coerced number on its own
//   and reports it without a path.
//
// This file holds the requests that are accepted. Each answers 200, and the test asserts the type
// and the value that reached the handler.
import { describe, expect, it } from 'bun:test'

import { pathParamsApp } from './app.js'

async function get(url: string, method = 'GET') {
  const res = await pathParamsApp.handle(new Request(`http://localhost${url}`, { method }))
  const body: unknown = await res.json()
  return { status: res.status, body }
}

const q = (value: string) => encodeURIComponent(value)

// One canonical value per shape. The value is compared as well as the type: a coercion that
// changes the value (a truncated int64, a re-serialized float) is as wrong as one that changes the
// type.
describe('shapes: every supported shape accepts its own value', () => {
  it.each([
    ['integer', '42', 'number', '42'],
    ['int32', '42', 'number', '42'],
    // `int64` is read into a number: exact up to Number.MAX_SAFE_INTEGER, refused beyond it.
    ['int64', '9007199254740991', 'number', '9007199254740991'],
    ['number', '1.5', 'number', '1.5'],
    ['double', '1.5', 'number', '1.5'],
    // A boolean arrives as a boolean, not as the text "true".
    ['boolean', 'true', 'boolean', 'true'],
    ['boolean', 'false', 'boolean', 'false'],
    ['string', 'plain', 'string', 'plain'],
    ['email', 'user@example.com', 'string', 'user@example.com'],
    [
      'uuid',
      '0190b1f4-0000-7000-8000-000000000000',
      'string',
      '0190b1f4-0000-7000-8000-000000000000',
    ],
    // A UUID may be spelled in upper case.
    [
      'uuid',
      'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D',
      'string',
      'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D',
    ],
    ['hostname', 'example.com', 'string', 'example.com'],
    ['ipv4', '192.168.0.1', 'string', '192.168.0.1'],
    // `format: date` and `format: date-time` are generated as `t.Date()`, so they arrive as a Date.
    ['date', '2020-01-02', 'Date', '2020-01-02T00:00:00.000Z'],
    ['datetime', '2020-01-02T03:04:05Z', 'Date', '2020-01-02T03:04:05.000Z'],
    ['byte', 'aGVsbG8=', 'string', 'aGVsbG8='],
    // `format: password` is a hint to hide the text; the value is a plain string.
    ['password', 'hunter2', 'string', 'hunter2'],
    ['password', 'p@ss w0rd', 'string', 'p@ss w0rd'],
  ])('%s accepts %j', async (name, value, valueType, valueText) => {
    const { status, body } = await get(`/${name}/${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ valueType, valueText })
  })
})

describe('integers: accepted boundaries', () => {
  it.each([
    ['integer', '-7', '-7'],
    ['integer', '0', '0'],
    ['integer', '9007199254740991', '9007199254740991'],
    ['int32', '2147483647', '2147483647'],
    ['int32', '-2147483648', '-2147483648'],
  ])('%s accepts %j', async (name, value, valueText) => {
    const { status, body } = await get(`/${name}/${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ valueType: 'number', valueText })
  })
})

describe('floats: accepted values', () => {
  it.each([
    ['.5', '0.5'],
    ['5.', '5'],
    ['1e3', '1000'],
    ['-0', '0'],
  ])('number accepts %j', async (value, valueText) => {
    const { status, body } = await get(`/number/${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ valueType: 'number', valueText })
  })
})

// A string takes any text; what the wire carries percent-encoded reaches the handler decoded.
describe('wire: percent-encoding', () => {
  it.each([
    ['42', '42'],
    ['true', 'true'],
    ['a b', 'a b'],
    ['a/b', 'a/b'],
    ['a?b', 'a?b'],
    ['a#b', 'a#b'],
    ['日本語', '日本語'],
    ['🔥', '🔥'],
    [' ', ' '],
  ])('string accepts %j', async (value, valueText) => {
    const { status, body } = await get(`/string/${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ valueType: 'string', valueText })
  })
})

describe('literals: enum and const', () => {
  it.each(['asc', 'desc'])('senum accepts %j', async (value) => {
    const { status, body } = await get(`/senum/${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ valueType: 'string', valueText: value })
  })

  it('sconst accepts its one value', async () => {
    const { status, body } = await get('/sconst/fixed')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ valueType: 'string', valueText: 'fixed' })
  })

  // A string enum whose members look like numbers and booleans stays text.
  it.each(['1', '02', 'true'])('numericsenum accepts %j as text', async (value) => {
    const { status, body } = await get(`/numericsenum/${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ valueType: 'string', valueText: value })
  })
})

// A constraint on a numeric parameter applies to the coerced value, not to the text.
describe('constraints: numeric and string', () => {
  it.each([
    ['range', '1', { valueType: 'number', valueText: '1' }],
    ['range', '10', { valueType: 'number', valueText: '10' }],
    ['exclusive', '0.5', { valueType: 'number', valueText: '0.5' }],
    ['multiple', '15', { valueType: 'number', valueText: '15' }],
    ['multiple', '0', { valueType: 'number', valueText: '0' }],
    ['length', 'ab', { valueType: 'string', valueText: 'ab' }],
    ['length', 'abcd', { valueType: 'string', valueText: 'abcd' }],
    ['pattern', 'abc-12', { valueType: 'string', valueText: 'abc-12' }],
  ])('%s accepts %j', async (name, value, echo) => {
    const { status, body } = await get(`/${name}/${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual(echo)
  })
})

describe('declarations: several parameters in one path', () => {
  it('reads each parameter as its own type', async () => {
    const { status, body } = await get(
      '/orgs/1/repos/0190b1f4-0000-7000-8000-000000000000/issues/9007199254740991',
    )
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      orgId: { valueType: 'number', valueText: '1' },
      repoId: { valueType: 'string', valueText: '0190b1f4-0000-7000-8000-000000000000' },
      issueId: { valueType: 'number', valueText: '9007199254740991' },
    })
  })
})

describe('declarations: parameter names that are not identifiers', () => {
  it('reads each parameter under its own name', async () => {
    const { status, body } = await get('/named/7/true')
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      'user-id': { valueType: 'number', valueText: '7' },
      post_id: { valueType: 'boolean', valueText: 'true' },
    })
  })
})

describe('declarations: $ref and path-item level', () => {
  it('reads a parameter declared as a component', async () => {
    const { status, body } = await get('/paramref/3')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ valueType: 'number', valueText: '3' })
  })

  // The component is written for a typed value; the text is read before it reaches it.
  it.each(['3', '0'])('reads %j through a schema component', async (value) => {
    const { status, body } = await get(`/schemaref/${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ valueType: 'number', valueText: value })
  })

  // Declared once on the path item, the parameter reaches every operation under it.
  it.each(['GET', 'DELETE'])('%s reads the parameter the path item declares', async (method) => {
    const { status, body } = await get('/shared/3', method)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ valueType: 'number', valueText: '3' })
  })

  // The operation's own declaration replaces the path item's for the same name.
  it("reads the operation's override, a uuid, where the path item said integer", async () => {
    const { status, body } = await get('/override/0190b1f4-0000-7000-8000-000000000000')
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      valueType: 'string',
      valueText: '0190b1f4-0000-7000-8000-000000000000',
    })
  })
})

// The `x-*` extensions transform the segment before the handler sees it; paired with a format,
// the transform runs and the format still validates.
describe('transforms: x-* extensions', () => {
  it.each([
    ['txupper', 'abc', 'ABC'],
    ['txemail', 'User@Example.COM', 'user@example.com'],
  ])('%s reads %j as %j', async (name, value, valueText) => {
    const { status, body } = await get(`/${name}/${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ valueType: 'string', valueText })
  })
})

// The segment is read once, around the whole schema.
describe('combinators: oneOf and allOf', () => {
  it.each([
    ['allof', '7', { valueType: 'number', valueText: '7' }],
    ['oneof', '5', { valueType: 'number', valueText: '5' }],
    ['oneof', 'all', { valueType: 'string', valueText: 'all' }],
  ])('%s accepts %j', async (name, value, echo) => {
    const { status, body } = await get(`/${name}/${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual(echo)
  })
})

// What Elysia reads beyond the plainest spelling. Pinned so a change in Elysia is noticed, not
// endorsed: a server that wants to refuse these needs a `pattern` of its own.
describe('leniency: what is read beyond the plainest spelling (pinned, not endorsed)', () => {
  it.each([
    // `Number()` reads a leading zero, an exponent, a hex literal and surrounding whitespace.
    ['integer', '007', { valueType: 'number', valueText: '7' }],
    ['integer', '1e3', { valueType: 'number', valueText: '1000' }],
    ['integer', '0x10', { valueType: 'number', valueText: '16' }],
    ['integer', ' 42', { valueType: 'number', valueText: '42' }],
    // `Date` reads past the end of a month, and a date-time without its time.
    ['date', '2020-02-30', { valueType: 'Date', valueText: '2020-03-01T00:00:00.000Z' }],
    ['datetime', '2020-01-02', { valueType: 'Date', valueText: '2020-01-02T00:00:00.000Z' }],
  ])('%s reads %j', async (name, value, echo) => {
    const { status, body } = await get(`/${name}/${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual(echo)
  })
})
