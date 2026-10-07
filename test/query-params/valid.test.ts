// Every parameter shape the generator supports, sent as a real query string and checked for the
// JavaScript type and value it arrives as. HTTP carries all of them as strings, so a schema Elysia
// cannot read back into its type rejects its own input: the failure this file exists to catch.
//
// How to read a test:
//   Every route answers the parameters its handler received, by name, each described as
//   `{ valueType, valueText }`: the runtime type and the value as text. A parameter that was not
//   sent and has no default is absent from the answer. A rejected request answers 422 with
//   `{ issues: [...] }`, the name of every parameter that failed — or `''` where Elysia validates a
//   coerced number on its own and reports it without a path.
//
// Routes:
//   /params      every shape, scalar (`<shape>`) and array (`<shape>_arr`), all optional
//   /literals    enum and const
//   /optional    optional parameters and odd names
//   /defaults    parameters with a default
//   /required    required parameters
//   /limits      constraints
//   /refs        a schema and a parameter behind $ref
//   /inherited   parameters declared on the path item
//   /styles      serializations other than form + explode, objects, allowEmptyValue
//   /combinators allOf, oneOf, anyOf and the x-* transforms
//   /limitations what the generated schema declares but Elysia does not read
//
// This file holds the requests that are accepted. Each answers 200, and the test asserts the type
// and the value that reached the handler.
import { describe, expect, it } from 'bun:test'

import { queryParamsApp } from './app.js'

async function get(url: string) {
  const res = await queryParamsApp.handle(new Request(`http://localhost${url}`))
  const body: unknown = await res.json()
  return { status: res.status, body }
}

const q = (value: string) => encodeURIComponent(value)

// One canonical value per shape, sent alone as ?<shape>=<value>. The value is compared as well as
// the type: a coercion that changes the value is as wrong as one that changes the type.
describe('shapes: every supported shape accepts its own value', () => {
  it.each([
    // An integer with no format, and every numeric format, arrives as a number.
    ['integer', '42', 'number', '42'],
    ['int32', '42', 'number', '42'],
    // `int64` is read into a number: exact up to Number.MAX_SAFE_INTEGER, refused beyond it.
    ['int64', '9007199254740991', 'number', '9007199254740991'],
    ['number', '1.5', 'number', '1.5'],
    ['float', '1.5', 'number', '1.5'],
    ['double', '1.5', 'number', '1.5'],
    // A boolean arrives as a boolean, not as the text "true".
    ['boolean', 'true', 'boolean', 'true'],
    ['boolean', 'false', 'boolean', 'false'],
    // A string arrives unchanged.
    ['string', 'plain', 'string', 'plain'],
    ['email', 'user@example.com', 'string', 'user@example.com'],
    [
      'uuid',
      '0190b1f4-0000-7000-8000-000000000000',
      'string',
      '0190b1f4-0000-7000-8000-000000000000',
    ],
    ['uri', 'https://example.com', 'string', 'https://example.com'],
    ['url', 'https://example.com', 'string', 'https://example.com'],
    ['hostname', 'example.com', 'string', 'example.com'],
    ['ipv4', '192.168.0.1', 'string', '192.168.0.1'],
    ['ipv6', '2001:db8::1', 'string', '2001:db8::1'],
    // `format: date` and `format: date-time` are generated as `t.Date()`, so they arrive as a Date.
    ['date', '2020-01-02', 'Date', '2020-01-02T00:00:00.000Z'],
    ['datetime', '2020-01-02T03:04:05Z', 'Date', '2020-01-02T03:04:05.000Z'],
    // An RFC 3339 time carries its offset.
    ['time', '12:34:56Z', 'string', '12:34:56Z'],
    ['duration', 'P1Y2M3DT4H5M6S', 'string', 'P1Y2M3DT4H5M6S'],
    ['byte', 'aGVsbG8=', 'string', 'aGVsbG8='],
    // `format: password` is a hint to hide the text; the value is a plain string.
    ['password', 'hunter2', 'string', 'hunter2'],
  ])('%s accepts %j', async (name, value, valueType, valueText) => {
    const { status, body } = await get(`/params?${name}=${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: { valueType, valueText } })
  })
})

// The parameter is repeated, ?<shape>_arr=<value>&<shape>_arr=<value>, which is how an exploded
// array is serialized. Every element must be coerced, not just the first.
describe('shapes: every array shape', () => {
  it.each([
    ['integer_arr', ['42', '7'], 'number'],
    ['int32_arr', ['1', '2'], 'number'],
    ['number_arr', ['1.5', '2'], 'number'],
    ['boolean_arr', ['true', 'false'], 'boolean'],
    ['string_arr', ['a', 'b'], 'string'],
    ['email_arr', ['a@example.com', 'b@example.com'], 'string'],
  ])('%s accepts two values', async (name, values, valueType) => {
    const query = values.map((value) => `${name}=${q(value)}`).join('&')
    const { status, body } = await get(`/params?${query}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      [name]: values.map((value) => ({ valueType, valueText: String(Number(value) || value) })),
    })
  })

  // A single repetition is still an array of one element, not a scalar.
  it.each([
    ['integer_arr', '42', 'number'],
    ['string_arr', 'a', 'string'],
  ])('%s accepts one value as a one-element array', async (name, value, valueType) => {
    const { status, body } = await get(`/params?${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: [{ valueType, valueText: value }] })
  })

  // Elysia also reads the `form` + `explode: false` serialization, one value with commas.
  it('integer_arr accepts a comma-separated value', async () => {
    const { status, body } = await get('/params?integer_arr=1,2')
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      integer_arr: [
        { valueType: 'number', valueText: '1' },
        { valueType: 'number', valueText: '2' },
      ],
    })
  })
})

describe('integers: accepted boundaries', () => {
  it.each([
    ['integer', '-7', '-7'],
    ['integer', '0', '0'],
    ['integer', '9007199254740991', '9007199254740991'],
    ['integer', '-9007199254740991', '-9007199254740991'],
    ['int32', '2147483647', '2147483647'],
    ['int32', '-2147483648', '-2147483648'],
  ])('%s accepts %j', async (name, value, valueText) => {
    const { status, body } = await get(`/params?${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: { valueType: 'number', valueText } })
  })
})

