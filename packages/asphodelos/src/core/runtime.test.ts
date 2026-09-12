// `sess_<id>` is the cookie shape the parameter pattern under test expects.
// cspell:ignore sess
import { afterAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { TSchema } from '@sinclair/typebox'
import { Elysia } from 'elysia'

import type { OpenAPI, Schema } from '../openapi/index.js'
import { runGenerator } from '../testing/index.js'
import { elysia, schemas } from './index.js'

/**
 * End-to-end coverage for the code asphodelos emits: every case below generates a real module
 * from a real OpenAPI document, imports it, mounts it in Elysia, and drives an actual `Request`
 * through the router.
 *
 * This is the layer that string-comparison tests cannot reach. `typebox()` emitting
 * `error:(error)=>{...if(type===52)return "too short"...}` proves nothing on its own — the
 * numbers are TypeBox's `ValueErrorType` enum, and whether Elysia routes a 422 to that callback
 * at all depends on the validator it builds. Both are upstream behavior, so both need a request
 * to confirm. A change in either shows up here as a failing status or a missing message.
 *
 * The work tree has to live inside this package: the generated modules `import { t } from
 * 'elysia'`, and Node resolution only finds that by walking up to `packages/asphodelos`.
 * `tmp-*` is gitignored and excluded from lint and format.
 */
const PKG_ROOT = path.resolve(import.meta.dir, '../..')

const workdirs: string[] = []

afterAll(() => {
  for (const dir of workdirs) rmSync(dir, { recursive: true, force: true })
})

/** Generates the app, its resource modules and `components/schemas.ts` into a fresh directory. */
async function generate(api: OpenAPI) {
  const dir = mkdtempSync(path.join(PKG_ROOT, 'tmp-runtime-'))
  workdirs.push(dir)
  const componentsOutput = path.join(dir, 'src/components/schemas.ts')
  const components = { schemas: { output: componentsOutput, split: false } }
  await runGenerator(elysia(api, { output: path.join(dir, 'src/index.ts'), components }))
  if (api.components?.schemas) {
    await runGenerator(schemas(api.components.schemas, componentsOutput, false, false, components))
  }
  return {
    dir,
    /** Mounts one generated resource module exactly as `src/index.ts` does. */
    async mount(resource: string) {
      const mod: { readonly [k: string]: unknown } = await import(
        path.join(dir, 'src/modules', resource, 'index.ts')
      )
      return new Elysia().use(mod[resource] as never)
    },
    schemasSource: () => readFile(componentsOutput, 'utf-8'),
  }
}

/** Generation is the slow half, so each document is built once and shared by its cases. */
function generateOnce(api: OpenAPI) {
  let pending: ReturnType<typeof generate> | undefined
  return () => {
    pending ??= generate(api)
    return pending
  }
}

const jsonRequest = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

/** Builds a document whose every case is one POST route under the same `check` resource. */
function checkDocument(cases: readonly { readonly key: string; readonly schema: Schema }[]) {
  const paths = Object.fromEntries(
    cases.map((c) => [
      `/check/${c.key}`,
      {
        post: {
          operationId: c.key,
          requestBody: {
            required: true,
            content: {
              'application/json': { schema: { $ref: `#/components/schemas/${c.key}Input` } },
            },
          },
          responses: { '201': { description: 'OK' } },
        },
      },
    ]),
  )
  const componentSchemas = Object.fromEntries(cases.map((c) => [`${c.key}Input`, c.schema]))
  return {
    openapi: '3.1.0',
    info: { title: 'runtime', version: '1.0.0' },
    paths,
    components: { schemas: componentSchemas },
  } as unknown as OpenAPI
}

// ── Vendor-extension messages ────────────────────────────────────────────────────────────────
//
// One case per `x-<keyword>-message` key. `rejects` is the payload that must violate the
// keyword; `message` is the exact body Elysia must return, or `undefined` where the generator
// emits a branch that a sibling child error wins over (the fixture suite recorded the same
// distinction). `accepts` must clear body validation.

type MessageCase = {
  readonly key: string
  readonly extension: string
  readonly schema: Schema
  readonly rejects: readonly unknown[]
  readonly accepts: unknown
  readonly message?: string
}

const prop = (value: Schema): Schema => ({
  type: 'object',
  required: ['value'],
  properties: { value },
})

const MESSAGE_CASES: readonly MessageCase[] = [
  {
    key: 'error',
    extension: 'x-error-message',
    schema: prop({ type: 'string', 'x-error-message': 'must be a string' }),
    rejects: [42],
    accepts: 'ok',
    message: 'must be a string',
  },
  {
    key: 'const',
    extension: 'x-const-message',
    schema: prop({ const: 'gold', 'x-const-message': 'must be exactly "gold"' }),
    rejects: ['silver'],
    accepts: 'gold',
    message: 'must be exactly "gold"',
  },
  {
    key: 'enum',
    extension: 'x-enum-message',
    schema: prop({
      type: 'string',
      enum: ['available', 'pending', 'sold'],
      'x-enum-message': 'must be one of: available, pending, sold',
    }),
    rejects: ['archived'],
    accepts: 'pending',
    message: 'must be one of: available, pending, sold',
  },
  {
    key: 'minLength',
    extension: 'x-minLength-message',
    schema: prop({ type: 'string', minLength: 3, 'x-minLength-message': 'too short' }),
    rejects: ['ab'],
    accepts: 'abc',
    message: 'too short',
  },
  {
    key: 'maxLength',
    extension: 'x-maxLength-message',
    schema: prop({ type: 'string', maxLength: 5, 'x-maxLength-message': 'too long' }),
    rejects: ['abcdef'],
    accepts: 'abcde',
    message: 'too long',
  },
  {
    // Both bounds carry a message, but `minLength === maxLength` collapses them into one branch,
    // so `x-length-message` must win over the two it supersedes — from either direction.
    key: 'length',
    extension: 'x-length-message',
    schema: prop({
      type: 'string',
      minLength: 4,
      maxLength: 4,
      'x-minLength-message': 'too short fallback',
      'x-maxLength-message': 'too long fallback',
      'x-length-message': 'must be exactly 4 chars',
    }),
    rejects: ['abc', 'abcde'],
    accepts: 'abcd',
    message: 'must be exactly 4 chars',
  },
  {
    key: 'pattern',
    extension: 'x-pattern-message',
    schema: prop({
      type: 'string',
      pattern: '^[a-z]+$',
      'x-pattern-message': 'lowercase only',
    }),
    rejects: ['ABC'],
    accepts: 'abc',
    message: 'lowercase only',
  },
  {
    key: 'minimum',
    extension: 'x-minimum-message',
    schema: prop({ type: 'number', minimum: 0, 'x-minimum-message': 'must be >= 0' }),
    rejects: [-1],
    accepts: 0,
    message: 'must be >= 0',
  },
  {
    key: 'maximum',
    extension: 'x-maximum-message',
    schema: prop({ type: 'number', maximum: 100, 'x-maximum-message': 'must be <= 100' }),
    rejects: [101],
    accepts: 100,
    message: 'must be <= 100',
  },
  {
    // The boundary value itself must fail, which is the whole point of the exclusive form.
    key: 'exclusiveMinimum',
    extension: 'x-exclusiveMinimum-message',
    schema: prop({
      type: 'number',
      exclusiveMinimum: 0,
      'x-exclusiveMinimum-message': 'must be > 0',
    }),
    rejects: [0, -1],
    accepts: 0.1,
  },
  {
    key: 'exclusiveMaximum',
    extension: 'x-exclusiveMaximum-message',
    schema: prop({
      type: 'number',
      exclusiveMaximum: 1,
      'x-exclusiveMaximum-message': 'must be < 1',
    }),
    rejects: [1],
    accepts: 0.9,
    message: 'must be < 1',
  },
  {
    key: 'multipleOf',
    extension: 'x-multipleOf-message',
    schema: prop({
      type: 'number',
      multipleOf: 0.5,
      'x-multipleOf-message': 'must be a multiple of 0.5',
    }),
    rejects: [0.7],
    accepts: 0.5,
    message: 'must be a multiple of 0.5',
  },
  {
    key: 'minItems',
    extension: 'x-minItems-message',
    schema: prop({
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      'x-minItems-message': 'at least 1 item',
    }),
    rejects: [[]],
    accepts: ['a'],
    message: 'at least 1 item',
  },
  {
    key: 'maxItems',
    extension: 'x-maxItems-message',
    schema: prop({
      type: 'array',
      items: { type: 'string' },
      maxItems: 2,
      'x-maxItems-message': 'at most 2 items',
    }),
    rejects: [['a', 'b', 'c']],
    accepts: ['a', 'b'],
    message: 'at most 2 items',
  },
  {
    key: 'uniqueItems',
    extension: 'x-uniqueItems-message',
    schema: prop({
      type: 'array',
      items: { type: 'string' },
      uniqueItems: true,
      'x-uniqueItems-message': 'no duplicates',
    }),
    rejects: [['a', 'a']],
    accepts: ['a', 'b'],
    message: 'no duplicates',
  },
  {
    key: 'contains',
    extension: 'x-contains-message',
    schema: prop({
      type: 'array',
      items: {},
      contains: { type: 'string' },
      'x-contains-message': 'must contain at least one string',
    }),
    rejects: [[1, 2, 3]],
    accepts: ['s', 1],
    message: 'must contain at least one string',
  },
  {
    key: 'minContains',
    extension: 'x-minContains-message',
    schema: prop({
      type: 'array',
      items: {},
      contains: { type: 'string' },
      minContains: 2,
      'x-minContains-message': 'at least 2 string matches',
    }),
    rejects: [['a', 1, 2]],
    accepts: ['a', 'b'],
    message: 'at least 2 string matches',
  },
  {
    key: 'maxContains',
    extension: 'x-maxContains-message',
    schema: prop({
      type: 'array',
      items: {},
      contains: { type: 'string' },
      maxContains: 1,
      'x-maxContains-message': 'at most 1 string match',
    }),
    rejects: [['a', 'b']],
    accepts: ['a', 1],
    message: 'at most 1 string match',
  },
  {
    key: 'minProperties',
    extension: 'x-minProperties-message',
    schema: prop({
      type: 'object',
      minProperties: 1,
      additionalProperties: { type: 'string' },
      'x-minProperties-message': 'at least 1 entry',
    }),
    rejects: [{}],
    accepts: { a: 'x' },
    message: 'at least 1 entry',
  },
  {
    key: 'maxProperties',
    extension: 'x-maxProperties-message',
    schema: prop({
      type: 'object',
      maxProperties: 2,
      additionalProperties: { type: 'string' },
      'x-maxProperties-message': 'at most 2 entries',
    }),
    rejects: [{ a: '1', b: '2', c: '3' }],
    accepts: { a: '1', b: '2' },
    message: 'at most 2 entries',
  },
  {
    key: 'propertyNames',
    extension: 'x-propertyNames-message',
    schema: prop({
      type: 'object',
      additionalProperties: { type: 'string' },
      propertyNames: { pattern: '^[a-z]+$' },
      'x-propertyNames-message': 'keys must be lowercase',
    }),
    rejects: [{ 'BAD-KEY': 'x' }],
    accepts: { lowercase: 'x' },
    message: 'keys must be lowercase',
  },
  {
    key: 'dependentRequired',
    extension: 'x-dependentRequired-message',
    schema: prop({
      type: 'object',
      properties: { label: { type: 'string' }, text: { type: 'string' } },
      dependentRequired: { label: ['text'] },
      'x-dependentRequired-message': 'label requires text',
    }),
    rejects: [{ label: 'l' }],
    accepts: { label: 'l', text: 't' },
    message: 'label requires text',
  },
  {
    key: 'dependentSchemas',
    extension: 'x-dependentSchemas-message',
    schema: prop({
      type: 'object',
      properties: { ssoToken: { type: 'string' }, ssoIssuer: { type: 'string' } },
      dependentSchemas: {
        ssoToken: {
          type: 'object',
          required: ['ssoIssuer'],
          properties: { ssoIssuer: { type: 'string' } },
        },
      },
      'x-dependentSchemas-message': 'ssoToken requires ssoIssuer',
    }),
    rejects: [{ ssoToken: 'tok' }],
    accepts: { ssoToken: 'tok', ssoIssuer: 'iss' },
    message: 'ssoToken requires ssoIssuer',
  },
  {
    key: 'anyOf',
    extension: 'x-anyOf-message',
    schema: prop({
      anyOf: [
        { type: 'string', minLength: 5 },
        { type: 'integer', minimum: 100 },
      ],
      'x-anyOf-message': 'must satisfy at least one variant',
    }),
    rejects: ['no'],
    accepts: 'longer',
    message: 'must satisfy at least one variant',
  },
  {
    key: 'oneOf',
    extension: 'x-oneOf-message',
    schema: prop({
      oneOf: [{ type: 'string' }, { type: 'integer' }],
      'x-oneOf-message': 'must be exactly one of string or integer',
    }),
    rejects: [true],
    accepts: 'ok',
    message: 'must be exactly one of string or integer',
  },
  {
    // Intersect dispatches the failing child's error before the combinator's own, so the status
    // is the contract here and the message is best-effort.
    key: 'allOf',
    extension: 'x-allOf-message',
    schema: prop({
      allOf: [
        { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
        { type: 'object', properties: { b: { type: 'string' } }, required: ['b'] },
      ],
      'x-allOf-message': 'must satisfy every fragment',
    }),
    rejects: [{ a: 'x' }],
    accepts: { a: 'x', b: 'y' },
  },
  {
    key: 'not',
    extension: 'x-not-message',
    schema: prop({ not: { type: 'string' }, 'x-not-message': 'must not be a string' }),
    rejects: ['a string'],
    accepts: 42,
    message: 'must not be a string',
  },
]

describe('vendor extension messages — generated app answers a real request', () => {
  const built = generateOnce(
    checkDocument(MESSAGE_CASES.map((c) => ({ key: c.key, schema: c.schema }))),
  )

  describe.each([...MESSAGE_CASES])('$extension', (testCase) => {
    it.each(
      testCase.rejects.map((rejected, index) => ({
        rejected,
        title: `${JSON.stringify(rejected)} with 422${index > 0 ? ' (second bound)' : ''}`,
      })),
    )('rejects $title', async ({ rejected }) => {
      const app = await (await built()).mount('check')
      const res = await app.handle(jsonRequest(`/check/${testCase.key}`, { value: rejected }))
      expect(res.status).toBe(422)
      // A case without a `message` pins only the status: its text is best-effort.
      expect(await res.text()).toStrictEqual(testCase.message ?? expect.any(String))
    })

    it(`accepts ${JSON.stringify(testCase.accepts)}`, async () => {
      const app = await (await built()).mount('check')
      const res = await app.handle(
        jsonRequest(`/check/${testCase.key}`, { value: testCase.accepts }),
      )
      expect(res.status).not.toBe(422)
    })

    it('keeps the keyword on the emitted schema (OpenAPI round-trip)', async () => {
      const source = await (await built()).schemasSource()
      expect(source).toContain(testCase.extension)
    })
  })
})

// ── Round-trip-only extensions ───────────────────────────────────────────────────────────────
//
// Elysia 1.4 cannot route a 422 to these three: `additionalProperties: false` strips the surplus
// key instead of rejecting it, `patternProperties` has no validator behind it, and the
// `required[]` error is raised by the parent object before the child branch is consulted. The
// keyword must still survive onto the emitted schema, so a consumer reading the generated
// contract sees it — and so this test starts failing the day Elysia does dispatch it.

describe('round-trip-only extensions', () => {
  const cases = [
    {
      key: 'additionalProperties',
      extension: 'x-additionalProperties-message',
      schema: prop({
        type: 'object',
        properties: { name: { type: 'string' } },
        additionalProperties: false,
        'x-additionalProperties-message': 'no extra fields',
      }),
      payloads: [{ name: 'a' }, { name: 'a', surplus: 'stripped' }],
    },
    {
      key: 'patternProperties',
      extension: 'x-patternProperties-message',
      schema: prop({
        type: 'object',
        additionalProperties: false,
        patternProperties: { '^x-': { type: 'string' } },
        'x-patternProperties-message': 'keys must start with x-',
      }),
      payloads: [{ 'x-foo': 'bar' }, { 'wrong-key': 'oops' }],
    },
  ] as const
  const built = generateOnce(checkDocument(cases.map((c) => ({ key: c.key, schema: c.schema }))))

  it.each([...cases])(
    '$extension does not reject, but survives on the schema',
    async (testCase) => {
      const generated = await built()
      const app = await generated.mount('check')
      for (const payload of testCase.payloads) {
        const res = await app.handle(jsonRequest(`/check/${testCase.key}`, { value: payload }))
        expect(res.status).not.toBe(422)
      }
      expect(await generated.schemasSource()).toContain(testCase.extension)
    },
  )

  it('x-required-message rejects the missing field, and survives on the schema', async () => {
    const document = {
      openapi: '3.1.0',
      info: { title: 'runtime', version: '1.0.0' },
      paths: {
        '/check/required': {
          post: {
            operationId: 'required',
            requestBody: {
              required: true,
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/requiredInput' } },
              },
            },
            responses: { '201': { description: 'OK' } },
          },
        },
      },
      components: {
        schemas: {
          requiredInput: {
            type: 'object',
            required: ['value'],
            properties: { value: { type: 'string' } },
            'x-required-message': 'value is required',
          },
        },
      },
    } as unknown as OpenAPI
    const generated = await generate(document)
    const app = await generated.mount('check')

    expect((await app.handle(jsonRequest('/check/required', {}))).status).toBe(422)
    expect((await app.handle(jsonRequest('/check/required', { value: 'ok' }))).status).not.toBe(422)
    expect(await generated.schemasSource()).toContain('x-required-message')
  })
})

// ── Message text survives code generation ────────────────────────────────────────────────────
//
// Messages are emitted into a TypeScript source file as string literals, so every one of these
// is a chance for the generator to produce something that does not parse, or that parses into a
// different string. A newline written raw would break the literal; a lone backslash or a
// backtick would change what the user is shown. The assertion is byte equality on the response.

describe('message text survives code generation', () => {
  const TEXTS = {
    japanese: '日本語: 値は 0 以上にしてください',
    chinese: '中文: 必须为正整数',
    emoji: '🚫 invalid email format ✉️',
    newlines: 'Line one\nLine two\tTabbed',
    quotes: 'Quotes: "double" and \'single\' and `back`',
    backslash: 'Backslash: a\\b\\c',
    unicode: 'Unicode: Aé中',
  } as const

  const cases = [
    {
      key: 'japanese',
      schema: prop({
        type: 'number',
        minimum: 0,
        'x-minimum-message': TEXTS.japanese,
      }),
      rejects: -1,
      text: TEXTS.japanese,
    },
    {
      key: 'chinese',
      schema: prop({
        type: 'number',
        maximum: 100,
        'x-maximum-message': TEXTS.chinese,
      }),
      rejects: 101,
      text: TEXTS.chinese,
    },
    {
      key: 'emoji',
      schema: prop({
        type: 'string',
        pattern: '^[a-z]+@[a-z]+\\.[a-z]+$',
        'x-pattern-message': TEXTS.emoji,
      }),
      rejects: 'nope',
      text: TEXTS.emoji,
    },
    {
      key: 'newlines',
      schema: prop({
        type: 'string',
        minLength: 5,
        'x-minLength-message': TEXTS.newlines,
      }),
      rejects: 'abc',
      text: TEXTS.newlines,
    },
    {
      key: 'quotes',
      schema: prop({
        type: 'string',
        maxLength: 5,
        'x-maxLength-message': TEXTS.quotes,
      }),
      rejects: 'abcdef',
      text: TEXTS.quotes,
    },
    {
      key: 'backslash',
      schema: prop({
        type: 'number',
        multipleOf: 2,
        'x-multipleOf-message': TEXTS.backslash,
      }),
      rejects: 3,
      text: TEXTS.backslash,
    },
    {
      key: 'unicode',
      schema: prop({
        type: 'string',
        enum: ['ok'],
        'x-enum-message': TEXTS.unicode,
      }),
      rejects: 'no',
      text: TEXTS.unicode,
    },
  ] as const
  const built = generateOnce(checkDocument(cases.map((c) => ({ key: c.key, schema: c.schema }))))

  it.each([...cases])('returns $key text byte for byte', async (testCase) => {
    const app = await (await built()).mount('check')
    const res = await app.handle(jsonRequest(`/check/${testCase.key}`, { value: testCase.rejects }))
    expect(res.status).toBe(422)
    expect(await res.text()).toBe(testCase.text)
  })
})

// ── Coercion ─────────────────────────────────────────────────────────────────────────────────
//
// Every validated context is a wire format: a query string, a path segment and a header only
// ever carry text, so `type: integer` on any of them relies on Elysia coercing before it
// validates. What the generator controls is the schema it hands Elysia, and one detail of it is
// asphodelos's own: `t.Integer()` is capped at `Number.MAX_SAFE_INTEGER`, because without it a
// wire value past 2^53-1 parses to a silently rounded number and validates clean.
//
// The generated handlers are empty by design, so these tests mount the generated *model* — the
// schema under test — behind echo handlers. That keeps the assertion on the emitted schema
// rather than on hand-edited handler code, and lets it check the delivered JavaScript type, not
// just the status.

const COERCE_DOCUMENT = {
  openapi: '3.1.0',
  info: { title: 'coerce', version: '1.0.0' },
  paths: {
    '/coerce/integer': {
      get: {
        operationId: 'coerceInteger',
        parameters: [{ name: 'value', in: 'query', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/coerce/number': {
      get: {
        operationId: 'coerceNumber',
        parameters: [{ name: 'value', in: 'query', required: true, schema: { type: 'number' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/coerce/boolean': {
      get: {
        operationId: 'coerceBoolean',
        parameters: [{ name: 'flag', in: 'query', required: true, schema: { type: 'boolean' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/coerce/array': {
      get: {
        operationId: 'coerceArray',
        parameters: [
          {
            name: 'tags',
            in: 'query',
            required: true,
            schema: { type: 'array', items: { type: 'string' } },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/coerce/array-int': {
      get: {
        operationId: 'coerceArrayInt',
        parameters: [
          {
            name: 'ids',
            in: 'query',
            required: true,
            schema: { type: 'array', items: { type: 'integer' } },
          },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/coerce/path/{id}': {
      get: {
        operationId: 'coercePath',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/coerce/header': {
      get: {
        operationId: 'coerceHeader',
        parameters: [
          { name: 'x-api-version', in: 'header', required: true, schema: { type: 'integer' } },
        ],
        responses: { '200': { description: 'ok' } },
      },
    },
    '/coerce/body': {
      post: {
        operationId: 'coerceBody',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['count'],
                properties: { count: { type: 'integer' } },
              },
            },
          },
        },
        responses: { '200': { description: 'ok' } },
      },
    },
    '/coerce/body-numeric': {
      post: {
        operationId: 'coerceBodyNumeric',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['count', 'flag'],
                properties: {
                  count: { type: 'integer', format: 'numeric' },
                  flag: { type: 'boolean', format: 'boolean-string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'ok' } },
      },
    },
  },
} as unknown as OpenAPI

const MAX_SAFE = 9_007_199_254_740_991

describe('coercion', () => {
  const built = generateOnce(COERCE_DOCUMENT)

  /** Mounts the generated schemas behind echo handlers so the delivered value is observable. */
  async function coerceApp() {
    const { dir } = await built()
    const { CoerceModel } = (await import(path.join(dir, 'src/modules/coerce/model.ts'))) as {
      CoerceModel: { readonly [k: string]: never }
    }
    const echo = (value: unknown) => ({ value, type: typeof value, isArray: Array.isArray(value) })
    const field = (value: unknown, key: string) => (value as Record<string, unknown>)[key]
    return new Elysia()
      .get('/coerce/integer', ({ query }) => echo(query.value), {
        query: CoerceModel.coerceIntegerQuery,
      })
      .get('/coerce/number', ({ query }) => echo(query.value), {
        query: CoerceModel.coerceNumberQuery,
      })
      .get('/coerce/boolean', ({ query }) => echo(query.flag), {
        query: CoerceModel.coerceBooleanQuery,
      })
      .get('/coerce/array', ({ query }) => echo(query.tags), {
        query: CoerceModel.coerceArrayQuery,
      })
      .get('/coerce/array-int', ({ query }) => echo(query.ids), {
        query: CoerceModel.coerceArrayIntQuery,
      })
      .get('/coerce/path/:id', ({ params }) => echo(params.id), {
        params: CoerceModel.coercePathParams,
      })
      .get('/coerce/header', ({ headers }) => echo(headers['x-api-version']), {
        headers: CoerceModel.coerceHeaderHeaders,
      })
      .post('/coerce/body', ({ body }) => echo(field(body, 'count')), {
        body: CoerceModel.coerceBodyBody,
      })
      .post(
        '/coerce/body-numeric',
        ({ body }) => echo([field(body, 'count'), field(body, 'flag')]),
        {
          body: CoerceModel.coerceBodyNumericBody,
        },
      )
  }

  const get = async (url: string, headers: Record<string, string> = {}) =>
    (await coerceApp()).handle(new Request(`http://localhost${url}`, { headers }))

  it('caps t.Integer() at MAX_SAFE_INTEGER so a past-2^53 wire value cannot round silently', async () => {
    // Without the cap this parses to 1000000000000000000 and validates clean.
    expect((await get('/coerce/integer?value=999999999999999999')).status).toBe(422)
    // The cap is inclusive: the boundary itself must still pass.
    const res = await get(`/coerce/integer?value=${MAX_SAFE}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ value: MAX_SAFE, type: 'number', isArray: false })
  })

  it('applies the same cap to headers', async () => {
    expect((await get('/coerce/header', { 'x-api-version': '999999999999999999' })).status).toBe(
      422,
    )
    expect((await get('/coerce/header', { 'x-api-version': String(MAX_SAFE) })).status).toBe(200)
  })

  it.each([
    ['value=42', 42],
    ['value=0', 0],
    ['value=-1', -1],
  ] as const)('query integer ?%s arrives as the JS number %p', async (query, expected) => {
    const res = await get(`/coerce/integer?${query}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ value: expected, type: 'number', isArray: false })
  })

  it.each(['value=1.5', 'value=abc', 'value='])('query integer ?%s is rejected', async (query) => {
    expect((await get(`/coerce/integer?${query}`)).status).toBe(422)
  })

  it('query number accepts a decimal and rejects a non-number', async () => {
    const res = await get('/coerce/number?value=1.5')
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ value: 1.5, type: 'number', isArray: false })
    expect((await get('/coerce/number?value=abc')).status).toBe(422)
  })

  it.each([
    ['true', true],
    ['false', false],
  ] as const)('query boolean ?flag=%s arrives as the JS boolean %p', async (flag, expected) => {
    const res = await get(`/coerce/boolean?flag=${flag}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ value: expected, type: 'boolean', isArray: false })
  })

  // Coercion is exact and case-sensitive: none of the usual shorthands are accepted, so a client
  // sending `1` or `on` gets a 422 rather than a silently wrong `false`.
  it.each(
    ['1', '0', 'yes', 'no', 'TRUE', 'False', 'on', 'off', ''].map((flag) => ({
      flag,
      title: flag || '(empty)',
    })),
  )('query boolean ?flag=$title is rejected', async ({ flag }) => {
    expect((await get(`/coerce/boolean?flag=${flag}`)).status).toBe(422)
  })

  it.each([
    ['tags=a,b,c', ['a', 'b', 'c']],
    ['tags=a&tags=b&tags=c', ['a', 'b', 'c']],
    ['tags=a,b&tags=c', ['a', 'b', 'c']],
    ['tags=a', ['a']],
    ['tags=', ['']],
  ] as const)('query array ?%s arrives as %j', async (query, expected) => {
    const res = await get(`/coerce/array?${query}`)
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ value: expected, type: 'object', isArray: true })
  })

  it('query array rejects the parameter being absent', async () => {
    expect((await get('/coerce/array')).status).toBe(422)
  })

  it('query array of integer arrives as JS numbers', async () => {
    const res = await get('/coerce/array-int?ids=1&ids=2&ids=3')
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ value: [1, 2, 3], type: 'object', isArray: true })
  })

  it('path integer coerces, and rejects a decimal', async () => {
    const res = await get('/coerce/path/42')
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ value: 42, type: 'number', isArray: false })
    expect((await get('/coerce/path/1.5')).status).toBe(422)
    expect((await get('/coerce/path/abc')).status).toBe(422)
  })

  it('header integer coerces, and rejects a decimal, a non-number and an absent header', async () => {
    const res = await get('/coerce/header', { 'x-api-version': '42' })
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ value: 42, type: 'number', isArray: false })
    expect((await get('/coerce/header', { 'x-api-version': '1.5' })).status).toBe(422)
    expect((await get('/coerce/header', { 'x-api-version': 'abc' })).status).toBe(422)
    expect((await get('/coerce/header')).status).toBe(422)
  })

  it('JSON body integer accepts both 42 and "42", and rejects a fraction or a word', async () => {
    const app = await coerceApp()
    const post = (body: unknown) => app.handle(jsonRequest('/coerce/body', body))

    for (const count of [42, '42']) {
      const res = await post({ count })
      expect(res.status).toBe(200)
      expect(await res.json()).toStrictEqual({ value: 42, type: 'number', isArray: false })
    }
    expect((await post({ count: 1.5 })).status).toBe(422)
    expect((await post({ count: 'abc' })).status).toBe(422)
  })

  it('format: numeric / boolean-string route to t.Numeric() and t.BooleanString()', async () => {
    const { dir } = await built()
    const source = await readFile(path.join(dir, 'src/modules/coerce/model.ts'), 'utf-8')
    expect(source).toContain('t.Numeric(')
    expect(source).toContain('t.BooleanString(')

    const app = await coerceApp()
    const res = await app.handle(jsonRequest('/coerce/body-numeric', { count: '42', flag: 'true' }))
    expect(res.status).toBe(200)
    expect(await res.json()).toStrictEqual({ value: [42, true], type: 'object', isArray: true })
  })
})

// ── Parameter wiring ─────────────────────────────────────────────────────────────────────────
//
// Header, cookie and query parameters each land in a different Elysia validator (`headers`,
// `cookie`, `query`). Grouping them onto the wrong one is a silent failure: the route keeps
// answering 200 and the constraint is simply never enforced. Each assertion below is one
// parameter violated in isolation, so a mis-grouped `in:` shows up as a missing 422.

describe('header / cookie / query parameter wiring', () => {
  const built = generateOnce({
    openapi: '3.1.0',
    info: { title: 'params', version: '1.0.0' },
    paths: {
      '/check': {
        get: {
          operationId: 'check',
          parameters: [
            {
              name: 'x-api-key',
              in: 'header',
              required: true,
              schema: { type: 'string', minLength: 8 },
            },
            {
              name: 'session_id',
              in: 'cookie',
              required: true,
              schema: { type: 'string', format: 'uuid' },
            },
            { name: 'tenant', in: 'query', required: true, schema: { type: 'string' } },
          ],
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  } as unknown as OpenAPI)

  const UUID = '00000000-0000-0000-0000-000000000000'
  const VALID = { 'x-api-key': 'long-enough-key', cookie: `session_id=${UUID}` }

  const check = async (headers: Record<string, string>, query = '?tenant=acme') => {
    const app = await (await built()).mount('check')
    return app.handle(new Request(`http://localhost/check${query}`, { headers }))
  }

  it('rejects a missing header parameter', async () => {
    expect((await check({ cookie: `session_id=${UUID}` })).status).toBe(422)
  })

  it('rejects a missing cookie parameter', async () => {
    expect((await check({ 'x-api-key': 'long-enough-key' })).status).toBe(422)
  })

  it('rejects a header that violates minLength', async () => {
    expect((await check({ ...VALID, 'x-api-key': 'short' })).status).toBe(422)
  })

  it('rejects a cookie that violates the uuid format', async () => {
    expect((await check({ ...VALID, cookie: 'session_id=not-a-uuid' })).status).toBe(422)
  })

  it('rejects a missing query parameter', async () => {
    expect((await check(VALID, '')).status).toBe(422)
  })

  it('accepts the request when all three are present and valid', async () => {
    expect((await check(VALID)).status).not.toBe(422)
  })
})

// ── Recursive component schemas ──────────────────────────────────────────────────────────────
//
// A `$ref` back into the schema being defined cannot be inlined, so the generator emits
// `t.Recursive` / `t.Ref` instead. Getting that wrong does not produce a compile error — it
// produces a schema that either blows the stack or silently accepts anything — so the check is
// that the emitted module compiles under TypeBox and still discriminates valid from invalid.

describe('recursive component schemas', () => {
  const recursive = (name: string, extra: Record<string, unknown>) =>
    ({
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string' }, ...extra },
    }) as unknown as Schema

  const built = generateOnce({
    openapi: '3.1.0',
    info: { title: 'recursive', version: '1.0.0' },
    paths: {
      '/trees': {
        get: {
          operationId: 'listTrees',
          responses: {
            '200': {
              description: 'ok',
              content: {
                'application/json': { schema: { $ref: '#/components/schemas/TreeNode' } },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        // Self-recursive through an array.
        TreeNode: recursive('TreeNode', {
          children: { type: 'array', items: { $ref: '#/components/schemas/TreeNode' } },
        }),
        // Mutually recursive: Author → Book → Author.
        Author: recursive('Author', {
          name: { type: 'string' },
          books: { type: 'array', items: { $ref: '#/components/schemas/Book' } },
        }),
        Book: {
          type: 'object',
          required: ['isbn'],
          properties: {
            isbn: { type: 'string' },
            author: { $ref: '#/components/schemas/Author' },
          },
        },
      },
    },
  } as unknown as OpenAPI)

  async function compiled() {
    const { dir } = await built()
    const { TypeCompiler } = await import('@sinclair/typebox/compiler')
    const mod = (await import(path.join(dir, 'src/components/schemas.ts'))) as {
      readonly [k: string]: TSchema
    }
    return (name: string, value: unknown) => {
      const schema = mod[name]
      if (!schema) throw new Error(`generated module exports no ${name}`)
      return TypeCompiler.Compile(schema).Check(value)
    }
  }

  it('validates a nested tree, and rejects one with a malformed child', async () => {
    const check = await compiled()
    expect(
      check('TreeNodeSchema', {
        id: 'root',
        children: [
          { id: 'a', children: [{ id: 'a1' }] },
          { id: 'b', children: [] },
        ],
      }),
    ).toBe(true)
    expect(check('TreeNodeSchema', { id: 'root', children: [{ id: 42 }] })).toBe(false)
  })

  it('validates both directions of a mutual reference', async () => {
    const check = await compiled()
    expect(check('AuthorSchema', { id: 'u1', name: 'A', books: [{ isbn: '978' }] })).toBe(true)
    expect(check('BookSchema', { isbn: '978', author: { id: 'u1', name: 'A' } })).toBe(true)
    expect(check('BookSchema', { isbn: '978', author: { name: 'no id' } })).toBe(false)
  })
})

// ── Vendor messages on parameters ────────────────────────────────────────────────────────────
//
// The body cases above go through `components/schemas.ts`; a parameter takes a different route
// through the generator, ending up on the per-operation model rather than a component. The
// custom message has to survive that path too, and it has to survive Elysia's coercion step,
// which runs before validation on every parameter context.
//
// Absent-but-required is deliberately excluded from the message assertions: the error is raised
// by the enclosing object before the parameter's own branch is reached, so the status is the
// contract there, not the text.

describe('vendor messages on parameters', () => {
  type ParamCase = {
    readonly key: string
    readonly location: 'query' | 'path' | 'header' | 'cookie'
    readonly name: string
    readonly schema: Schema
    readonly message: string
    /** Request that violates the constraint. */
    readonly violate: (base: string) => Request
  }

  const url = (p: string) => `http://localhost${p}`

  const CASES: readonly ParamCase[] = [
    {
      key: 'query-min-length',
      location: 'query',
      name: 'value',
      schema: {
        type: 'string',
        minLength: 3,
        'x-minLength-message': 'value must be at least 3 chars',
      },
      message: 'value must be at least 3 chars',
      violate: (base) => new Request(url(`${base}?value=ab`)),
    },
    {
      key: 'query-pattern',
      location: 'query',
      name: 'slug',
      schema: {
        type: 'string',
        pattern: '^[a-z]+$',
        'x-pattern-message': 'slug must match ^[a-z]+$',
      },
      message: 'slug must match ^[a-z]+$',
      violate: (base) => new Request(url(`${base}?slug=ABC`)),
    },
    {
      key: 'query-minimum',
      location: 'query',
      name: 'count',
      schema: {
        type: 'number',
        minimum: 10,
        'x-minimum-message': 'count must be >= 10',
      },
      message: 'count must be >= 10',
      violate: (base) => new Request(url(`${base}?count=1`)),
    },
    {
      key: 'query-enum',
      location: 'query',
      name: 'status',
      schema: {
        type: 'string',
        enum: ['open', 'closed'],
        'x-enum-message': 'status must be open or closed',
      },
      message: 'status must be open or closed',
      violate: (base) => new Request(url(`${base}?status=archived`)),
    },
    {
      // Coercion runs first here: a non-numeric segment never becomes a number, so the failure
      // surfaces on the schema constructor and `x-error-message` is what the client sees.
      key: 'path-error',
      location: 'path',
      name: 'count',
      schema: { type: 'integer', 'x-error-message': 'count must be an integer' },
      message: 'count must be an integer',
      violate: (base) => new Request(url(`${base}/not-a-number`)),
    },
    {
      key: 'header-pattern',
      location: 'header',
      name: 'x-request-id',
      schema: {
        type: 'string',
        pattern: '^[0-9a-f-]{36}$',
        'x-pattern-message': 'x-request-id must be a uuid',
      },
      message: 'x-request-id must be a uuid',
      violate: (base) => new Request(url(base), { headers: { 'x-request-id': 'nope' } }),
    },
    {
      key: 'cookie-pattern',
      location: 'cookie',
      name: 'session_id',
      schema: {
        type: 'string',
        pattern: '^sess_[a-z0-9]+$',
        'x-pattern-message': 'session_id must look like sess_<id>',
      },
      message: 'session_id must look like sess_<id>',
      violate: (base) => new Request(url(base), { headers: { cookie: 'session_id=bogus' } }),
    },
  ]

  const basePath = (c: ParamCase) =>
    c.location === 'path' ? `/params/${c.key}/{${c.name}}` : `/params/${c.key}`

  const built = generateOnce({
    openapi: '3.1.0',
    info: { title: 'params', version: '1.0.0' },
    paths: Object.fromEntries(
      CASES.map((c) => [
        basePath(c),
        {
          get: {
            operationId: c.key.replaceAll('-', ''),
            parameters: [{ name: c.name, in: c.location, required: true, schema: c.schema }],
            responses: { '200': { description: 'OK' } },
          },
        },
      ]),
    ),
  })

  it.each([...CASES])('$location: returns the message verbatim', async (testCase) => {
    const app = await (await built()).mount('params')
    const res = await app.handle(testCase.violate(`/params/${testCase.key}`))
    expect(res.status).toBe(422)
    expect(await res.text()).toBe(testCase.message)
  })

  it('a required parameter that is absent still 422s', async () => {
    const app = await (await built()).mount('params')
    expect((await app.handle(new Request(url('/params/query-min-length')))).status).toBe(422)
    expect((await app.handle(new Request(url('/params/header-pattern')))).status).toBe(422)
  })
})

// ── Behavior extensions ─────────────────────────────────────────────────────────────────────
//
// `x-trim` / `x-toLowerCase` / `x-normalize` compile to a `t.Transform(...).Decode(...)` around
// the base schema, and `x-brand` / `x-readonly` wrap it in `t.Unsafe` / `t.Readonly`. The order
// TypeBox applies them in is the whole contract, and it is the opposite of what the name
// "pre-validation transform" suggests: the *untransformed* value is validated against the inner
// schema, and only a value that already passed is then decoded.
//
// That distinction is invisible in the emitted string and decides whether a request is accepted,
// so it is pinned here on real requests rather than inferred.

describe('behavior extensions', () => {
  const cases = [
    { key: 'trim', schema: prop({ type: 'string', minLength: 3, 'x-trim': true }) },
    {
      key: 'lower',
      schema: prop({ type: 'string', pattern: '^[a-z]+$', 'x-toLowerCase': true }),
    },
    { key: 'brand', schema: prop({ type: 'string', minLength: 3, 'x-brand': 'Code' }) },
    { key: 'readonly', schema: prop({ type: 'string', minLength: 3, 'x-readonly': true }) },
  ] as const
  const built = generateOnce(checkDocument(cases.map((c) => ({ key: c.key, schema: c.schema }))))

  const post = async (key: string, value: unknown) => {
    const app = await (await built()).mount('check')
    return app.handle(jsonRequest(`/check/${key}`, { value }))
  }

  it('x-trim validates before it trims, so padding counts toward minLength', async () => {
    // `'  ab  '` is six characters at validation time and only becomes `'ab'` afterwards. A
    // reading of the extension as "normalize, then validate" would make this a 422.
    expect((await post('trim', '  ab  ')).status).toBe(200)
    expect((await post('trim', '  abc  ')).status).toBe(200)
    expect((await post('trim', 'ab')).status).toBe(422)
  })

  it('x-toLowerCase validates before it lower-cases, so an uppercase value fails a lowercase pattern', async () => {
    expect((await post('lower', 'ABC')).status).toBe(422)
    expect((await post('lower', 'abc')).status).toBe(200)
  })

  it('x-brand keeps the base constraints behind t.Unsafe', async () => {
    const generated = await built()
    expect(await generated.schemasSource()).toContain('t.Unsafe<string & { readonly __brand:')
    expect((await post('brand', 'ab')).status).toBe(422)
    expect((await post('brand', 'abc')).status).toBe(200)
  })

  it('x-readonly keeps the base constraints behind t.Readonly', async () => {
    const generated = await built()
    expect(await generated.schemasSource()).toContain('t.Readonly(')
    expect((await post('readonly', 'ab')).status).toBe(422)
    expect((await post('readonly', 'abc')).status).toBe(200)
  })
})
