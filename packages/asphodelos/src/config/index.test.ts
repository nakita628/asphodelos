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

  // A config file is written by hand; a key the schema does not know is a typo, and a typo that
  // is dropped is a generator that silently does not run.
  it('rejects an unknown key, at the top and inside a block', () => {
    // cspell:ignore outpt
    expect(decodeError({ input: 'a.yaml', outpt: 'src/index.ts' }).message).toBe(
      'Invalid config: outpt: Expected no excess property',
    )
    expect(
      decodeError({
        input: 'a.yaml',
        client: { output: 'src/client.ts' },
        swr: { output: 'src/swr.ts', imports: './lib' },
      }).message,
    ).toBe('Invalid config: swr.imports: Expected no excess property')
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

  // The retired top-level export flags are unknown keys like any other now: a config that still
  // carries one is told, rather than left to wonder why `exportTypes` is off.
  it('rejects the retired top-level export flags', () => {
    expect(decodeError({ input: 'a.yaml', exportSchemas: true }).message).toBe(
      'Invalid config: exportSchemas: Expected no excess property',
    )
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

  // The hooks import the generated client, exported as `client`; the options that pointed at
  // another client are gone, and a config from before is told what replaced them.
  it('rejects a hooks import or client name, naming what replaced them', () => {
    expect(
      decodeError({
        input: 'a.yaml',
        client: { output: 'src/client.ts' },
        swr: { output: 'src/swr.ts', import: './lib' },
      }).message,
    ).toBe(
      'Invalid config: swr.import: import was removed: the file imports the client the top-level `client` block generates — relatively, through `pathAlias`, or by `client.package` from another package. Delete the import and add client: { output }.',
    )
    expect(
      decodeError({
        input: 'a.yaml',
        client: { output: 'src/client.ts' },
        swr: { output: 'src/swr.ts', client: 'api' },
      }).message,
    ).toBe(
      'Invalid config: swr.client: client was removed: the generated client is exported as `client`. Delete the name.',
    )
    expect(
      decodeError({
        input: 'a.yaml',
        client: { output: 'src/client.ts' },
        eden: { output: 'src/eden.ts', import: './lib' },
      }).message,
    ).toBe(
      'Invalid config: eden.import: import was removed: the file imports the client the top-level `client` block generates — relatively, through `pathAlias`, or by `client.package` from another package. Delete the import and add client: { output }.',
    )
  })

  it('normalizes a hooks output that names a directory to its index.ts', () => {
    const result = decode({
      input: 'a.yaml',
      client: { output: 'src/client.ts' },
      swr: { output: 'src/swr' },
    })
    expect(result.swr?.output).toBe('src/swr/index.ts')
  })

  // The hooks are always one file now; a config from before says so in its own words.
  it('rejects split on a hooks block, naming what replaced it', () => {
    expect(
      decodeError({
        input: 'a.yaml',
        client: { output: 'src/client.ts' },
        'tanstack-query': { output: 'src/query', split: true },
      }).message,
    ).toBe(
      'Invalid config: tanstack-query.split: split was removed: the hooks are always generated into a single file. Set output to a .ts file path and delete the directory the previous run wrote.',
    )
  })

  // The wrappers and the hooks import the generated client, so the block that generates it has
  // to be there.
  it('rejects eden without the top-level client', () => {
    const error = decodeError({ input: 'a.yaml', eden: { output: 'src/eden.ts' } })
    expect(error._tag).toBe('ConfigError')
    expect(error.message).toBe(
      'Invalid config: eden needs the top-level client it imports: add client: { output }.',
    )
  })

  it('rejects a hooks block without the top-level client', () => {
    const error = decodeError({ input: 'a.yaml', swr: { output: 'src/swr.ts' } })
    expect(error.message).toBe(
      'Invalid config: swr needs the top-level client it imports: add client: { output }.',
    )
  })

  describe('components package', () => {
    it('takes the name a kind, or the single file, is imported by from other packages', () => {
      const perKind = decode({
        input: 'a.yaml',
        components: {
          schemas: { output: '../schemas/src/schemas.ts', package: '@packages/schemas' },
        },
      })
      expect(perKind.components?.schemas?.package).toBe('@packages/schemas')
      const single = decode({
        input: 'a.yaml',
        components: { output: '../schemas/src/index.ts', package: '@packages/schemas' },
      })
      expect(single.components?.package).toBe('@packages/schemas')
    })

    it('rejects a package on the components block without a single-file output', () => {
      expect(
        decodeError({
          input: 'a.yaml',
          components: { package: '@packages/schemas', schemas: { output: 'src/schemas.ts' } },
        }).message,
      ).toBe(
        'Invalid config: components: package names the single-file output: set output, or name the package on each section.',
      )
    })
  })

  describe('pathAlias', () => {
    it('is an import prefix, and rejects one with quotes or spaces', () => {
      expect(decode({ input: 'a.yaml', pathAlias: '@/' }).pathAlias).toBe('@/')
      expect(decode({ input: 'a.yaml', pathAlias: '~' }).pathAlias).toBe('~')
      expect(decodeError({ input: 'a.yaml', pathAlias: '@ /' }).message).toBe(
        'Invalid config: pathAlias: must be an import prefix, with no whitespace or quotes',
      )
      expect(decodeError({ input: 'a.yaml', pathAlias: true })._tag).toBe('ConfigError')
    })
  })

  describe('client', () => {
    it('takes an output alone: no base URL, same origin off', () => {
      const config = decode({ input: 'a.yaml', client: { output: 'src/client.ts' } })
      expect(config.client).toStrictEqual({ output: 'src/client.ts', sameOrigin: false })
    })

    it('rejects an output that is not a .ts file', () => {
      expect(decodeError({ input: 'a.yaml', client: { output: 'src/client' } }).message).toBe(
        'Invalid config: client.output: must be .ts file',
      )
    })

    it('takes a URL as the base URL and rejects one with quotes', () => {
      const config = decode({
        input: 'a.yaml',
        client: { output: 'src/client.ts', baseUrl: 'https://api.example.com', sameOrigin: true },
      })
      expect(config.client?.baseUrl).toBe('https://api.example.com')
      expect(config.client?.sameOrigin).toBe(true)
      expect(
        decodeError({ input: 'a.yaml', client: { output: 'src/client.ts', baseUrl: "'x'" } })._tag,
      ).toBe('ConfigError')
    })

    it('takes an environment variable, read from import.meta.env unless told otherwise', () => {
      const vite = decode({
        input: 'a.yaml',
        client: { output: 'src/client.ts', baseUrl: { env: 'VITE_API_URL' } },
      })
      expect(vite.client?.baseUrl).toStrictEqual({ env: 'VITE_API_URL', source: 'import.meta.env' })
      const node = decode({
        input: 'a.yaml',
        client: { output: 'src/client.ts', baseUrl: { env: 'API_URL', source: 'process.env' } },
      })
      expect(node.client?.baseUrl).toStrictEqual({ env: 'API_URL', source: 'process.env' })
      expect(
        decodeError({
          input: 'a.yaml',
          client: { output: 'src/client.ts', baseUrl: { env: 'not a name' } },
        })._tag,
      ).toBe('ConfigError')
    })

    it('takes an imported environment, exported as `env` unless named', () => {
      const config = decode({
        input: 'a.yaml',
        client: { output: 'src/client.ts', baseUrl: { env: 'API_URL', import: '@/env' } },
      })
      expect(config.client?.baseUrl).toStrictEqual({ env: 'API_URL', import: '@/env', name: 'env' })
    })

    it('takes the name the client is imported by, and the app its package name', () => {
      const config = decode({
        input: 'a.yaml',
        package: '@packages/elysia',
        client: { output: '../client/src/client.ts', package: '@packages/client' },
      })
      expect(config.package).toBe('@packages/elysia')
      expect(config.client?.package).toBe('@packages/client')
      expect(
        decodeError({ input: 'a.yaml', client: { output: 'src/client.ts', package: 'a b' } })
          .message,
      ).toBe(
        'Invalid config: client.package: must be a module specifier, with no whitespace or quotes',
      )
      expect(
        decodeError({
          input: 'a.yaml',
          client: { output: '../client/src/client.ts', import: '@packages/server' },
        }).message,
      ).toBe(
        'Invalid config: client.import: import was removed: a client in another package imports the app by the top-level `package`, the name the app entry is published as. Delete the import and set package.',
      )
    })

    // The generated client is what `eden` and the hooks import; their blocks name an output only.
    it('takes eden and the hooks with an output alone', () => {
      const config = decode({
        input: 'a.yaml',
        client: { output: 'src/client.ts' },
        eden: { output: 'src/eden.ts' },
        'tanstack-query': { output: 'src/tanstack-query.ts' },
      })
      expect(config.eden).toStrictEqual({ output: 'src/eden.ts' })
      expect(config['tanstack-query']).toStrictEqual({ output: 'src/tanstack-query.ts' })
    })

    it('counts the client among the outputs that may not collide', () => {
      const error = decodeError({
        input: 'a.yaml',
        client: { output: 'src/client.ts' },
        eden: { output: 'src/client.ts' },
      })
      expect(error.message).toBe(
        'Invalid config: eden.output and client.output both write to src/client.ts. Give each generator its own output path.',
      )
    })
  })

  // The wrappers carry no JSDoc any more; a config that still asks for it is told so.
  it('rejects eden.docs, naming what happened to it', () => {
    const error = decodeError({
      input: 'a.yaml',
      client: { output: 'src/client.ts' },
      eden: { output: 'src/eden.ts', docs: true },
    })
    expect(error.message).toBe(
      'Invalid config: eden.docs: docs was removed: the wrappers carry no JSDoc. Delete the option.',
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
      pathAlias: '@/',
      readonly: true,
      components: {
        schemas: { output: 'src/components/schemas', split: true, exportTypes: true },
        responses: { output: 'src/components/responses.ts' },
      },
      package: '@packages/elysia',
      client: { output: 'src/lib/client.ts', package: '@packages/client', sameOrigin: true },
      eden: { output: 'src/eden.ts' },
      types: { output: 'src/types.ts' },
      mock: { output: 'src/mock.ts', seed: 42, delay: { min: 100, max: 800 } },
      swr: { output: 'src/swr.ts' },
      'tanstack-query': { output: 'src/tanstack-query.ts' },
    })
    expect(config.eden.output).toBe('src/eden.ts')
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

  // The hooks and the wrappers need the client block, and the type says so on their key.
  it('is a type error to name the hooks or eden without the client', () => {
    const hooks = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- needs the top-level client
      swr: { output: 'src/swr.ts' },
    })
    expect(hooks.input).toBe('openapi.yaml')
    const wrappers = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- needs the top-level client
      eden: { output: 'src/eden.ts' },
    })
    expect(wrappers.input).toBe('openapi.yaml')
    const both = defineConfig({
      input: 'openapi.yaml',
      client: { output: 'src/client.ts' },
      swr: { output: 'src/swr.ts' },
      eden: { output: 'src/eden.ts' },
    })
    expect(both.client.output).toBe('src/client.ts')
  })

  // An option that was removed is typed `never`, so a config that carries one does not compile;
  // one per call, since a literal that fails the constraint is not inferred.
  it('is a type error to name an import or a client on the hooks', () => {
    const named = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- `client` was removed
      swr: { output: 'src/swr.ts', client: 'api' },
    })
    expect(named.input).toBe('openapi.yaml')
    const imported = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- `import` was removed
      'tanstack-query': { output: 'src/tanstack-query.ts', import: './lib' },
    })
    expect(imported.input).toBe('openapi.yaml')
  })

  it('is a type error to name an import on eden, a component section or the client', () => {
    const eden = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- `import` was removed
      eden: { output: 'src/eden.ts', import: './lib' },
    })
    expect(eden.input).toBe('openapi.yaml')
    const section = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- `import` was removed
      components: { schemas: { output: 'src/schemas.ts', import: '../schemas' } },
    })
    expect(section.input).toBe('openapi.yaml')
    const client = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- `import` was removed
      client: { output: 'src/client.ts', import: '@packages/elysia' },
    })
    expect(client.input).toBe('openapi.yaml')
  })

  it('is a type error to ask eden for docs', () => {
    const config = defineConfig({
      input: 'openapi.yaml',
      // @ts-expect-error -- docs was removed
      eden: { output: 'src/eden.ts', docs: true },
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
      swr: { output: 'src/swr', split: true },
    })
    expect(config.input).toBe('openapi.yaml')
  })
})