describe('floats: accepted values', () => {
  it.each([
    ['.5', '0.5'],
    ['5.', '5'],
    ['1e3', '1000'],
    ['-0', '0'],
  ])('number accepts %j', async (value, valueText) => {
    const { status, body } = await get(`/params?number=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ number: { valueType: 'number', valueText } })
  })
})

describe('literals: enum and const', () => {
  it.each(['asc', 'desc'])('senum accepts %j', async (value) => {
    const { status, body } = await get(`/literals?senum=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ senum: { valueType: 'string', valueText: value } })
  })

  it('senum_arr accepts members', async () => {
    const { status, body } = await get('/literals?senum_arr=asc&senum_arr=desc')
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      senum_arr: [
        { valueType: 'string', valueText: 'asc' },
        { valueType: 'string', valueText: 'desc' },
      ],
    })
  })

  it('sconst accepts its one value', async () => {
    const { status, body } = await get('/literals?sconst=fixed')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ sconst: { valueType: 'string', valueText: 'fixed' } })
  })

  // A string enum whose members look like numbers and booleans stays text.
  it.each(['1', '02', 'true'])('numericsenum accepts %j as text', async (value) => {
    const { status, body } = await get(`/literals?numericsenum=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ numericsenum: { valueType: 'string', valueText: value } })
  })

  // An optional enum without a default is absent when it is not sent — the generated schema tells
  // Elysia's `t.UnionEnum` not to fill in its first member.
  it('an absent enum stays absent', async () => {
    const { status, body } = await get('/literals')
    expect(status).toBe(200)
    expect(body).toStrictEqual({})
  })
})

describe('optional: absent and present', () => {
  it('answers nothing when nothing is sent', async () => {
    const { status, body } = await get('/optional')
    expect(status).toBe(200)
    expect(body).toStrictEqual({})
  })

  it.each([
    ['int_opt', '1', { valueType: 'number', valueText: '1' }],
    ['bool_opt', 'true', { valueType: 'boolean', valueText: 'true' }],
    // An empty string is a value for a string.
    ['str_opt', '', { valueType: 'string', valueText: '' }],
  ])('%s is present when sent', async (name, value, echo) => {
    const { status, body } = await get(`/optional?${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })

  it('arr_opt arrives as an array when sent once', async () => {
    const { status, body } = await get('/optional?arr_opt=1')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ arr_opt: [{ valueType: 'number', valueText: '1' }] })
  })

  // A parameter the schema does not declare is dropped, including one that names an inherited
  // property of every JavaScript object.
  it.each(['unknown', 'constructor'])('drops the undeclared parameter %j', async (name) => {
    const { status, body } = await get(`/optional?${name}=1`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({})
  })
})

