// Every parameter shape the generator supports, sent as a real path segment and rejected. See
// valid.test.ts for the routes and how to read an answer.
//
// Every request here answers 422 with `{ issues: [...] }` — the name of each parameter that failed,
// or `''` where Elysia validates a coerced number against its own bounds and reports it without a
// path — or 404 when the request matches no route at all.
import { describe, expect, it } from 'bun:test'

import { pathParamsApp } from './app.js'

async function get(url: string, method = 'GET') {
  const res = await pathParamsApp.handle(new Request(`http://localhost${url}`, { method }))
  return { status: res.status, text: await res.text() }
}

const q = (value: string) => encodeURIComponent(value)

async function rejects(url: string, issues: readonly string[], method = 'GET') {
  const { status, text } = await get(url, method)
  expect(status).toBe(422)
  expect(JSON.parse(text)).toStrictEqual({ issues })
}

// A word must be rejected by every shape that is not a string.
describe('shapes: a shape that is not a string rejects a word', () => {
  it.each(['integer', 'int32', 'int64', 'number', 'double', 'boolean'])(
    '%s rejects "not-a-value"',
    async (name) => {
      await rejects(`/${name}/not-a-value`, ['value'])
    },
  )
})

describe('integers: rejected values', () => {
  it.each([
    ['integer', '1.5', ['value']],
    // Past MAX_SAFE_INTEGER a double rounds to a different number, so the value is refused — by
    // the bound the generator puts on every integer, which Elysia reports without a path.
    ['integer', '9007199254740993', ['']],
    ['integer', 'Infinity', ['value']],
    ['integer', 'NaN', ['value']],
    ['integer', '1,000', ['value']],
    ['integer', '1_000', ['value']],
    ['integer', 'null', ['value']],
    ['integer', 'true', ['value']],
    ['integer', '12abc', ['value']],
    // One past each int32 bound.
    ['int32', '2147483648', ['']],
    ['int32', '-2147483649', ['']],
    ['int32', '1.5', ['value']],
    ['int64', '9007199254740993', ['']],
    ['int64', '1.5', ['value']],
  ])('%s rejects %j', async (name, value, issues) => {
    await rejects(`/${name}/${q(value)}`, issues)
  })
})

describe('floats: rejected values', () => {
  it.each([
    ['number', 'Infinity', ['']],
    ['number', 'NaN', ['value']],
    ['number', '1e400', ['']],
    ['number', '1,5', ['value']],
    ['number', '1.5.5', ['value']],
    ['double', '1e309', ['']],
  ])('%s rejects %j', async (name, value, issues) => {
    await rejects(`/${name}/${q(value)}`, issues)
  })
})

// Only `true` and `false` spell a boolean.
describe('booleans: rejected values', () => {
  it.each(['1', '0', 'yes', 'TRUE', 't', ' true', 'truthy'])(
    'boolean rejects %j',
    async (value) => {
      await rejects(`/boolean/${q(value)}`, ['value'])
    },
  )
})

// A string format is a validator: a value that does not fit is rejected, not passed through.
describe('formats: what each string format rejects', () => {
  it.each([
    ['email', 'a@b'],
    ['email', 'user@'],
    ['email', 'nope'],
    ['uuid', 'nope'],
    ['uuid', '0190b1f400007000800000000000000'],
    ['uuid', '0190b1f4-0000-7000-8000-00000000000g'],
    ['hostname', '-bad-'],
    ['ipv4', '999.1.1.1'],
    ['ipv4', '1.2.3'],
    ['date', '2020-13-01'],
    ['date', 'nope'],
    ['datetime', 'nope'],
    ['byte', '**'],
  ])('%s rejects %j', async (name, value) => {
    await rejects(`/${name}/${q(value)}`, ['value'])
  })
})

describe('literals: enum and const', () => {
  // Members are compared exactly: case matters.
  it.each(['up', 'ASC'])('senum rejects %j', async (value) => {
    await rejects(`/senum/${value}`, ['value'])
  })

  it('sconst rejects any other value', async () => {
    await rejects('/sconst/other', ['value'])
  })

  // A member that looks like a number is still matched as text.
  it('numericsenum rejects a number that is not spelled like a member', async () => {
    await rejects('/numericsenum/2', ['value'])
  })
})

