// The sample ULID, KSUID and cuid2 values are random identifiers, not words.
// cspell:ignore NDEKTSV RRFFQ
// Every parameter shape the generator supports, sent as a real cookie and rejected. A non-string
// shape that coerces carelessly would accept anything, and a format that is not validated would
// pass anything through: both are what this file catches.
//
// Every request here answers 422 with `{ issues: [...] }`: the name of each cookie that failed, or
// `''` where Elysia validates a coerced number against its own bounds and reports it without a
// path. See valid.test.ts for the routes and how to read an answer.
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

async function rejects(path: string, cookie: string | undefined, issues: readonly string[]) {
  const { status, body } = await get(path, cookie)
  expect(status).toBe(422)
  expect(body).toStrictEqual({ issues })
}

describe('shapes: a shape that is not a string rejects a word', () => {
  it.each(['integer', 'int32', 'int64', 'number', 'double', 'boolean'])(
    '%s rejects "not-a-value"',
    async (name) => {
      await rejects('/cookies', `${name}=not-a-value`, [name])
    },
  )
})

describe('integers: rejected values', () => {
  it.each([
    ['integer', '1.5', ['integer']],
    ['integer', '9007199254740992', ['']],
    ['integer', 'Infinity', ['integer']],
    ['integer', 'NaN', ['integer']],
    ['integer', '1,000', ['integer']],
    ['integer', 'null', ['integer']],
    ['integer', 'true', ['integer']],
    ['integer', '12abc', ['integer']],
    ['integer', '', ['integer']],
    ['int32', '2147483648', ['']],
    ['int32', '-2147483649', ['']],
    ['int64', '9007199254740993', ['']],
    ['int64', '1.5', ['int64']],
  ])('%s rejects %j', async (name, value, issues) => {
    await rejects('/cookies', `${name}=${q(value)}`, issues)
  })
})

describe('floats: rejected values', () => {
  it.each([
    ['Infinity', ['']],
    ['NaN', ['number']],
    ['1e400', ['']],
    ['1,5', ['number']],
    ['1.5.5', ['number']],
  ])('number rejects %j', async (value, issues) => {
    await rejects('/cookies', `number=${q(value)}`, issues)
  })
})

describe('booleans: rejected values', () => {
  it.each(['1', '0', 'yes', 'TRUE', 't', '', 'truthy'])('boolean rejects %j', async (value) => {
    await rejects('/cookies', `boolean=${value}`, ['boolean'])
  })
})

describe('formats: what each string format rejects', () => {
  it.each([
    ['email', 'a@b'],
    ['email', 'user@'],
    ['uuid', 'nope'],
    ['uri', 'example.com'],
    ['hostname', '-bad-'],
    ['ipv4', '999.1.1.1'],
    ['date', '2020-13-01'],
    ['datetime', 'nope'],
    ['time', '12:34:56'],
    ['duration', 'P'],
    ['byte', '**'],
  ])('%s rejects %j', async (name, value) => {
    await rejects('/cookies', `${name}=${q(value)}`, [name])
  })
})

// Every element is validated: a JSON array as a whole, a comma-separated value at the index of
// the element that failed, and a broken JSON array at its first element.
describe('arrays: every element is validated', () => {
  it.each([
    ['[1,"x"]', ['ids']],
    ['1,x', ['1']],
    ['[1,2', ['0']],
  ])('ids rejects %j', async (value, issues) => {
    await rejects('/cookies', `ids=${q(value)}`, issues)
  })
})

describe('literals: enum and const', () => {
  it.each(['up', 'ASC'])('senum rejects %j', async (value) => {
    await rejects('/optional', `senum=${value}`, ['senum'])
  })

  it('sconst rejects any other value', async () => {
    await rejects('/optional', 'sconst=other', ['sconst'])
  })

  it('oneof rejects what fits no member', async () => {
    await rejects('/optional', 'oneof=x', ['oneof'])
  })
})

describe('constraints', () => {
  it.each([
    ['range', '0', ['']],
    ['range', '101', ['']],
    ['range', '50.5', ['range']],
    ['length', 'a', ['length']],
    ['length', 'abcde', ['length']],
    ['pattern', 'ABC-12', ['pattern']],
  ])('%s rejects %j', async (name, value, issues) => {
    await rejects('/optional', `${name}=${value}`, issues)
  })

  it('email_lower rejects what is not an email', async () => {
    await rejects('/optional', 'email_lower=nope', ['email_lower'])
  })
})

