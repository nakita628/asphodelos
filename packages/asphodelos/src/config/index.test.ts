import { describe, expect, it } from 'bun:test'

import { Effect } from 'effect'

import { parseConfig } from './index.js'

/** The decoded config, or a throw carrying the schema's message. */
const decode = (config: unknown) => Effect.runSync(parseConfig(config))

/** The `ConfigError` a rejected config fails with. */
const decodeError = (config: unknown) => Effect.runSync(Effect.flip(parseConfig(config)))

describe('parseConfig', () => {
  it('accepts the minimum valid config', () => {
    const result = decode({ input: 'openapi.yaml' })
    expect(result.input).toBe('openapi.yaml')
  })

  it('rejects an empty object (input is required)', () => {
    expect(decodeError({})._tag).toBe('ConfigError')
  })

  it('rejects when input lacks a recognized extension', () => {
    const result = decodeError({ input: 'openapi.txt' })
    expect(result._tag).toBe('ConfigError')
    expect(result.message.includes('.yaml')).toBe(true)
  })

  it('accepts .json input', () => {
    expect(() => decode({ input: 'openapi.json' })).not.toThrow()
  })

  it('accepts .tsp input', () => {
    expect(() => decode({ input: 'main.tsp' })).not.toThrow()
  })

  it('accepts integration: true + prefix', () => {
    decode({ input: 'a.yaml', prefix: '/api', integration: true })
  })

  it('accepts port', () => {
    decode({ input: 'a.yaml', port: '4000' })
  })

  it('strips the retired top-level export flags without erroring', () => {
    const result = decode({
      input: 'a.yaml',
      exportSchemas: true,
      exportMediaTypesTypes: true,
    })
    expect('exportSchemas' in result).toBe(false)
    expect('exportMediaTypesTypes' in result).toBe(false)
  })

  it('defaults component exportTypes to false and keeps an explicit value', () => {
    const result = decode({
      input: 'a.yaml',
      components: {
        schemas: { output: 'src/components/schemas.ts' },
        parameters: { output: 'src/components/parameters.ts', exportTypes: true },
      },
    })
    expect(result.components?.schemas?.exportTypes).toBe(false)
    expect(result.components?.parameters?.exportTypes).toBe(true)
  })

  it('accepts a single components.output (aggregate mode)', () => {
    const result = decode({ input: 'a.yaml', components: { output: 'src/components.ts' } })
    expect(result.components?.output).toBe('src/components.ts')
  })

  it('rejects components.output combined with per-type outputs', () => {
    const result = decodeError({
      input: 'a.yaml',
      components: {
        output: 'src/components.ts',
        schemas: { output: 'src/components/schemas.ts' },
        parameters: { output: 'src/components/parameters.ts' },
      },
    })
    expect(result._tag).toBe('ConfigError')
    expect(result.message).toBe(
      "Invalid config: components: output cannot be combined with per-type component outputs. Use either a single 'output' or per-type configs.",
    )
  })

  it('rejects components.output combined with a single per-type output', () => {
    const result = decodeError({
      input: 'a.yaml',
      components: { output: 'src/components.ts', links: { output: 'src/components/links.ts' } },
    })
    expect(result._tag).toBe('ConfigError')
    expect(result.message).toBe(
      "Invalid config: components: output cannot be combined with per-type component outputs. Use either a single 'output' or per-type configs.",
    )
  })

  it('defaults the hook client name to "client" when omitted', () => {
    const result = decode({ input: 'a.yaml', swr: { output: 'src/swr.ts', import: './lib' } })
    expect(result.swr?.client).toBe('client')
  })

  it('defaults the eden client name to "client" and keeps an explicit value', () => {
    const omitted = decode({
      input: 'a.yaml',
      eden: { output: 'src/eden.ts', import: './lib' },
    })
    expect(omitted.eden?.client).toBe('client')
    const explicit = decode({
      input: 'a.yaml',
      eden: { output: 'src/eden.ts', import: './lib', client: 'api' },
    })
    expect(explicit.eden?.client).toBe('api')
  })

  it('rejects eden config without a required import', () => {
    expect(decodeError({ input: 'a.yaml', eden: { output: 'src/eden.ts' } })._tag).toBe(
      'ConfigError',
    )
  })

  it('defaults test.split to false and requires output as a single .ts file', () => {
    const result = decode({ input: 'a.yaml', test: { output: 'src/app.test.ts' } })
    const test = result.test
    expect(test?.split).toBe(false)
    if (test?.split === false) {
      expect(test.output).toBe('src/app.test.ts')
    }
  })

  it('rejects single-file test config without an output', () => {
    expect(decodeError({ input: 'a.yaml', test: {} })._tag).toBe('ConfigError')
  })

  it('accepts test split mode with no output (co-located) and an optional pathAlias', () => {
    const result = decode({ input: 'a.yaml', test: { split: true, pathAlias: '@/' } })
    expect(result.test?.split).toBe(true)
    expect(result.test?.pathAlias).toBe('@/')
  })

  it('accepts test split mode without a pathAlias', () => {
    const result = decode({ input: 'a.yaml', test: { split: true } })
    expect(result.test?.split).toBe(true)
  })

  it('accepts a mock output and normalizes a non-.ts path to <dir>/index.ts', () => {
    const result = decode({ input: 'a.yaml', mock: { output: 'src/mock.ts' } })
    expect(result.mock?.output).toBe('src/mock.ts')
    const dir = decode({ input: 'a.yaml', mock: { output: 'src/mocks' } })
    expect(dir.mock?.output).toBe('src/mocks/index.ts')
  })

  it("accepts useExamples: 'all' and rejects any other string", () => {
    const result = decode({ input: 'a.yaml', mock: { output: 'm.ts', useExamples: 'all' } })
    expect(result.mock?.useExamples).toBe('all')
    expect(
      decodeError({ input: 'a.yaml', mock: { output: 'm.ts', useExamples: 'some' } }),
    ).toBeDefined()
  })

  it('accepts a numeric or array seed', () => {
    expect(decode({ input: 'a.yaml', mock: { output: 'm.ts', seed: 42 } }).mock?.seed).toBe(42)
    expect(
      decode({ input: 'a.yaml', mock: { output: 'm.ts', seed: [1, 2] } }).mock?.seed,
    ).toStrictEqual([1, 2])
  })

  it.each([[-1], [1.5], [4_294_967_296], [[]], ['42']])('rejects the seed %j', (seed) => {
    expect(decodeError({ input: 'a.yaml', mock: { output: 'm.ts', seed } })).toBeDefined()
  })
})