describe('constraints: numeric and string', () => {
  it.each([
    // The bounds apply to the coerced number, which Elysia validates on its own.
    ['range', '0', ['']],
    ['range', '11', ['']],
    // A fraction is not an integer, whatever the bounds.
    ['range', '5.5', ['value']],
    ['exclusive', '0', ['']],
    ['exclusive', '1', ['']],
    ['multiple', '7', ['']],
    ['length', 'a', ['value']],
    ['length', 'abcde', ['value']],
    ['pattern', 'ABC-12', ['value']],
    ['pattern', 'abc-1234', ['value']],
  ])('%s rejects %j', async (name, value, issues) => {
    await rejects(`/${name}/${value}`, issues)
  })
})

describe('declarations: several parameters in one path', () => {
  it.each([
    ['/orgs/x/repos/0190b1f4-0000-7000-8000-000000000000/issues/1', ['orgId']],
    ['/orgs/1/repos/nope/issues/1', ['repoId']],
    ['/orgs/1/repos/0190b1f4-0000-7000-8000-000000000000/issues/x', ['issueId']],
    // Every failing parameter is named, not just the first.
    ['/orgs/x/repos/nope/issues/y', ['orgId', 'repoId', 'issueId']],
  ])('%s names the parameter that failed', async (url, issues) => {
    await rejects(url, issues)
  })
})

describe('declarations: parameter names that are not identifiers', () => {
  it.each([
    ['/named/x/true', ['user-id']],
    ['/named/7/maybe', ['post_id']],
  ])('%s names the parameter under its own spelling', async (url, issues) => {
    await rejects(url, issues)
  })
})

describe('declarations: $ref and path-item level', () => {
  it('validates a parameter declared as a component', async () => {
    await rejects('/paramref/x', ['id'])
  })

  it('applies the bound of a schema component to the coerced value', async () => {
    await rejects('/schemaref/-1', [''])
    await rejects('/schemaref/x', ['value'])
  })

  it.each(['GET', 'DELETE'])(
    '%s validates the parameter the path item declares',
    async (method) => {
      await rejects('/shared/x', ['id'], method)
    },
  )

  // The path item said integer; the operation's override, a uuid, is what applies.
  it("validates by the operation's override, not the path item's declaration", async () => {
    await rejects('/override/3', ['id'])
  })
})

describe('combinators: oneOf and allOf', () => {
  it.each([
    // The merged bound applies to the coerced number, which Elysia validates on its own.
    ['allof', '3', ['']],
    ['allof', 'x', ['value']],
    ['oneof', 'x', ['value']],
  ])('%s rejects %j', async (name, value, issues) => {
    await rejects(`/${name}/${value}`, issues)
  })

  it('txemail rejects what is not an email, after the transform', async () => {
    await rejects('/txemail/nope', ['value'])
  })
})

// A path parameter is a segment: without one there is no route to match.
describe('wire: routing', () => {
  it.each(['/integer/', '/integer/42/extra', '/nope/1'])('%s matches no route', async (url) => {
    expect((await get(url)).status).toBe(404)
  })
})

// What the generated schema declares but Elysia's path reader does not turn into its value.
// Pinned so the day Elysia reads it is noticed; a document that needs it today should declare the
// parameter as a string and read it in the handler.
describe('limitations: what Elysia does not read from a path segment (pinned)', () => {
  // A numeric enum is matched against numbers, and the segment is text — so even a member fails.
  it.each(['1', '2', '3', 'x'])('a numeric enum rejects %j', async (value) => {
    await rejects(`/ienum/${value}`, ['value'])
  })

  // A segment is one value: a `label` or `matrix` prefix is not stripped, and an array is not
  // split on its commas. The plain spelling is read as the scalar it looks like.
  it.each([
    ['/label/.5', ['value']],
    [`/matrix/${q(';value=5')}`, ['value']],
    ['/simplearr/1,2', ['value']],
    ['/simplearr/1', ['value']],
  ])('%s is not read by its style', async (url, issues) => {
    await rejects(url, issues)
  })

  it.each(['label', 'matrix'])('%s reads the plain spelling as the scalar', async (name) => {
    const { status } = await get(`/${name}/5`)
    expect(status).toBe(200)
  })
})