// Names that are not JavaScript identifiers reach the handler under their own spelling.
describe('names: parameter names that are not identifiers', () => {
  it.each([
    ['page-size', '5', { valueType: 'number', valueText: '5' }],
    ['filter[name]', 'bob', { valueType: 'string', valueText: 'bob' }],
    ['$top', '3', { valueType: 'number', valueText: '3' }],
    ['user.id', '9', { valueType: 'number', valueText: '9' }],
    // Differs from `int_opt` by case alone, and is a string.
    ['Int_Opt', 'x', { valueType: 'string', valueText: 'x' }],
  ])('%s is read under its own name', async (name, value, echo) => {
    const { status, body } = await get(`/optional?${q(name)}=${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })
})

describe('defaults', () => {
  const DEFAULTS = {
    int_def: { valueType: 'number', valueText: '20' },
    num_def: { valueType: 'number', valueText: '0.5' },
    bool_def: { valueType: 'boolean', valueText: 'false' },
    str_def: { valueType: 'string', valueText: 'fallback' },
    enum_def: { valueType: 'string', valueText: 'asc' },
    arr_def: [],
  }

  // Every absent parameter falls back to its default, typed as the schema says.
  it('fills every absent parameter with its default', async () => {
    const { status, body } = await get('/defaults')
    expect(status).toBe(200)
    expect(body).toStrictEqual(DEFAULTS)
  })

  it.each([
    ['int_def', '7', { valueType: 'number', valueText: '7' }],
    ['bool_def', 'true', { valueType: 'boolean', valueText: 'true' }],
    ['enum_def', 'desc', { valueType: 'string', valueText: 'desc' }],
    // An empty string is a sent value, not an absent one.
    ['str_def', '', { valueType: 'string', valueText: '' }],
  ])('%s keeps the value that was sent', async (name, value, echo) => {
    const { status, body } = await get(`/defaults?${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ ...DEFAULTS, [name]: echo })
  })
})

describe('required', () => {
  it('accepts every required parameter', async () => {
    const { status, body } = await get('/required?id=1&flag=true&name=n&tags=1&tags=2')
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      id: { valueType: 'number', valueText: '1' },
      flag: { valueType: 'boolean', valueText: 'true' },
      name: { valueType: 'string', valueText: 'n' },
      tags: [
        { valueType: 'number', valueText: '1' },
        { valueType: 'number', valueText: '2' },
      ],
    })
  })

  // A required string may be empty: present is what required means.
  it('accepts an empty required string', async () => {
    const { status, body } = await get('/required?id=1&flag=true&name=&tags=1')
    expect(status).toBe(200)
    expect(body).toMatchObject({ name: { valueType: 'string', valueText: '' } })
  })

  // `required: false` written out is the same as leaving `required` off.
  it('accepts the optional parameter beside the required ones', async () => {
    const { status, body } = await get('/required?id=1&flag=true&name=n&tags=1&note=5')
    expect(status).toBe(200)
    expect(body).toMatchObject({ note: { valueType: 'number', valueText: '5' } })
  })
})

// A constraint on a numeric parameter applies to the coerced value, not to the text.
describe('constraints', () => {
  it.each([
    ['range', '1', { valueType: 'number', valueText: '1' }],
    ['range', '100', { valueType: 'number', valueText: '100' }],
    ['exclusive', '0.5', { valueType: 'number', valueText: '0.5' }],
    ['multiple', '15', { valueType: 'number', valueText: '15' }],
    ['length', 'ab', { valueType: 'string', valueText: 'ab' }],
    ['length', 'abcd', { valueType: 'string', valueText: 'abcd' }],
    ['pattern', 'abc-12', { valueType: 'string', valueText: 'abc-12' }],
  ])('%s accepts %j', async (name, value, echo) => {
    const { status, body } = await get(`/limits?${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })

  it.each([
    ['items', ['1', '2']],
    ['items', ['1', '2', '3']],
    ['unique', ['1', '2']],
    ['ranged_items', ['1', '9']],
  ])('%s accepts %j', async (name, values) => {
    const { status, body } = await get(`/limits?${values.map((v) => `${name}=${v}`).join('&')}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      [name]: values.map((value) => ({ valueType: 'number', valueText: value })),
    })
  })
})

