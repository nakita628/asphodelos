// Every parameter shape the generator supports, sent as a real query string and rejected. A
// non-string shape that coerces carelessly would accept anything, and a format that is not
// validated would pass anything through: both are what this file catches.
//
// Every request here answers 422 with `{ issues: [...] }`: the name of each parameter that failed,
// or `''` where Elysia validates a coerced number against its own bounds and reports it without a
// path. See valid.test.ts for the routes and how to read an answer.
import { describe, expect, it } from 'bun:test'

import { queryParamsApp } from './app.js'

async function get(url: string) {
  const res = await queryParamsApp.handle(new Request(`http://localhost${url}`))
  const body: unknown = await res.json()
  return { status: res.status, body }
}

const q = (value: string) => encodeURIComponent(value)

async function rejects(url: string, issues: readonly string[]) {
  const { status, body } = await get(url)
  expect(status).toBe(422)
  expect(body).toStrictEqual({ issues })
}

// A word must be rejected by every shape that is not a string.
describe('shapes: a shape that is not a string rejects a word', () => {
  it.each(['integer', 'int32', 'int64', 'number', 'float', 'double', 'boolean'])(
    '%s rejects "not-a-value"',
    async (name) => {
      await rejects(`/params?${name}=not-a-value`, [name])
    },
  )
})

describe('integers: rejected values', () => {
  it.each([
    // A fraction is not an integer.
    ['integer', '1.5', ['integer']],
    // Past MAX_SAFE_INTEGER a double rounds to a different number, so the value is refused — by
    // the bound the generator puts on every integer, which Elysia reports without a path.
    ['integer', '9007199254740992', ['']],
    ['integer', '9007199254740993', ['']],
    ['integer', 'Infinity', ['integer']],
    ['integer', 'NaN', ['integer']],
    // A thousands separator and the JavaScript numeric separator are not part of a number.
    ['integer', '1,000', ['integer']],
    ['integer', '1_000', ['integer']],
    ['integer', 'null', ['integer']],
    ['integer', 'true', ['integer']],
    ['integer', '12abc', ['integer']],
    // An empty value is not a number.
    ['integer', '', ['integer']],
    // One past each int32 bound.
    ['int32', '2147483648', ['']],
    ['int32', '-2147483649', ['']],
    ['int32', '1.5', ['int32']],
    // `int64` is read into a number, so a value a double cannot hold is refused rather than rounded.
    ['int64', '9007199254740993', ['']],
    ['int64', '1.5', ['int64']],
  ])('%s rejects %j', async (name, value, issues) => {
    await rejects(`/params?${name}=${q(value)}`, issues)
  })
})

describe('floats: rejected values', () => {
  it.each([
    ['Infinity', ['']],
    ['NaN', ['number']],
    // Overflows a double to Infinity.
    ['1e400', ['']],
    // A decimal comma is not a decimal point, and two points are one too many.
    ['1,5', ['number']],
    ['1.5.5', ['number']],
  ])('number rejects %j', async (value, issues) => {
    await rejects(`/params?number=${q(value)}`, issues)
  })
})

// Only `true` and `false` spell a boolean.
describe('booleans: rejected values', () => {
  it.each(['1', '0', 'yes', 'TRUE', 't', '', ' true', 'truthy'])(
    'boolean rejects %j',
    async (value) => {
      await rejects(`/params?boolean=${q(value)}`, ['boolean'])
    },
  )
})

// A string format is a validator: a value that does not fit is rejected, not passed through.
describe('formats: what each string format rejects', () => {
  it.each([
    ['email', 'a@b'],
    ['email', '@example.com'],
    ['email', 'user@'],
    ['email', 'user @example.com'],
    ['uuid', 'nope'],
    ['uuid', '0190b1f400007000800000000000000'],
    ['uuid', '0190b1f4-0000-7000-8000-00000000000g'],
    // No scheme, and a relative reference.
    ['uri', 'example.com'],
    ['uri', '/path'],
    // `url` wants http, https or ftp.
    ['url', 'example.com'],
    ['url', 'mailto:a@b.c'],
    ['hostname', '-bad-'],
    ['hostname', 'a b'],
    ['ipv4', '999.1.1.1'],
    ['ipv4', '1.2.3'],
    ['ipv6', 'nope'],
    ['ipv6', '192.168.0.1'],
    ['date', '2020-13-01'],
    ['date', 'nope'],
    ['datetime', 'nope'],
    // An RFC 3339 time carries its offset, and has no 25th hour.
    ['time', '12:34:56'],
    ['time', '25:00:00Z'],
    ['duration', 'nope'],
    ['duration', 'P'],
    ['byte', '**'],
  ])('%s rejects %j', async (name, value) => {
    await rejects(`/params?${name}=${q(value)}`, [name])
  })
})

