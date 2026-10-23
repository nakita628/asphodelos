// Every parameter shape the generator supports, sent as a real header and rejected. A non-string
// shape that coerces carelessly would accept anything, and a format that is not validated would
// pass anything through: both are what this file catches.
//
// Every request here answers 422 with `{ issues: [...] }`: the name of each header that failed, or
// `''` where Elysia validates a coerced number against its own bounds and reports it without a
// path. See valid.test.ts for the routes and how to read an answer.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { Elysia } from 'elysia'

import { resumeHappyDom, suspendHappyDom } from '../happydom.js'
import { ReservedModel } from './__generated__/modules/reserved/model.js'
import { headerParamsApp } from './app.js'

// The runtime's own `Request`, not happy-dom's: see valid.test.ts.
beforeAll(suspendHappyDom)
afterAll(resumeHappyDom)

async function get(path: string, headers: Record<string, string> = {}) {
  const res = await headerParamsApp.handle(new Request(`http://localhost${path}`, { headers }))
  const body: unknown = await res.json()
  return { status: res.status, body }
}

async function rejects(path: string, headers: Record<string, string>, issues: readonly string[]) {
  const { status, body } = await get(path, headers)
  expect(status).toBe(422)
  expect(body).toStrictEqual({ issues })
}

// A word must be rejected by every shape that is not a string.
describe('shapes: a shape that is not a string rejects a word', () => {
  it.each(['x-integer', 'x-int32', 'x-int64', 'x-number', 'x-float', 'x-double', 'x-boolean'])(
    '%s rejects "not-a-value"',
    async (name) => {
      await rejects('/headers', { [name]: 'not-a-value' }, [name])
    },
  )
})

describe('integers: rejected values', () => {
  it.each([
    // A fraction is not an integer.
    ['x-integer', '1.5', ['x-integer']],
    // Past MAX_SAFE_INTEGER a double rounds to a different number, so the value is refused — by
    // the bound the generator puts on every integer, which Elysia reports without a path.
    ['x-integer', '9007199254740992', ['']],
    ['x-integer', 'Infinity', ['x-integer']],
    ['x-integer', 'NaN', ['x-integer']],
    ['x-integer', '1,000', ['x-integer']],
    ['x-integer', '1_000', ['x-integer']],
    ['x-integer', 'null', ['x-integer']],
    ['x-integer', 'true', ['x-integer']],
    ['x-integer', '12abc', ['x-integer']],
    // An empty value is not a number.
    ['x-integer', '', ['x-integer']],
    // One past each int32 bound.
    ['x-int32', '2147483648', ['']],
    ['x-int32', '-2147483649', ['']],
    ['x-int32', '1.5', ['x-int32']],
    // `int64` is read into a number, so a value a double cannot hold is refused rather than rounded.
    ['x-int64', '9007199254740993', ['']],
    ['x-int64', '1.5', ['x-int64']],
  ])('%s rejects %j', async (name, value, issues) => {
    await rejects('/headers', { [name]: value }, issues)
  })
})

describe('floats: rejected values', () => {
  it.each([
    ['Infinity', ['']],
    ['NaN', ['x-number']],
    ['1e400', ['']],
    ['1,5', ['x-number']],
    ['1.5.5', ['x-number']],
  ])('x-number rejects %j', async (value, issues) => {
    await rejects('/headers', { 'x-number': value }, issues)
  })
})

// Only `true` and `false` spell a boolean.
describe('booleans: rejected values', () => {
  it.each(['1', '0', 'yes', 'TRUE', 't', '', 'truthy'])('x-boolean rejects %j', async (value) => {
    await rejects('/headers', { 'x-boolean': value }, ['x-boolean'])
  })
})

// A string format is a validator: a value that does not fit is rejected, not passed through.
describe('formats: what each string format rejects', () => {
  it.each([
    ['x-email', 'a@b'],
    ['x-email', '@example.com'],
    ['x-email', 'user@'],
    ['x-uuid', 'nope'],
    ['x-uuid', '0190b1f400007000800000000000000'],
    ['x-uri', 'example.com'],
    ['x-uri', '/path'],
    ['x-url', 'example.com'],
    ['x-url', 'mailto:a@b.c'],
    ['x-hostname', '-bad-'],
    ['x-ipv4', '999.1.1.1'],
    ['x-ipv4', '1.2.3'],
    ['x-ipv6', 'nope'],
    ['x-ipv6', '192.168.0.1'],
    ['x-date', '2020-13-01'],
    ['x-date', 'nope'],
    ['x-datetime', 'nope'],
    // An RFC 3339 time carries its offset, and has no 25th hour.
    ['x-time', '12:34:56'],
    ['x-time', '25:00:00Z'],
    ['x-duration', 'nope'],
    ['x-duration', 'P'],
    ['x-byte', '**'],
  ])('%s rejects %j', async (name, value) => {
    await rejects('/headers', { [name]: value }, [name])
  })
})

describe('literals: enum and const', () => {
  // Members are compared exactly: case matters.
  it.each(['up', 'ASC'])('x-senum rejects %j', async (value) => {
    await rejects('/optional', { 'x-senum': value }, ['x-senum'])
  })

  it('x-sconst rejects any other value', async () => {
    await rejects('/optional', { 'x-sconst': 'other' }, ['x-sconst'])
  })

  it('x-oneof rejects what fits no member', async () => {
    await rejects('/optional', { 'x-oneof': 'x' }, ['x-oneof'])
  })
})

