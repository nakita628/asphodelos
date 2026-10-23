// The sample ULID, KSUID and cuid2 values are random identifiers, not words.
// cspell:ignore NDEKTSV RRFFQ
// Every parameter shape the generator supports, sent as a real cookie and checked for the
// JavaScript type and value it arrives as. A cookie is text like a query value, read out of the
// `Cookie` header by Elysia's cookie jar: a schema written for a typed value rejects its own input,
// the failure this file exists to catch.
//
// How to read a test:
//   Every route answers the cookies its handler received, by name, each described as
//   `{ valueType, valueText }`: the runtime type and the value as text. A cookie that was not sent
//   and has no default is absent from the answer. A rejected request answers 422 with
//   `{ issues: [...] }`, the name of every cookie that failed — or `''` where Elysia validates a
//   coerced number on its own and reports it without a path.
//
// Routes:
//   /cookies   every shape, and the arrays `ids` and `tags`, all optional
//   /optional  literals, constraints, transforms, a $ref, an object, null and odd names
//   /defaults  cookies with a default
//   /required  required cookies
//
// This file holds the requests that are accepted. Each answers 200, and the test asserts the type
// and the value that reached the handler.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { resumeHappyDom, suspendHappyDom } from '../happydom.js'
import { cookieParamsApp } from './app.js'

// The runtime's own `Request`, not happy-dom's, which drops a `Cookie` header as a browser would.
beforeAll(suspendHappyDom)
afterAll(resumeHappyDom)

async function get(path: string, cookie?: string) {
  const res = await cookieParamsApp.handle(
    new Request(`http://localhost${path}`, cookie === undefined ? {} : { headers: { cookie } }),
  )
  const body: unknown = await res.json()
  return { status: res.status, body }
}

const q = (value: string) => encodeURIComponent(value)

// One canonical value per shape, sent alone as `<shape>=<value>`. The value is compared as well as
// the type: a coercion that changes the value is as wrong as one that changes the type.
describe('shapes: every supported shape accepts its own value', () => {
  it.each([
    // An integer with no format, and every numeric format, arrives as a number.
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
    ['uri', 'https://example.com', 'string', 'https://example.com'],
    ['hostname', 'example.com', 'string', 'example.com'],
    ['ipv4', '192.168.0.1', 'string', '192.168.0.1'],
    // `format: date` and `format: date-time` are generated as `t.Date()`, so they arrive as a Date.
    ['date', '2020-01-02', 'Date', '2020-01-02T00:00:00.000Z'],
    ['datetime', '2020-01-02T03:04:05Z', 'Date', '2020-01-02T03:04:05.000Z'],
    ['time', '12:34:56Z', 'string', '12:34:56Z'],
    ['duration', 'P1Y2M3DT4H5M6S', 'string', 'P1Y2M3DT4H5M6S'],
    ['byte', 'aGVsbG8=', 'string', 'aGVsbG8='],
    ['password', 'hunter2', 'string', 'hunter2'],
  ])('%s accepts %j', async (name, value, valueType, valueText) => {
    const { status, body } = await get('/cookies', `${name}=${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: { valueType, valueText } })
  })
})

describe('integers: accepted boundaries', () => {
  it.each([
    ['integer', '-7'],
    ['integer', '0'],
    ['integer', '9007199254740991'],
    ['int32', '2147483647'],
    ['int32', '-2147483648'],
  ])('%s accepts %j', async (name, value) => {
    const { status, body } = await get('/cookies', `${name}=${value}`)
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
  ])('number accepts %j', async (value, valueText) => {
    const { status, body } = await get('/cookies', `number=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ number: { valueType: 'number', valueText } })
  })
})