describe('references: a schema and a parameter behind $ref', () => {
  // The component is written for a typed value; the text is read before it reaches it.
  it.each(['3', '0'])('count accepts %j through the component', async (value) => {
    const { status, body } = await get(`/refs?count=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ count: { valueType: 'number', valueText: value } })
  })

  it('cursor is read through the parameter component', async () => {
    const { status, body } = await get('/refs?cursor=abc')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ cursor: { valueType: 'string', valueText: 'abc' } })
  })
})

// A parameter declared on the path item is inherited by the operation; one the operation declares
// itself, by the same name, replaces it.
describe('inherited: parameters declared on the path item', () => {
  it('reads the inherited required parameter', async () => {
    const { status, body } = await get('/inherited?tenant=acme')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ tenant: { valueType: 'string', valueText: 'acme' } })
  })

  it("reads the overriding declaration, a string, not the path item's integer", async () => {
    const { status, body } = await get('/inherited?tenant=acme&page=x')
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      tenant: { valueType: 'string', valueText: 'acme' },
      page: { valueType: 'string', valueText: 'x' },
    })
  })
})

describe('styles: serializations other than form + explode', () => {
  // `form` + `explode: false` is one value with commas, and Elysia reads it as the array.
  it('csv accepts a comma-separated value', async () => {
    const { status, body } = await get('/styles?csv=1,2')
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      csv: [
        { valueType: 'number', valueText: '1' },
        { valueType: 'number', valueText: '2' },
      ],
    })
  })

  // `allowEmptyValue`: an empty value, with or without its `=`, is the empty string.
  it.each(['empty=', 'empty'])('?%s is read as an empty string', async (query) => {
    const { status, body } = await get(`/styles?${query}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ empty: { valueType: 'string', valueText: '' } })
  })
})

// An object parameter is generated as `t.ObjectString`: Elysia reads it from one JSON-encoded
// value, and types each property.
describe('objects: a parameter that is an object', () => {
  it.each(['deep', 'spread'])('%s is read from a JSON-encoded value', async (name) => {
    const value = name === 'deep' ? '{"name":"bob","age":5}' : '{"sort":"asc","size":5}'
    const { status, body } = await get(`/styles?${name}=${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      [name]:
        name === 'deep'
          ? {
              name: { valueType: 'string', valueText: 'bob' },
              age: { valueType: 'number', valueText: '5' },
            }
          : {
              sort: { valueType: 'string', valueText: 'asc' },
              size: { valueType: 'number', valueText: '5' },
            },
    })
  })
})

// The text is read once, around the whole schema: a scalar `allOf` is one bounded integer, and a
// `oneOf` / `anyOf` with an integer member coerces the member that fits.
describe('combinators: the text is read once', () => {
  it.each([
    ['allof', '7', { valueType: 'number', valueText: '7' }],
    ['oneof', '5', { valueType: 'number', valueText: '5' }],
    ['oneof', 'all', { valueType: 'string', valueText: 'all' }],
    ['anyof', '5', { valueType: 'number', valueText: '5' }],
    ['anyof', 'true', { valueType: 'boolean', valueText: 'true' }],
  ])('%s accepts %j', async (name, value, echo) => {
    const { status, body } = await get(`/combinators?${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })
})

// The `x-*` extensions transform the value before the handler sees it; paired with a format, the
// transform runs and the format still validates.
describe('transforms: x-* extensions', () => {
  it.each([
    ['trim', '  padded  ', 'padded'],
    ['lower', 'MiXeD', 'mixed'],
    ['email_lower', 'User@Example.COM', 'user@example.com'],
  ])('%s reads %j as %j', async (name, value, valueText) => {
    const { status, body } = await get(`/combinators?${name}=${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: { valueType: 'string', valueText } })
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
    const { status, body } = await get(`/params?${name}=${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })

  // An empty value for an array of strings is one empty element.
  it('string_arr reads an empty value as one empty element', async () => {
    const { status, body } = await get('/params?string_arr=')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ string_arr: [{ valueType: 'string', valueText: '' }] })
  })

  // A nullable integer takes an integer; what it cannot take is in invalid.test.ts.
  it('inull reads an integer', async () => {
    const { status, body } = await get('/limitations?inull=5')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ inull: { valueType: 'number', valueText: '5' } })
  })
})