describe('constraints', () => {
  it.each([
    // The bounds apply to the coerced number, which Elysia validates on its own.
    ['x-range', '0', ['']],
    ['x-range', '101', ['']],
    ['x-range', '50.5', ['x-range']],
    ['x-length', 'a', ['x-length']],
    ['x-length', 'abcde', ['x-length']],
    ['x-pattern', 'ABC-12', ['x-pattern']],
    ['x-pattern', 'abc-1234', ['x-pattern']],
  ])('%s rejects %j', async (name, value, issues) => {
    await rejects('/optional', { [name]: value }, issues)
  })

  // The format still validates after the transform.
  it('x-email-lower rejects what is not an email', async () => {
    await rejects('/optional', { 'x-email-lower': 'nope' }, ['x-email-lower'])
  })
})

describe('references: a schema behind $ref', () => {
  it('x-ref-int is bounded by the component', async () => {
    await rejects('/optional', { 'x-ref-int': '-1' }, [''])
  })

  it('x-ref-int rejects a word', async () => {
    await rejects('/optional', { 'x-ref-int': 'x' }, ['x-ref-int'])
  })
})

describe('optional: a present value is still validated', () => {
  it.each([
    ['x-int-opt', 'x'],
    ['x-bool-opt', 'maybe'],
    ['x-rate-limit', 'x'],
  ])('%s rejects a word', async (name, value) => {
    await rejects('/optional', { [name]: value }, [name])
  })

  it('reports every header that fails', async () => {
    await rejects('/optional', { 'x-int-opt': 'x', 'x-bool-opt': 'maybe' }, [
      'x-int-opt',
      'x-bool-opt',
    ])
  })
})

describe('defaults', () => {
  // An invalid value is rejected, not replaced by the default.
  it.each([
    ['x-int-def', 'x'],
    ['x-int-def', ''],
    ['x-bool-def', 'maybe'],
    ['x-enum-def', 'up'],
  ])('%s rejects %j rather than falling back', async (name, value) => {
    await rejects('/defaults', { [name]: value }, [name])
  })
})

describe('required', () => {
  it.each([
    [{ 'x-flag': 'true', 'x-name': 'n' }, ['x-id']],
    [{ 'x-id': '1', 'x-name': 'n' }, ['x-flag']],
    [{ 'x-id': '1', 'x-flag': 'true' }, ['x-name']],
  ])('%j names the missing header', async (headers, issues) => {
    await rejects('/required', headers, issues)
  })

  it('names every missing header when nothing is sent', async () => {
    await rejects('/required', {}, ['x-id', 'x-flag', 'x-name'])
  })

  it('validates a required value that was sent', async () => {
    await rejects('/required', { 'x-id': 'x', 'x-flag': 'true', 'x-name': 'n' }, ['x-id'])
  })

  it('validates the optional header when it is sent', async () => {
    await rejects('/required', { 'x-id': '1', 'x-flag': 'true', 'x-name': 'n', 'x-note': 'x' }, [
      'x-note',
    ])
  })
})

// What a header value cannot carry: a header is a ByteString, and the Fetch API refuses what is
// not one. The request never leaves the client, so no schema can be asked about these.
describe('wire: what a header value cannot carry', () => {
  it.each(['🔥', '９', 'a\nb', 'a\rb', 'a\0b'])('cannot send %j in a header', (value) => {
    expect(
      () => new Request('http://localhost/headers', { headers: { 'x-string': value } }),
    ).toThrow()
  })
})

// What the generated schema declares but Elysia's header reader does not turn into its value.
// Pinned so the day Elysia reads them is noticed; a document that needs them today should declare
// the header as a string and read it in the handler.
describe('limitations: what Elysia does not read from a header (pinned)', () => {
  // A numeric enum is matched against numbers, and the header holds text.
  it.each(['2', '9'])('a numeric enum rejects %j', async (value) => {
    await rejects('/optional', { 'x-ienum': value }, ['x-ienum'])
  })

  // `null` has no spelling in a header: neither the word nor an empty value is read as it.
  it.each(['null', ''])('a nullable integer rejects %j', async (value) => {
    await rejects('/optional', { 'x-inull': value }, ['x-inull'])
  })

  // An array header is not read: a comma-separated list is not split, an array of strings
  // rejects a single value, and an array of integers reads the digits of a single value as its
  // elements. A document that needs one should declare the header as a string.
  it.each([
    ['x-ids', '1,2'],
    ['x-ids', '1,x'],
    ['x-tags', 'a'],
    ['x-tags', 'a,b'],
  ])('%s rejects %j', async (name, value) => {
    await rejects('/headers', { [name]: value }, [name])
  })

  it('x-ids reads the digits of a single value as its elements', async () => {
    const { status, body } = await get('/headers', { 'x-ids': '42' })
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      'x-ids': [
        { valueType: 'number', valueText: '4' },
        { valueType: 'number', valueText: '2' },
      ],
    })
  })

  // An object header reads a JSON-encoded value only; an object that does not fit its schema is
  // rejected by property, and the comma-separated spelling OpenAPI describes is not read.
  it('x-obj is validated by property', async () => {
    await rejects('/optional', { 'x-obj': '{"a":"x"}' }, ['a'])
  })

  it('x-obj does not read the comma-separated spelling', async () => {
    const { status, body } = await get('/optional', { 'x-obj': 'a,1,b,x' })
    expect(status).toBe(200)
    expect(body).toStrictEqual({ 'x-obj': {} })
  })

  // A header named like what every JavaScript object inherits: Elysia reads the defaults of the
  // header schema off an empty object, finds the inherited `constructor` there, and fails to
  // compile the route. The schema is generated; it cannot be mounted.
  it('a header named constructor cannot be mounted', async () => {
    const app = new Elysia().get('/reserved', () => 'ok', {
      headers: ReservedModel.headerReservedHeaders,
    })
    const failure: unknown = await app.handle(new Request('http://localhost/reserved')).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(failure).toBeInstanceOf(Error)
    expect(String(failure)).toContain('Unable to clone value')
  })
})