describe('formats: what each string format accepts', () => {
  it.each([
    ['email', 'USER@EXAMPLE.COM'],
    ['uuid', '0190B1F4-0000-7000-8000-000000000000'],
    ['uri', 'urn:isbn:0451450523'],
    ['hostname', 'localhost'],
    ['ipv4', '0.0.0.0'],
    ['time', '12:34:56+09:00'],
    ['duration', 'PT1S'],
    ['byte', 'YQ=='],
  ])('%s accepts %j', async (name, value) => {
    const { status, body } = await get('/cookies', `${name}=${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: { valueType: 'string', valueText: value } })
  })
})

// A cookie is one value, so an array cookie is one comma-separated value — a single element as it
// is — or one JSON-encoded array, each element typed.
describe('arrays: one value', () => {
  it.each([
    ['ids', '1', [{ valueType: 'number', valueText: '1' }]],
    [
      'ids',
      '1,2',
      [
        { valueType: 'number', valueText: '1' },
        { valueType: 'number', valueText: '2' },
      ],
    ],
    [
      'ids',
      '[1,2]',
      [
        { valueType: 'number', valueText: '1' },
        { valueType: 'number', valueText: '2' },
      ],
    ],
    [
      'tags',
      'a,b',
      [
        { valueType: 'string', valueText: 'a' },
        { valueType: 'string', valueText: 'b' },
      ],
    ],
  ])('%s reads %j', async (name, value, elements) => {
    const { status, body } = await get('/cookies', `${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: elements })
  })

  it('tags reads a percent-encoded JSON array', async () => {
    const { status, body } = await get('/cookies', `tags=${q('["a","b"]')}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      tags: [
        { valueType: 'string', valueText: 'a' },
        { valueType: 'string', valueText: 'b' },
      ],
    })
  })
})

describe('literals: enum and const', () => {
  it.each(['asc', 'desc'])('senum accepts %j', async (value) => {
    const { status, body } = await get('/optional', `senum=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ senum: { valueType: 'string', valueText: value } })
  })

  it('sconst accepts its one value', async () => {
    const { status, body } = await get('/optional', 'sconst=fixed')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ sconst: { valueType: 'string', valueText: 'fixed' } })
  })

  it.each([
    ['5', { valueType: 'number', valueText: '5' }],
    ['all', { valueType: 'string', valueText: 'all' }],
  ])('oneof accepts %j', async (value, echo) => {
    const { status, body } = await get('/optional', `oneof=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ oneof: echo })
  })

  it('an absent enum stays absent', async () => {
    const { status, body } = await get('/optional')
    expect(status).toBe(200)
    expect(body).toStrictEqual({})
  })
})

describe('constraints', () => {
  it.each([
    ['range', '1', { valueType: 'number', valueText: '1' }],
    ['range', '100', { valueType: 'number', valueText: '100' }],
    ['length', 'ab', { valueType: 'string', valueText: 'ab' }],
    ['length', 'abcd', { valueType: 'string', valueText: 'abcd' }],
    ['pattern', 'abc-12', { valueType: 'string', valueText: 'abc-12' }],
  ])('%s accepts %j', async (name, value, echo) => {
    const { status, body } = await get('/optional', `${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })
})

describe('transforms: x-* extensions', () => {
  it.each([
    ['lower', 'MiXeD', 'mixed'],
    ['email_lower', 'User@Example.COM', 'user@example.com'],
  ])('%s reads %j as %j', async (name, value, valueText) => {
    const { status, body } = await get('/optional', `${name}=${q(value)}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: { valueType: 'string', valueText } })
  })
})

describe('references: a schema behind $ref', () => {
  it.each(['3', '0'])('ref_int accepts %j through the component', async (value) => {
    const { status, body } = await get('/optional', `ref_int=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ ref_int: { valueType: 'number', valueText: value } })
  })
})