describe('references: a schema behind $ref', () => {
  it('ref_int is bounded by the component', async () => {
    await rejects('/optional', 'ref_int=-1', [''])
  })

  it('ref_int rejects a word', async () => {
    await rejects('/optional', 'ref_int=x', ['ref_int'])
  })
})

describe('objects: an object in one cookie', () => {
  // The object is validated as a whole, so the issue names the cookie, not the property.
  it('profile rejects a word where a property is an integer', async () => {
    await rejects('/optional', `profile=${q('{"a":"x"}')}`, ['profile'])
  })
})

describe('optional: a present value is still validated', () => {
  it.each([
    ['int_opt', 'x'],
    ['bool_opt', 'maybe'],
    ['session-id', 'x'],
  ])('%s rejects a word', async (name, value) => {
    await rejects('/optional', `${name}=${value}`, [name])
  })

  it('reports every cookie that fails', async () => {
    await rejects('/optional', 'int_opt=x; bool_opt=maybe', ['int_opt', 'bool_opt'])
  })

  // The first of a name sent twice is the one read, and the one validated.
  it('rejects a name sent twice whose first value is invalid', async () => {
    await rejects('/optional', 'int_opt=x; int_opt=1', ['int_opt'])
  })
})

describe('defaults', () => {
  it.each([
    ['int_def', 'x'],
    ['int_def', ''],
    ['bool_def', 'maybe'],
    ['enum_def', 'up'],
  ])('%s rejects %j rather than falling back', async (name, value) => {
    await rejects('/defaults', `${name}=${value}`, [name])
  })
})

describe('required', () => {
  it.each([
    ['flag=true; name=n', ['id']],
    ['id=1; name=n', ['flag']],
    ['id=1; flag=true', ['name']],
  ])('%j names the missing cookie', async (cookie, issues) => {
    await rejects('/required', cookie, issues)
  })

  it.each([undefined, ''])(
    'names every missing cookie for a Cookie header of %j',
    async (cookie) => {
      await rejects('/required', cookie, ['id', 'flag', 'name'])
    },
  )

  it('validates a required value that was sent', async () => {
    await rejects('/required', 'id=x; flag=true; name=n', ['id'])
  })

  it('validates the optional cookie when it is sent', async () => {
    await rejects('/required', 'id=1; flag=true; name=n; note=x', ['note'])
  })
})

// A literal read from text is matched against the spelling of its members, exactly.
describe('text: what is not the spelling of a member', () => {
  it.each([
    ['ienum', '4'],
    ['ienum', '02'],
    ['ienum', 'x'],
    ['inull', 'NULL'],
    ['inull', ''],
    ['inull', 'x'],
  ])('%s rejects %j', async (name, value) => {
    await rejects('/optional', `${name}=${value}`, [name])
  })
})

// What the generated schema declares but Elysia's cookie jar does not turn into its value.
// Pinned so the day Elysia reads them is noticed.
describe('limitations: what Elysia does not read from a cookie (pinned)', () => {
  // A default is not applied to an absent cookie: the jar holds what was sent, and nothing else.
  it('does not fill an absent cookie with its default', async () => {
    const { status, body } = await get('/defaults')
    expect(status).toBe(200)
    expect(body).toStrictEqual({})
  })

  // A repeated name is read once: the first value is the cookie, and the array is that one value.
  it('ids reads only the first of a name sent twice', async () => {
    const { status, body } = await get('/cookies', 'ids=1; ids=2')
    expect(status).toBe(200)
    expect(body).toStrictEqual({ ids: [{ valueType: 'number', valueText: '1' }] })
  })
})

describe('formats and references read from text', () => {
  it.each([
    ['/cookies', 'mac', '00-1a-2b-3c-4d-5e'],
    ['/cookies', 'ulid', '01ARZ3NDEKTSV4RRFFQ69G5FAU'],
    ['/optional', 'ref_flag', 'x'],
  ])('%s %s rejects %j', async (path, name, value) => {
    await rejects(path, `${name}=${value}`, [name])
  })
})
