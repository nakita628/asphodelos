// A JSON body has types of its own, so nothing in it is read from text — with the exceptions
// Elysia makes on purpose, which this file pins: `t.Integer` reads a string of digits, and
// `t.Date` reads a string or a number. Every integer is capped at `Number.MAX_SAFE_INTEGER` by the
// generated schema, so an `int64` arrives as a number that is exact.
//
// How to read a test:
//   Every route answers the fields its handler received, by name, each described as
//   `{ valueType, valueText }`: the runtime type and the value as text. A field that was not sent
//   and has no default is absent from the answer; `cursor` of /numbers has a default of 0, so it is
//   in every answer of that route. A rejected request answers 422 with `{ issues: [...] }`: the
//   path of every issue, `ids/1` for an element.
//
// Routes:
//   /numbers  integers in each of their forms
//   /types    type as a list of types, string formats, and the shapes of an object
//
// This file holds the requests that are accepted. Each answers 200, and the test asserts the type
// and the value that reached the handler.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { resumeHappyDom, suspendHappyDom } from '../happydom.js'
import { jsonBodyApp } from './app.js'

// The runtime's own `Request`: a body is read as the server would read it.
beforeAll(suspendHappyDom)
afterAll(resumeHappyDom)

async function post(path: string, json: string) {
  const res = await jsonBodyApp.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: json,
    }),
  )
  const body: unknown = await res.json()
  return { status: res.status, body }
}

const CURSOR = { cursor: { valueType: 'number', valueText: '0' } }

describe('integers: a JSON number', () => {
  it.each([
    ['id', '42', { valueType: 'number', valueText: '42' }],
    ['id', '-42', { valueType: 'number', valueText: '-42' }],
    ['id', '0', { valueType: 'number', valueText: '0' }],
    // Exact up to Number.MAX_SAFE_INTEGER; what lies beyond is in invalid.test.ts.
    ['id', '9007199254740991', { valueType: 'number', valueText: '9007199254740991' }],
    ['ranged', '1', { valueType: 'number', valueText: '1' }],
    ['ranged', '100', { valueType: 'number', valueText: '100' }],
    ['level', '2', { valueType: 'number', valueText: '2' }],
    ['version', '5', { valueType: 'number', valueText: '5' }],
    ['small', '2147483647', { valueType: 'number', valueText: '2147483647' }],
    ['ratio', '1.5', { valueType: 'number', valueText: '1.5' }],
    ['ref', '3', { valueType: 'number', valueText: '3' }],
    ['active', 'true', { valueType: 'boolean', valueText: 'true' }],
  ])('%s reads %s', async (name, json, echo) => {
    const { status, body } = await post('/numbers', `{"${name}":${json}}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ ...CURSOR, [name]: echo })
  })

  it('cursor reads a value over its default', async () => {
    const { status, body } = await post('/numbers', '{"cursor":3}')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ cursor: { valueType: 'number', valueText: '3' } })
  })

  it('cursor falls back to its default', async () => {
    const { status, body } = await post('/numbers', '{}')
    expect(status).toBe(200)
    expect(body).toStrictEqual(CURSOR)
  })

  it.each([
    ['null', { valueType: 'null', valueText: 'null' }],
    ['5', { valueType: 'number', valueText: '5' }],
  ])('maybe reads %s', async (json, echo) => {
    const { status, body } = await post('/numbers', `{"maybe":${json}}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ ...CURSOR, maybe: echo })
  })

  it('ids reads every element', async () => {
    const { status, body } = await post('/numbers', '{"ids":[1,2]}')
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      ...CURSOR,
      ids: [
        { valueType: 'number', valueText: '1' },
        { valueType: 'number', valueText: '2' },
      ],
    })
  })

  // A field the schema does not declare is dropped.
  it('drops an undeclared field', async () => {
    const { status, body } = await post('/numbers', '{"unknown":1}')
    expect(status).toBe(200)
    expect(body).toStrictEqual(CURSOR)
  })
})

