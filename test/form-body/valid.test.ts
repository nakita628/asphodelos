// A form body, `application/x-www-form-urlencoded` or `multipart/form-data`, carries every field
// as text (or as a file), exactly like a query string. A schema written for a typed value rejects
// all of it, so the generated schema reads each field from text: what this file proves is that
// each field arrives as the right JavaScript type. A JSON body is the contrast.
//
// How to read a test:
//   Every route answers the fields its handler received, by name, each described as
//   `{ valueType, valueText }`: the runtime type and the value as text. A field that was not sent
//   and has no default is absent from the answer; `limit` of /urlencoded has a default of 20, so it
//   is in every answer of that route. A rejected request answers 422 with `{ issues: [...] }`: the
//   path of every issue, or `''` where Elysia reports one without a path.
//
// Routes:
//   /urlencoded  every kind of field, all optional
//   /multipart   a file beside fields read from text
//   /component   a form body that is a component schema
//   /json        the same component as a JSON body
//
// This file holds the requests that are accepted. Each answers 200, and the test asserts the type
// and the value that reached the handler.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { resumeHappyDom, suspendHappyDom } from '../happydom.js'
import { formBodyApp } from './app.js'

// The runtime's own `Request`, `FormData` and `File`: a body is read as the server would read it.
beforeAll(suspendHappyDom)
afterAll(resumeHappyDom)

async function post(path: string, body: string | FormData, contentType?: string) {
  const res = await formBodyApp.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      ...(contentType ? { headers: { 'content-type': contentType } } : {}),
      body,
    }),
  )
  const json: unknown = await res.json()
  return { status: res.status, body: json }
}

const URLENCODED = 'application/x-www-form-urlencoded'
const LIMIT = { limit: { valueType: 'number', valueText: '20' } }

function form(fields: readonly (readonly [string, string | File])[]) {
  const data = new FormData()
  for (const [name, value] of fields) data.append(name, value)
  return data
}

// Every kind of field, sent alone as `<name>=<value>`.
describe('urlencoded: every kind of field is read from text', () => {
  it.each([
    ['name', 'alice', { valueType: 'string', valueText: 'alice' }],
    // A plus sign is a space in a urlencoded body.
    ['name', 'a+b', { valueType: 'string', valueText: 'a b' }],
    ['name', 'a%20b', { valueType: 'string', valueText: 'a b' }],
    ['age', '5', { valueType: 'number', valueText: '5' }],
    ['age', '0', { valueType: 'number', valueText: '0' }],
    ['ratio', '1.5', { valueType: 'number', valueText: '1.5' }],
    ['big', '9007199254740991', { valueType: 'number', valueText: '9007199254740991' }],
    ['active', 'true', { valueType: 'boolean', valueText: 'true' }],
    ['active', 'false', { valueType: 'boolean', valueText: 'false' }],
    ['limit', '7', { valueType: 'number', valueText: '7' }],
    // A scalar component is written for a typed value; the form reads a copy of it from text.
    ['count', '3', { valueType: 'number', valueText: '3' }],
    ['flag', 'true', { valueType: 'boolean', valueText: 'true' }],
    [
      'moment',
      '2020-01-02T03:04:05Z',
      { valueType: 'Date', valueText: '2020-01-02T03:04:05.000Z' },
    ],
    ['clock', '12:34:56%2B09:00', { valueType: 'string', valueText: '12:34:56+09:00' }],
    ['maybe', '5', { valueType: 'number', valueText: '5' }],
    // A nullable integer reads the word `null`; a nullable string keeps it as text.
    ['maybe', 'null', { valueType: 'null', valueText: 'null' }],
    ['label', 'null', { valueType: 'string', valueText: 'null' }],
    // A numeric enum and a boolean const read the spelling of a member.
    ['level', '2', { valueType: 'number', valueText: '2' }],
    ['agreed', 'true', { valueType: 'boolean', valueText: 'true' }],
    ['either', '5', { valueType: 'number', valueText: '5' }],
    ['either', 'x', { valueType: 'string', valueText: 'x' }],
    // What the integer member does not read, the string member takes.
    ['either', '1.5', { valueType: 'string', valueText: '1.5' }],
  ])('%s reads %s', async (name, value, echo) => {
    const { status, body } = await post('/urlencoded', `${name}=${value}`, URLENCODED)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ ...LIMIT, [name]: echo })
  })

  it('limit falls back to its default when it is not sent', async () => {
    const { status, body } = await post('/urlencoded', 'name=alice', URLENCODED)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ ...LIMIT, name: { valueType: 'string', valueText: 'alice' } })
  })

  it('answers the default alone for an empty body', async () => {
    const { status, body } = await post('/urlencoded', '', URLENCODED)
    expect(status).toBe(200)
    expect(body).toStrictEqual(LIMIT)
  })

  it('ignores a field the schema does not declare', async () => {
    const { status, body } = await post('/urlencoded', 'unknown=1', URLENCODED)
    expect(status).toBe(200)
    expect(body).toStrictEqual(LIMIT)
  })

  it('reads several fields in one body', async () => {
    const { status, body } = await post('/urlencoded', 'name=a&age=5&active=true', URLENCODED)
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      ...LIMIT,
      name: { valueType: 'string', valueText: 'a' },
      age: { valueType: 'number', valueText: '5' },
      active: { valueType: 'boolean', valueText: 'true' },
    })
  })
})

