import { describe, expect, it } from 'bun:test'

import { Effect } from 'effect'

import { defineConfig, parseConfig } from './index.js'

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
    expect(result.message).toBe('Invalid config: input: must be .yaml | .json | .tsp')
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

  it('rejects a prefix without its leading slash', () => {
    expect(decodeError({ input: 'a.yaml', prefix: 'api' }).message).toBe(
      "Invalid config: prefix: must start with '/' and contain no whitespace or quotes",
    )
  })

  it('accepts port, and rejects one that is not a number', () => {
    expect(decode({ input: 'a.yaml', port: '4000' }).port).toBe('4000')
    expect(decodeError({ input: 'a.yaml', port: 'eighty' }).message).toBe(
      'Invalid config: port: must be a port number',
    )
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

  it('rejects a split component target that names a .ts file', () => {
    expect(
      decodeError({
        input: 'a.yaml',
        components: { schemas: { output: 'src/schemas.ts', split: true } },
      }).message,
    ).toBe('Invalid config: components.schemas.output: split mode requires directory, not .ts file')
  })

  it('normalizes a single-file component target that names a directory to its index.ts', () => {
    const result = decode({ input: 'a.yaml', components: { schemas: { output: 'src/schemas' } } })
    expect(result.components?.schemas?.output).toBe('src/schemas/index.ts')
  })

  it('defaults the hook client name to "client" when omitted', () => {
    const result = decode({ input: 'a.yaml', swr: { output: 'src/swr.ts', import: './lib' } })
    expect(result.swr?.client).toBe('client')
  })

  it('normalizes a hooks output that names a directory to its index.ts', () => {
    const result = decode({ input: 'a.yaml', swr: { output: 'src/swr', import: './lib' } })
    expect(result.swr?.output).toBe('src/swr/index.ts')
  })

  // The hooks are always one file now; a config from before says so in its own words.
  it('rejects split on a hooks block, naming what replaced it', () => {
    expect(
      decodeError({
        input: 'a.yaml',
        'tanstack-query': { output: 'src/query', import: './lib', split: true },
      }).message,
    ).toBe(
      'Invalid config: tanstack-query.split: split was removed: the hooks are always generated into a single file. Set output to a .ts file path and delete the directory the previous run wrote.',
    )
  })

  it('rejects a hooks import with whitespace or quotes', () => {
    expect(
      decodeError({ input: 'a.yaml', swr: { output: 'src/swr.ts', import: "'./lib'" } }).message,
    ).toBe('Invalid config: swr.import: must be a module specifier, with no whitespace or quotes')
  })

  it('rejects a hooks client that is not an identifier', () => {
    expect(
      decodeError({
        input: 'a.yaml',
        swr: { output: 'src/swr.ts', import: './lib', client: 'api-client' },
      }).message,
    ).toBe('Invalid config: swr.client: must be a JavaScript identifier')
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

  // The test generator is gone; a config that still asks for it is told so, not silently ignored.
  it('rejects the test block, naming what happened to it', () => {
    expect(decodeError({ input: 'a.yaml', test: { output: 'src/app.test.ts' } }).message).toBe(
      'Invalid config: test: test was removed: asphodelos no longer generates tests. Delete the block and the files the previous run wrote.',
    )
    expect(decodeError({ input: 'a.yaml', test: { split: true } })._tag).toBe('ConfigError')
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

  it('rejects a mock delay range whose min is above its max', () => {
    expect(
      decodeError({ input: 'a.yaml', mock: { output: 'm.ts', delay: { min: 5, max: 1 } } }).message,
    ).toBe('Invalid config: mock.delay: delay.min must be <= delay.max')
  })
})

/**
 * `defineConfig` checks the literal while it is typed. The run-time check is `parseConfig`
 * above; these pin that the type-level one agrees with it, through `@ts-expect-error` on the
 * configs it has to refuse and plain calls on the ones it has to take.
 */
describe('defineConfig', () => {
  it('returns the config object as-is', () => {
    const config = { input: 'openapi.yaml' as const, output: 'src/index.ts' as const }
    expect(defineConfig(config)).toBe(config)
  })

  // Every generator together, as the documentation lists them, compiles.
  it('accepts every generator', () => {
    const config = defineConfig({
      input: 'openapi.yaml',
      output: 'src/index.ts',
      prefix: '/api',
      port: '3000',
      integration: false,
      pathAlias: true,
      readonly: true,
      components: {
        schemas: { output: 'src/components/schemas', split: true, exportTypes: true },
        responses: { output: 'src/components/responses.ts' },
      },
      eden: { output: 'src/eden.ts', import: './lib', client: 'client', docs: true },
      types: { output: 'src/types.ts' },
      mock: { output: 'src/mock.ts', seed: 42, delay: { min: 100, max: 800 } },
      swr: { output: 'src/swr.ts', import: '../lib' },
      'tanstack-query': { output: 'src/tanstack-query.ts', import: '../lib', client: 'api' },
    })
    expect(config.eden.client).toBe('client')
  })

  // A value that is not a literal is left to the check made when the config is read.
  it('accepts values that are not literals', () => {
    const output = ['src', 'schemas'].join('/')
    const prefix = ['', 'api'].join('/')
    const config = defineConfig({
      input: 'openapi.yaml',
      prefix,
      components: { schemas: { output, split: true } },
    })
    expect(config.components.schemas.output).toBe('src/schemas')
  })

  it('is a type error to misspell an option', () => {
    const config = defineConfig({
      input: 'openapi.yaml',
      // cspell:ignore outpt
      // @ts-expect-error -- `outpt` is not an option
      outpt: 'src/index.ts',
    })
    expect(config.input).toBe('openapi.yaml')
  })

  it('is a type error to split a component target into a .ts file', () => {
    const config = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- split mode requires a directory
      components: { schemas: { output: 'src/schemas.ts', split: true } },
    })
    expect(config.input).toBe('openapi.yaml')
  })

  // Both sides of a collision are reported, each naming the other.
  it('is a type error to point two generators at one output', () => {
    const config = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- `src/api.ts` is also the output of eden
      types: { output: 'src/api.ts' },
      // @ts-expect-error -- `src/api.ts` is also the output of types
      eden: { output: 'src/api.ts', import: './lib' },
    })
    expect(config.input).toBe('openapi.yaml')
  })

  it('is a type error to leave the slash off the prefix', () => {
    const config = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- must start with '/'
      prefix: 'api',
    })
    expect(config.input).toBe('openapi.yaml')
  })

  it('is a type error to ask for the removed test generator', () => {
    const config = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- asphodelos no longer generates tests
      test: { output: 'src/app.test.ts' },
    })
    expect(config.input).toBe('openapi.yaml')
  })

  it('is a type error to split a hooks block', () => {
    const config = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- the hooks are always one file
      swr: { output: 'src/swr', import: './lib', split: true },
    })
    expect(config.input).toBe('openapi.yaml')
  })
})