// `type: [integer, string]` is a union of the types it lists; each member keeps the constraints
// that apply to it.
describe('types: a list of types', () => {
  it.each([
    ['either', '5', { valueType: 'number', valueText: '5' }],
    ['either', '"x"', { valueType: 'string', valueText: 'x' }],
    ['flagged', '1.5', { valueType: 'number', valueText: '1.5' }],
    ['flagged', 'true', { valueType: 'boolean', valueText: 'true' }],
    ['flagged', 'null', { valueType: 'null', valueText: 'null' }],
    ['bounded', '1', { valueType: 'number', valueText: '1' }],
    ['bounded', '"ab"', { valueType: 'string', valueText: 'ab' }],
  ])('%s accepts %s', async (name, json, echo) => {
    const { status, body } = await post('/types', `{"${name}":${json}}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })
})

describe('formats: strings with a format', () => {
  it.each([
    // `date-time` and `date` are generated as `t.Date()`, so they arrive as a Date.
    [
      'moment',
      '"2020-01-02T03:04:05Z"',
      { valueType: 'Date', valueText: '2020-01-02T03:04:05.000Z' },
    ],
    [
      'moment',
      '"2020-01-02T03:04:05+09:00"',
      { valueType: 'Date', valueText: '2020-01-01T18:04:05.000Z' },
    ],
    ['day', '"2020-01-02"', { valueType: 'Date', valueText: '2020-01-02T00:00:00.000Z' }],
    // An RFC 3339 time carries its offset and stays a string.
    ['clock', '"12:34:56Z"', { valueType: 'string', valueText: '12:34:56Z' }],
    ['clock', '"12:34:56+09:00"', { valueType: 'string', valueText: '12:34:56+09:00' }],
    ['bytes', '"aGVsbG8="', { valueType: 'string', valueText: 'aGVsbG8=' }],
  ])('%s accepts %s', async (name, json, echo) => {
    const { status, body } = await post('/types', `{"${name}":${json}}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ [name]: echo })
  })
})

describe('objects', () => {
  // name is declared a string, and count, which nothing declares, is held to an integer.
  it('labelled keeps a declared property beside an additional one', async () => {
    const { status, body } = await post('/types', '{"labelled":{"name":"a","count":2}}')
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      labelled: { valueType: 'object', valueText: '{"name":"a","count":2}' },
    })
  })

  it('strict accepts its declared property', async () => {
    const { status, body } = await post('/types', '{"strict":{"a":1}}')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ strict: { valueType: 'object', valueText: '{"a":1}' } })
  })

  it('inherited reads its constructor property when it is sent', async () => {
    const { status, body } = await post('/types', '{"inherited":{"constructor":5,"name":"a"}}')
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      inherited: { valueType: 'object', valueText: '{"constructor":5,"name":"a"}' },
    })
  })
})

// What Elysia reads beyond a value of the declared type. Pinned so a change in Elysia is noticed,
// not endorsed.
describe('leniency: what is read beyond the declared type (pinned, not endorsed)', () => {
  it.each([
    // Elysia's `t.Integer` reads a string of digits, in a JSON body too.
    ['/numbers', 'id', '"42"', { ...CURSOR, id: { valueType: 'number', valueText: '42' } }],
    ['/numbers', 'small', '"5"', { ...CURSOR, small: { valueType: 'number', valueText: '5' } }],
    // `Number()` reads a hex literal, an exponent and surrounding whitespace in that string.
    ['/numbers', 'id', '"0x10"', { ...CURSOR, id: { valueType: 'number', valueText: '16' } }],
    ['/numbers', 'id', '"1e3"', { ...CURSOR, id: { valueType: 'number', valueText: '1000' } }],
    ['/numbers', 'id', '" 42 "', { ...CURSOR, id: { valueType: 'number', valueText: '42' } }],
    ['/numbers', 'maybe', '"5"', { ...CURSOR, maybe: { valueType: 'number', valueText: '5' } }],
    // `t.Date` reads a date without its time, and a number of milliseconds.
    [
      '/types',
      'moment',
      '"2020-01-02"',
      { moment: { valueType: 'Date', valueText: '2020-01-02T00:00:00.000Z' } },
    ],
    [
      '/types',
      'moment',
      '1577934245000',
      { moment: { valueType: 'Date', valueText: '2020-01-02T03:04:05.000Z' } },
    ],
  ])('%s %s reads %s', async (path, name, json, expected) => {
    const { status, body } = await post(path, `{"${name}":${json}}`)
    expect(status).toBe(200)
    expect(body).toStrictEqual(expected)
  })

  // Elysia drops the keys a schema does not declare before validating, so `additionalProperties:
  // false` never sees one.
  it('strict drops an undeclared property rather than rejecting it', async () => {
    const { status, body } = await post('/types', '{"strict":{"a":1,"b":2}}')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ strict: { valueType: 'object', valueText: '{"a":1}' } })
  })

  // A body that is not an object is read as an empty one.
  it.each(['[]', '"str"'])('reads %s as an empty object', async (json) => {
    const { status, body } = await post('/numbers', json)
    expect(status).toBe(200)
    expect(body).toStrictEqual(CURSOR)
  })
})
