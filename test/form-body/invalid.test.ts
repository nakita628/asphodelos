// A form body carries every field as text, so a value that is not read as its type is rejected,
// and a constraint applies to the value as read.
//
// Every request here answers 422 with `{ issues: [...] }`: the path of each field that failed, or
// `''` where Elysia reports one without a path. See valid.test.ts for the routes and how to read an
// answer.
import { afterAll, beforeAll, describe, expect, it } from 'bun:test'

import { resumeHappyDom, suspendHappyDom } from '../happydom.js'
import { formBodyApp } from './app.js'

// The runtime's own `Request`, `FormData` and `File`: see valid.test.ts.
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

function form(fields: readonly (readonly [string, string | File])[]) {
  const data = new FormData()
  for (const [name, value] of fields) data.append(name, value)
  return data
}

async function rejects(path: string, body: string | FormData, issues: readonly string[]) {
  const res = await post(path, body, typeof body === 'string' ? URLENCODED : undefined)
  expect(res.status).toBe(422)
  expect(res.body).toStrictEqual({ issues })
}

describe('urlencoded: rejected values', () => {
  it.each([
    ['age', 'x', ['age']],
    ['age', '', ['age']],
    ['age', '1.5', ['age']],
    // The bound applies to the coerced number, which Elysia validates on its own.
    ['age', '-1', ['']],
    ['ratio', 'x', ['ratio']],
    ['big', '1.5', ['big']],
    ['big', '9007199254740993', ['']],
    // Only `true` and `false` spell a boolean.
    ['active', 'x', ['active']],
    ['active', '0', ['active']],
    ['active', 'on', ['active']],
    ['active', '', ['active']],
    // An empty value is not the absence that falls back to the default.
    ['limit', '', ['limit']],
    ['count', '-1', ['']],
    ['moment', 'nope', ['moment']],
    ['clock', '12:34:56', ['clock']],
  ])('%s rejects %j', async (name, value, issues) => {
    await rejects('/urlencoded', `${name}=${value}`, issues)
  })

  // A scalar field sent twice is an array, which is not an integer.
  it('age rejects a field sent twice', async () => {
    await rejects('/urlencoded', 'age=5&age=6', ['age'])
  })

  it('reports every field that fails', async () => {
    await rejects('/urlencoded', 'age=x&ratio=y', ['age', 'ratio'])
  })
})

// The array is read as a whole, so the issue names the field, not the element.
describe('urlencoded: arrays', () => {
  it('ids rejects a word among its elements', async () => {
    await rejects('/urlencoded', 'ids=1&ids=x', ['ids'])
  })

  it('flags rejects a word among its elements', async () => {
    await rejects('/urlencoded', 'flags=true&flags=x', ['flags'])
  })
})

describe('multipart: rejected values', () => {
  const file = () => new File(['x'], 'a.txt')

  it('reports a missing file', async () => {
    await rejects('/multipart', form([['age', '5']]), [''])
  })

  it('rejects text where a file is declared', async () => {
    await rejects('/multipart', form([['file', 'text']]), [''])
  })

  it.each([
    ['age', 'x'],
    ['age', '1.5'],
    ['ratio', 'x'],
    ['active', 'x'],
    ['active', '1'],
  ])('%s rejects %j beside the file', async (name, value) => {
    await rejects(
      '/multipart',
      form([
        ['file', file()],
        [name, value],
      ]),
      [''],
    )
  })

  it('ids rejects a word among its elements beside the file', async () => {
    await rejects(
      '/multipart',
      form([
        ['file', file()],
        ['ids', '1'],
        ['ids', 'x'],
      ]),
      [''],
    )
  })
})

describe('component: rejected values', () => {
  it('rejects a word where the component declares an integer', async () => {
    await rejects('/component', 'name=a&price=x', ['price'])
  })

  it('reports a missing required field of the component', async () => {
    await rejects('/component', 'price=1', ['name'])
  })

  it('rejects a value below the minimum the component declares', async () => {
    await rejects('/component', 'name=a&price=-1', [''])
  })

  it('a JSON body rejects a string where a boolean is declared', async () => {
    const { status, body } = await post(
      '/json',
      '{"name":"a","price":1,"stocked":"true"}',
      'application/json',
    )
    expect(status).toBe(422)
    expect(body).toStrictEqual({ issues: ['stocked'] })
  })
})

// A literal read from text is matched against the spelling of its members, exactly, and only the
// word `null` is null.
describe('text: what is not the spelling of a member', () => {
  it.each([
    ['level', '3'],
    ['level', '02'],
    ['agreed', 'false'],
    ['agreed', '1'],
    ['maybe', 'NULL'],
    ['maybe', ''],
  ])('%s rejects %j', async (name, value) => {
    await rejects('/urlencoded', `${name}=${value}`, [name])
  })

  it('a component read from text validates its boolean', async () => {
    await rejects('/component', 'name=a&price=1&stocked=x', ['stocked'])
  })

  // A scalar of the component sent twice is an array.
  it('a component rejects a field sent twice', async () => {
    await rejects('/component', 'name=a&price=1&price=2', ['price'])
  })
})

// What the generated schema declares but the form body does not carry as declared. Pinned so the
// day it changes is noticed.
describe('limitations (pinned)', () => {
  // A property that is itself a `$ref` keeps the component, which is written for a typed value:
  // a boolean component is not read from text, where an integer one is, by Elysia itself.
  it('a boolean component property is not read from text', async () => {
    await rejects('/urlencoded', 'flag=true', ['flag'])
  })
})