// An array field is sent by repeating its name. Sent once, it arrives as a bare string, which the
// generated schema reads as a one-element array; a comma splits a value into elements, as it does
// in a query string.
describe('urlencoded: arrays', () => {
  it.each([
    ['tags', 'tags=x', [{ valueType: 'string', valueText: 'x' }]],
    [
      'tags',
      'tags=x&tags=y',
      [
        { valueType: 'string', valueText: 'x' },
        { valueType: 'string', valueText: 'y' },
      ],
    ],
    [
      'tags',
      'tags=x,y',
      [
        { valueType: 'string', valueText: 'x' },
        { valueType: 'string', valueText: 'y' },
      ],
    ],
    ['ids', 'ids=1', [{ valueType: 'number', valueText: '1' }]],
    [
      'ids',
      'ids=1&ids=2',
      [
        { valueType: 'number', valueText: '1' },
        { valueType: 'number', valueText: '2' },
      ],
    ],
    [
      'ids',
      'ids=1,2',
      [
        { valueType: 'number', valueText: '1' },
        { valueType: 'number', valueText: '2' },
      ],
    ],
    ['flags', 'flags=true', [{ valueType: 'boolean', valueText: 'true' }]],
    [
      'flags',
      'flags=true&flags=false',
      [
        { valueType: 'boolean', valueText: 'true' },
        { valueType: 'boolean', valueText: 'false' },
      ],
    ],
  ])('%s reads %s', async (name, query, elements) => {
    const { status, body } = await post('/urlencoded', query, URLENCODED)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ ...LIMIT, [name]: elements })
  })
})

// multipart/form-data carries a file as a file and everything else as text.
describe('multipart: a file beside fields read from text', () => {
  const file = () => new File(['x'], 'a.txt')

  it('file arrives as a file', async () => {
    const { status, body } = await post('/multipart', form([['file', file()]]))
    expect(status).toBe(200)
    expect(body).toStrictEqual({ file: { valueType: 'File', valueText: 'a.txt' } })
  })

  it('files reads every file sent under its name', async () => {
    const { status, body } = await post(
      '/multipart',
      form([
        ['file', file()],
        ['files', new File(['y'], 'b.txt')],
        ['files', new File(['z'], 'c.txt')],
      ]),
    )
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      file: { valueType: 'File', valueText: 'a.txt' },
      files: [
        { valueType: 'File', valueText: 'b.txt' },
        { valueType: 'File', valueText: 'c.txt' },
      ],
    })
  })

  it.each([
    ['age', '5', { valueType: 'number', valueText: '5' }],
    ['ratio', '1.5', { valueType: 'number', valueText: '1.5' }],
    ['active', 'true', { valueType: 'boolean', valueText: 'true' }],
    ['active', 'false', { valueType: 'boolean', valueText: 'false' }],
  ])('%s arrives as %s beside the file', async (name, value, echo) => {
    const { status, body } = await post(
      '/multipart',
      form([
        ['file', file()],
        [name, value],
      ]),
    )
    expect(status).toBe(200)
    expect(body).toStrictEqual({ file: { valueType: 'File', valueText: 'a.txt' }, [name]: echo })
  })

  it.each([
    [[['ids', '1']] as const, [{ valueType: 'number', valueText: '1' }]],
    [
      [
        ['ids', '1'],
        ['ids', '2'],
      ] as const,
      [
        { valueType: 'number', valueText: '1' },
        { valueType: 'number', valueText: '2' },
      ],
    ],
  ])('ids reads %j as an array of numbers', async (fields, elements) => {
    const { status, body } = await post('/multipart', form([['file', file()], ...fields]))
    expect(status).toBe(200)
    expect(body).toStrictEqual({ file: { valueType: 'File', valueText: 'a.txt' }, ids: elements })
  })
})

// A body that is a component schema takes a copy of the component, read from text, so every field
// arrives typed; the JSON body of the same component keeps the component as it is.
describe('component: a form body that is a component schema', () => {
  it('reads the fields of the component from text', async () => {
    const { status, body } = await post('/component', 'name=a&price=1&stocked=true', URLENCODED)
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      name: { valueType: 'string', valueText: 'a' },
      price: { valueType: 'number', valueText: '1' },
      stocked: { valueType: 'boolean', valueText: 'true' },
    })
  })

  it('a JSON body of the same component arrives typed', async () => {
    const { status, body } = await post(
      '/json',
      '{"name":"a","price":1,"stocked":true}',
      'application/json',
    )
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      name: { valueType: 'string', valueText: 'a' },
      price: { valueType: 'number', valueText: '1' },
      stocked: { valueType: 'boolean', valueText: 'true' },
    })
  })
})

// A form-body schema still takes a JSON body: a client that sends JSON to the route, as Eden
// Treaty does, is read as it would be by a JSON schema.
describe('json: a form-body schema takes a JSON body too', () => {
  it('reads typed values', async () => {
    const { status, body } = await post(
      '/urlencoded',
      '{"age":5,"active":true,"ratio":1.5}',
      'application/json',
    )
    expect(status).toBe(200)
    expect(body).toStrictEqual({
      ...LIMIT,
      age: { valueType: 'number', valueText: '5' },
      ratio: { valueType: 'number', valueText: '1.5' },
      active: { valueType: 'boolean', valueText: 'true' },
    })
  })
})

describe('leniency: what is read beyond the plainest spelling (pinned, not endorsed)', () => {
  it.each([
    ['age', '0x10', { valueType: 'number', valueText: '16' }],
    ['age', '007', { valueType: 'number', valueText: '7' }],
    ['age', '1e1', { valueType: 'number', valueText: '10' }],
  ])('%s reads %s', async (name, value, echo) => {
    const { status, body } = await post('/urlencoded', `${name}=${value}`, URLENCODED)
    expect(status).toBe(200)
    expect(body).toStrictEqual({ ...LIMIT, [name]: echo })
  })
})