// An object cookie is read from one JSON-encoded value, as sent or percent-encoded.
describe('objects: an object in one cookie', () => {
  it.each(['{"a":1,"b":"x"}', q('{"a":1,"b":"x"}')])('profile reads %s', async (value) => {
    const { status, body } = await get('/optional', `profile=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      profile: {
        a: { valueType: 'number', valueText: '1' },
        b: { valueType: 'string', valueText: 'x' },
      },
    })
  })
})

// Names that are not JavaScript identifiers reach the handler under their own spelling, and case
// is part of the name.
describe('names: cookie names', () => {
  it.each([
    ['session-id', '4', { valueType: 'number', valueText: '4' }],
    ['user.id', '9', { valueType: 'number', valueText: '9' }],
    ['Int_Opt', 'x', { valueType: 'string', valueText: 'x' }],
  ])('%s is read under its own name', async (name, value, echo) => {
    const { status, body } = await get('/optional', `${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })
})

describe('optional: absent and present', () => {
  it.each([undefined, '', '; '])('answers nothing for a Cookie header of %j', async (cookie) => {
    const { status, body } = await get('/optional', cookie)
    expect(status).toBe(200)
    expect(body).toStrictEqual({})
  })

  it.each([
    ['int_opt', '1', { valueType: 'number', valueText: '1' }],
    ['bool_opt', 'true', { valueType: 'boolean', valueText: 'true' }],
    ['str_opt', '', { valueType: 'string', valueText: '' }],
  ])('%s is present when sent', async (name, value, echo) => {
    const { status, body } = await get('/optional', `${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })

  // A numeric enum reads the spelling of a member, and a nullable integer the word `null`.
  it.each([
    ['ienum', '2', { valueType: 'number', valueText: '2' }],
    ['inull', '5', { valueType: 'number', valueText: '5' }],
    ['inull', 'null', { valueType: 'null', valueText: 'null' }],
  ])('%s reads %j', async (name, value, echo) => {
    const { status, body } = await get('/optional', `${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })

  // The jar holds every cookie that was sent: one the schema does not declare passes through as
  // text, untyped.
  it('keeps an undeclared cookie as text', async () => {
    const { status, body } = await get('/optional', 'unknown=5')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ unknown: { valueType: 'string', valueText: '5' } })
  })
})

// How the `Cookie` header is read: pairs separated by `;`, the value percent-decoded.
describe('wire: the Cookie header', () => {
  it.each(['int_opt=1; str_opt=s', 'int_opt=1;str_opt=s', ' int_opt=1 ;  str_opt=s ; '])(
    'separates the pairs of %j',
    async (cookie) => {
      const { status, body } = await get('/optional', cookie)
      expect(status).toBe(200)
      expect(body).toStrictEqual({
        int_opt: { valueType: 'number', valueText: '1' },
        str_opt: { valueType: 'string', valueText: 's' },
      })
    },
  )

  it.each([
    ['a%20b', 'a b'],
    ['a%3Bb', 'a;b'],
    ['a%2Cb', 'a,b'],
    ['a=b', 'a=b'],
    ['a+b', 'a+b'],
    ['%E3%81%82', 'あ'],
    ['"quoted"', '"quoted"'],
  ])('decodes str_opt=%s to %j', async (sent, valueText) => {
    const { status, body } = await get('/optional', `str_opt=${sent}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ str_opt: { valueType: 'string', valueText } })
  })

  it('keeps the first of a name sent twice', async () => {
    const { status, body } = await get('/optional', 'int_opt=1; int_opt=2')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ int_opt: { valueType: 'number', valueText: '1' } })
  })
})

// A cookie with a default is read like any other when it is sent. What happens when it is not is
// pinned in invalid.test.ts: Elysia's cookie jar does not fill in a default.
describe('defaults', () => {
  it.each([
    ['int_def', '7', { valueType: 'number', valueText: '7' }],
    ['bool_def', 'true', { valueType: 'boolean', valueText: 'true' }],
    ['enum_def', 'desc', { valueType: 'string', valueText: 'desc' }],
    ['str_def', '', { valueType: 'string', valueText: '' }],
  ])('%s reads the value that was sent', async (name, value, echo) => {
    const { status, body } = await get('/defaults', `${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })
})

describe('required', () => {
  it('accepts every required cookie', async () => {
    const { status, body } = await get('/required', 'id=1; flag=true; name=n')
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      id: { valueType: 'number', valueText: '1' },
      flag: { valueType: 'boolean', valueText: 'true' },
      name: { valueType: 'string', valueText: 'n' },
    })
  })

  it('accepts an empty required string', async () => {
    const { status, body } = await get('/required', 'id=1; flag=true; name=')
    expect(status).toBe(200)
    expect(body).toMatchObject({ name: { valueType: 'string', valueText: '' } })
  })

  it('accepts the optional cookie beside the required ones', async () => {
    const { status, body } = await get('/required', 'id=1; flag=true; name=n; note=5')
    expect(status).toBe(200)
    expect(body).toMatchObject({ note: { valueType: 'number', valueText: '5' } })
  })
})

describe('leniency: what is read beyond the plainest spelling (pinned, not endorsed)', () => {
  it.each([
    ['integer', '007', { valueType: 'number', valueText: '7' }],
    ['integer', '1e3', { valueType: 'number', valueText: '1000' }],
    ['integer', '0x10', { valueType: 'number', valueText: '16' }],
    ['date', '2020-02-30', { valueType: 'Date', valueText: '2020-03-01T00:00:00.000Z' }],
  ])('%s reads %j', async (name, value, echo) => {
    const { status, body } = await get('/cookies', `${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })
})

// A format Elysia does not register is validated by pattern — a colon travels in a cookie as it
// is — and a scalar component a cookie references is read from text.
describe('formats and references read from text', () => {
  it.each([
    [
      '/cookies',
      'mac',
      '00:1a:2b:3c:4d:5e',
      { valueType: 'string', valueText: '00:1a:2b:3c:4d:5e' },
    ],
    [
      '/cookies',
      'ulid',
      '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      { valueType: 'string', valueText: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
    ],
    ['/optional', 'ref_flag', 'true', { valueType: 'boolean', valueText: 'true' }],
  ])('%s %s accepts %j', async (path, name, value, echo) => {
    const { status, body } = await get(path, `${name}=${value}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })
})