// Every element is validated, not just the first.
describe('array elements: rejected values', () => {
  it.each([
    ['integer_arr', ['1', 'x']],
    ['boolean_arr', ['true', '2']],
    ['email_arr', ['a@example.com', 'nope']],
  ])('%s rejects a bad second element', async (name, values) => {
    await rejects(`/params?${values.map((v) => `${name}=${q(v)}`).join('&')}`, [name])
  })
})

describe('literals: enum and const', () => {
  // Members are compared exactly: case matters.
  it.each(['up', 'ASC'])('senum rejects %j', async (value) => {
    await rejects(`/literals?senum=${value}`, ['senum'])
  })

  it('senum_arr rejects a non-member element', async () => {
    await rejects('/literals?senum_arr=asc&senum_arr=up', ['senum_arr'])
  })

  it('sconst rejects any other value', async () => {
    await rejects('/literals?sconst=other', ['sconst'])
  })

  // A member that looks like a number is still matched as text.
  it('numericsenum rejects a number that is not spelled like a member', async () => {
    await rejects('/literals?numericsenum=2', ['numericsenum'])
  })
})

describe('optional: a present value is still validated', () => {
  it.each([
    ['int_opt', 'x'],
    ['page-size', 'x'],
  ])('%s rejects a word', async (name, value) => {
    await rejects(`/optional?${q(name)}=${value}`, [name])
  })
})

describe('required', () => {
  it.each([
    ['/required?flag=true&name=n&tags=1', ['id']],
    ['/required?id=1&name=n&tags=1', ['flag']],
    ['/required?id=1&flag=true&tags=1', ['name']],
    ['/required?id=1&flag=true&name=n', ['tags']],
  ])('%s names the missing parameter', async (url, issues) => {
    await rejects(url, issues)
  })

  it('names every missing parameter when nothing is sent', async () => {
    await rejects('/required', ['id', 'flag', 'tags', 'name'])
  })

  it('validates a required value that was sent', async () => {
    await rejects('/required?id=x&flag=true&name=n&tags=1', ['id'])
  })

  // `required: false` written out is still validated when present.
  it('validates the optional parameter when it is sent', async () => {
    await rejects('/required?id=1&flag=true&name=n&tags=1&note=x', ['note'])
  })
})

describe('constraints', () => {
  it.each([
    // The bounds apply to the coerced number, which Elysia validates on its own.
    ['range=0', ['']],
    ['range=101', ['']],
    // A fraction is not an integer, whatever the bounds.
    ['range=50.5', ['range']],
    ['exclusive=0', ['']],
    ['exclusive=1', ['']],
    ['multiple=7', ['']],
    ['length=a', ['length']],
    ['length=abcde', ['length']],
    ['pattern=ABC-12', ['pattern']],
    ['pattern=abc-1234', ['pattern']],
    // One value where two are the least: Elysia fails to decode it as the array, without a path.
    ['items=1', ['']],
    ['items=1&items=2&items=3&items=4', ['items']],
    ['unique=1&unique=1', ['unique']],
    // A bound on the elements applies to each coerced element.
    ['ranged_items=0&ranged_items=9', ['']],
    ['ranged_items=10', ['']],
  ])('rejects ?%s', async (query, issues) => {
    await rejects(`/limits?${query}`, issues)
  })
})

describe('references: a schema and a parameter behind $ref', () => {
  it('count is bounded by the component', async () => {
    await rejects('/refs?count=-1', [''])
  })

  it('count rejects a word', async () => {
    await rejects('/refs?count=x', ['count'])
  })

  it('cursor is constrained by the parameter component', async () => {
    await rejects('/refs?cursor=', ['cursor'])
  })
})

describe('inherited: parameters declared on the path item', () => {
  it('requires the inherited parameter', async () => {
    await rejects('/inherited?page=2', ['tenant'])
  })
})

// What the generated schema declares but Elysia's query reader does not turn into its value.
// Pinned so the day Elysia reads them is noticed; a document that needs them today should declare
// the parameter as a string and read it in the handler.
describe('limitations: what Elysia does not read from a query string (pinned)', () => {
  // A numeric enum is matched against numbers, and the query holds text.
  it.each(['2', '9'])('a numeric enum rejects %j', async (value) => {
    await rejects(`/limitations?ienum=${value}`, ['ienum'])
  })

  // `null` has no spelling in a query string: neither the word nor an empty value is read as it.
  it.each(['null', ''])('a nullable integer rejects %j', async (value) => {
    await rejects(`/limitations?inull=${value}`, ['inull'])
  })
})
