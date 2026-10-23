// A JSON body has types of its own: a value of another type is rejected, not read from text, and
// a constraint applies to the value as sent.
//
// Every request here answers 422 with `{ issues: [...] }`: the path of each field that failed. See
// valid.test.ts for the routes and how to read an answer.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { Elysia } from 'elysia'

import { resumeHappyDom, suspendHappyDom } from '../happydom.js'
import { TypesModel } from './__generated__/modules/types/model.js'
import { jsonBodyApp } from './app.js'

// The runtime's own `Request`: see valid.test.ts.
beforeAll(suspendHappyDom)
afterAll(resumeHappyDom)

async function post(path: string, json: string, contentType = 'application/json') {
  const res = await jsonBodyApp.handle(
    new Request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': contentType },
      body: json,
    }),
  )
  return { status: res.status, text: await res.text() }
}

async function rejects(path: string, json: string, issues: readonly string[]) {
  const { status, text } = await post(path, json)
  expect(status).toBe(422)
  expect(JSON.parse(text)).toStrictEqual({ issues })
}

describe('integers: rejected values', () => {
  it.each([
    // 9007199254740993 cannot be held by a JSON number: the generated bound refuses it rather
    // than letting it round.
    ['id', '9007199254740993'],
    ['id', '1.5'],
    ['id', '"1.5"'],
    ['id', '"abc"'],
    ['id', '""'],
    ['id', 'true'],
    ['id', 'null'],
    ['ranged', '0'],
    ['ranged', '101'],
    ['level', '3'],
    ['level', '"2"'],
    ['version', '6'],
    ['small', '2147483648'],
    ['ref', '-1'],
    ['ratio', '"1.5"'],
    ['ratio', '"x"'],
    // A boolean in a JSON body is a JSON boolean, not the text "true".
    ['active', '"true"'],
    ['active', '1'],
  ])('%s rejects %s', async (name, json) => {
    await rejects('/numbers', `{"${name}":${json}}`, [name])
  })

  it('ids rejects a word among its elements, at its index', async () => {
    await rejects('/numbers', '{"ids":[1,"x"]}', ['ids/1'])
  })

  it('ids rejects a bare number', async () => {
    await rejects('/numbers', '{"ids":1}', ['ids/0'])
  })

  it('reports every field that fails', async () => {
    await rejects('/numbers', '{"id":"x","ratio":"y"}', ['id', 'ratio'])
  })
})

describe('types: rejected values', () => {
  it.each([
    ['either', 'true'],
    ['either', '1.5'],
    ['flagged', '"x"'],
    ['bounded', '0'],
    ['bounded', '"a"'],
  ])('%s rejects %s', async (name, json) => {
    await rejects('/types', `{"${name}":${json}}`, [name])
  })
})

describe('formats: rejected values', () => {
  it.each([
    ['moment', '"nope"'],
    ['day', '"nope"'],
    // An RFC 3339 time carries its offset.
    ['clock', '"12:34:56"'],
    ['bytes', '"**"'],
  ])('%s rejects %s', async (name, json) => {
    await rejects('/types', `{"${name}":${json}}`, [name])
  })
})

describe('objects: rejected values', () => {
  it('labelled rejects a number for its declared string', async () => {
    await rejects('/types', '{"labelled":{"name":1}}', ['labelled/name'])
  })

  it('labelled rejects a word for an additional property', async () => {
    await rejects('/types', '{"labelled":{"name":"a","count":"x"}}', ['labelled/count'])
  })

  it('inherited rejects a word for its constructor property', async () => {
    await rejects('/types', '{"inherited":{"constructor":"x"}}', ['inherited/constructor'])
  })
})

describe('wire: what is not a JSON body', () => {
  it.each(['not json', ''])('answers 400 to %j', async (json) => {
    const { status } = await post('/numbers', json)
    expect(status).toBe(400)
  })

  // A body of another content type is not read as JSON: the fields are absent.
  it('does not read a text body', async () => {
    const { status, text } = await post('/numbers', '{"id":1}', 'text/plain')
    expect(status).toBe(200)
    expect(JSON.parse(text)).toStrictEqual({ cursor: { valueType: 'number', valueText: '0' } })
  })
})

// What the generated schema declares but TypeBox does not read as declared. Pinned so the day it
// changes is noticed.
describe('limitations (pinned)', () => {
  // An optional property named like what every JavaScript object inherits: when it is absent,
  // TypeBox finds the inherited `constructor` and validates that instead.
  it('inherited rejects an object without its constructor property', async () => {
    await rejects('/types', '{"inherited":{"name":"a"}}', ['inherited/constructor'])
  })
})

// Elysia removes the keys a schema does not declare before validating it (`normalize`, on by
// default), so `additionalProperties: false` sees none and the extra key is dropped — see
// valid.test.ts. An app that wants the key refused turns `normalize` off, and the generated
// schema then rejects it.
describe('additionalProperties: false with normalize off', () => {
  const strictApp = new Elysia({ normalize: false })
    .onError(({ code, status }) => (code === 'VALIDATION' ? status(422, 'rejected') : undefined))
    .post('/types', ({ body }) => body, { body: TypesModel.typesBody })

  async function postStrict(json: string) {
    const res = await strictApp.handle(
      new Request('http://localhost/types', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: json,
      }),
    )
    return res.status
  }

  it('rejects an undeclared property of a closed object', async () => {
    expect(await postStrict('{"strict":{"a":1,"b":2}}')).toBe(422)
  })

  it('accepts the declared property', async () => {
    expect(await postStrict('{"strict":{"a":1}}')).toBe(200)
  })
})
