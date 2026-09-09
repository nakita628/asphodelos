import { describe, expect, it } from 'bun:test'

import { string } from './string.js'

describe('string', () => {
  it('emits bare t.String() for plain string', () => {
    expect(string({ type: 'string' })).toBe('t.String()')
  })

  it('emits format option', () => {
    expect(string({ type: 'string', format: 'uuid' })).toBe('t.String({format:"uuid"})')
  })

  it('emits length constraints', () => {
    expect(string({ type: 'string', minLength: 1, maxLength: 120 })).toBe(
      't.String({minLength:1,maxLength:120})',
    )
  })

  it('emits pattern with proper escaping', () => {
    expect(string({ type: 'string', pattern: '^[a-z]+$' })).toBe('t.String({pattern:"^[a-z]+$"})')
  })

  it('preserves default value inside type options (not wrapped in Optional)', () => {
    expect(string({ type: 'string', default: 'hello' })).toBe('t.String({default:"hello"})')
  })

  it('combines multiple options in Schema-type-defined order (format → minLength → maxLength → commonOpts)', () => {
    expect(
      string({
        type: 'string',
        minLength: 1,
        maxLength: 10,
        format: 'email',
        description: 'user email',
      }),
    ).toBe('t.String({format:"email",minLength:1,maxLength:10,description:"user email"})')
  })

  it('emits t.Date() for format: date', () => {
    expect(string({ type: 'string', format: 'date' })).toBe('t.Date()')
  })

  it('emits t.Date() for format: date-time', () => {
    expect(string({ type: 'string', format: 'date-time' })).toBe('t.Date()')
  })

  it('emits t.Date() with description (commonOpts)', () => {
    expect(string({ type: 'string', format: 'date-time', description: 'created at' })).toBe(
      't.Date({description:"created at"})',
    )
  })

  it('emits t.File() for format: binary (no media-type hint → default file fallback)', () => {
    expect(string({ type: 'string', format: 'binary' })).toBe('t.File()')
  })

  it('emits t.File() with size constraints mapped from minLength/maxLength', () => {
    expect(string({ type: 'string', format: 'binary', minLength: 1, maxLength: 1024 })).toBe(
      't.File({minSize:1,maxSize:1024})',
    )
  })

  it('emits t.File({type:...}) when contentMediaType is set', () => {
    // JSON Schema 2020-12 `contentMediaType` declares the MIME of a binary
    // payload — propagated into Elysia's File `type` option for upload-time
    // MIME enforcement.
    expect(
      string({
        type: 'string',
        format: 'binary',
        contentMediaType: 'image/png',
      }),
    ).toBe('t.File({type:"image/png"})')
  })

  it('emits t.File({type:...}) when called with multipart/form-data ctx', () => {
    expect(
      string(
        {
          type: 'string',
          format: 'binary',
          contentMediaType: 'image/jpeg',
        },
        { mediaType: 'multipart/form-data' },
      ),
    ).toBe('t.File({type:"image/jpeg"})')
  })

  it('emits t.Uint8Array() when called with application/octet-stream ctx', () => {
    // `format: binary` inside an `application/octet-stream` body is raw
    // bytes, not a file upload — Elysia's `t.Uint8Array()` factory.
    expect(
      string(
        {
          type: 'string',
          format: 'binary',
        },
        { mediaType: 'application/octet-stream' },
      ),
    ).toBe('t.Uint8Array()')
  })

  it('emits t.Uint8Array() with byte-length constraints mapped from minLength/maxLength', () => {
    expect(
      string(
        {
          type: 'string',
          format: 'binary',
          minLength: 1,
          maxLength: 4096,
        },
        { mediaType: 'application/octet-stream' },
      ),
    ).toBe('t.Uint8Array({minByteLength:1,maxByteLength:4096})')
  })

  it('emits plain string `error:` from x-error-message alone', () => {
    expect(string({ type: 'string', 'x-error-message': 'invalid' })).toBe(
      't.String({error:"invalid","x-error-message":"invalid"})',
    )
  })

  it('emits per-constraint error callback when x-pattern-message + pattern coexist', () => {
    expect(
      string({
        type: 'string',
        pattern: '^[a-z]+$',
        'x-error-message': 'invalid',
        'x-pattern-message': 'letters only',
      }),
    ).toBe(
      't.String({pattern:"^[a-z]+$",error:(error)=>{const type=error?.errors?.[0]?.type;if(type===48||type===53)return "letters only";return "invalid"},"x-error-message":"invalid","x-pattern-message":"letters only"})',
    )
  })
})
