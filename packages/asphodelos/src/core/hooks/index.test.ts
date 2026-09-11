import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { makeQueryHooks } from '../../helper/query.js'
import type { OpenAPI } from '../../openapi/index.js'
import { runGenerator, runGeneratorError } from '../../testing/index.js'
import { HOOK_CONFIGS } from './index.js'

describe('swr generator', () => {
  const swr = (
    openAPI: OpenAPI,
    output: string,
    importPath: string,
    client = 'client',
    basePath?: string,
    split?: boolean,
  ) => makeQueryHooks(openAPI, output, importPath, HOOK_CONFIGS.swr, client, basePath, split)

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-swr-'))
    process.chdir(dir)
    try {
      await runGenerator(swr(api, 'src/swr.ts', './lib'))
      return readFileSync(path.join(dir, 'src/swr.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('GET (simple, no pagination): emits keyGetter + useSWR + useSWRImmutable with `<TError>` generic', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import useSWR from 'swr'
import type { SWRConfiguration } from 'swr'
import useSWRImmutable from 'swr/immutable'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function useListItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  config?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  >,
) {
  return useSWR<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  >(
    listItemsQueryKey(),
    async () => {
      const { data, error } = await client.items.get(options)
      if (error) throw error
      return data
    },
    config,
  )
}

export function useImmutableListItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  config?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  >,
) {
  return useSWRImmutable<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  >(
    listItemsQueryKey(),
    async () => {
      const { data, error } = await client.items.get(options)
      if (error) throw error
      return data
    },
    config,
  )
}
`
    expect(code).toBe(expected)
  })

  it('GET with a $ref required query param: resolves the ref so options is required (not optional)', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/search': {
          get: {
            operationId: 'search',
            parameters: [{ $ref: '#/components/parameters/RequiredQ' }],
            responses: { '200': { description: 'ok' } },
          },
        },
      },
      components: {
        parameters: {
          RequiredQ: { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
        },
      },
    })
    const expected = `import useSWR from 'swr'
import type { SWRConfiguration } from 'swr'
import useSWRImmutable from 'swr/immutable'
import { client } from './lib'

export function getSearchKey() {
  return ['search'] as const
}

export function searchQueryKey(options?: Parameters<typeof client.search.get>[0]) {
  const { headers: _h, fetch: _f, throwHttpError: _t, ...keyArgs } = options ?? {}
  return ['search', '/search', keyArgs] as const
}

export function useSearch<
  TError = Exclude<Awaited<ReturnType<typeof client.search.get>>['error'], null>,
>(
  options: Parameters<typeof client.search.get>[0],
  config?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.search.get>>, { error: null }>['data'],
    TError
  >,
) {
  return useSWR<
    Extract<Awaited<ReturnType<typeof client.search.get>>, { error: null }>['data'],
    TError
  >(
    searchQueryKey(options),
    async () => {
      const { data, error } = await client.search.get(options)
      if (error) throw error
      return data
    },
    config,
  )
}

export function useImmutableSearch<
  TError = Exclude<Awaited<ReturnType<typeof client.search.get>>['error'], null>,
>(
  options: Parameters<typeof client.search.get>[0],
  config?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.search.get>>, { error: null }>['data'],
    TError
  >,
) {
  return useSWRImmutable<
    Extract<Awaited<ReturnType<typeof client.search.get>>, { error: null }>['data'],
    TError
  >(
    searchQueryKey(options),
    async () => {
      const { data, error } = await client.search.get(options)
      if (error) throw error
      return data
    },
    config,
  )
}
`
    expect(code).toBe(expected)
  })

  it('GET with x-pagination: also emits useSWRInfinite with buildInit + per-page key', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            'x-pagination': true,
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    })
    const expected = `import useSWR from 'swr'
import type { SWRConfiguration } from 'swr'
import useSWRImmutable from 'swr/immutable'
import useSWRInfinite from 'swr/infinite'
import type { SWRInfiniteConfiguration } from 'swr/infinite'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function useListItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  config?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  >,
) {
  return useSWR<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  >(
    listItemsQueryKey(),
    async () => {
      const { data, error } = await client.items.get(options)
      if (error) throw error
      return data
    },
    config,
  )
}

export function useImmutableListItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  config?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  >,
) {
  return useSWRImmutable<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  >(
    listItemsQueryKey(),
    async () => {
      const { data, error } = await client.items.get(options)
      if (error) throw error
      return data
    },
    config,
  )
}

export function useListItemsInfinite<
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  buildInit: (
    pageIndex: number,
    previousPage:
      | Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data']
      | null,
  ) => Parameters<typeof client.items.get>[0] | null,
  config?: SWRInfiniteConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  >,
) {
  const getKey = (
    pageIndex: number,
    previousPage:
      | Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data']
      | null,
  ) => {
    const options = buildInit(pageIndex, previousPage)
    if (options === null) return null
    const { headers: _h, fetch: _f, throwHttpError: _t, ...keyArgs } = options ?? {}
    return ['items', '/items', 'infinite', pageIndex, keyArgs] as const
  }
  return useSWRInfinite<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    typeof getKey
  >(
    getKey,
    async ([_resource, _opId, _infinite, _pageIndex, keyArgs]) => {
      const { data, error } = await client.items.get(keyArgs)
      if (error) throw error
      return data
    },
    config,
  )
}
`
    expect(code).toBe(expected)
  })

  it('GET with path parameter: keyGetter + hook thread `params` ahead of `options`', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          get: { operationId: 'getItem', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import useSWR from 'swr'
import type { SWRConfiguration } from 'swr'
import useSWRImmutable from 'swr/immutable'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemQueryKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', params] as const
}

export function useGetItem<
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
  config?: SWRConfiguration<
    Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
    TError
  >,
) {
  return useSWR<
    Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
    TError
  >(
    getItemQueryKey(params),
    async () => {
      const { data, error } = await client.items(params).get(options)
      if (error) throw error
      return data
    },
    config,
  )
}

export function useImmutableGetItem<
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
  config?: SWRConfiguration<
    Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
    TError
  >,
) {
  return useSWRImmutable<
    Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
    TError
  >(
    getItemQueryKey(params),
    async () => {
      const { data, error } = await client.items(params).get(options)
      if (error) throw error
      return data
    },
    config,
  )
}
`
    expect(code).toBe(expected)
  })

  it('POST (body method): emits useSWRMutation with `{ body, options? }` ExtraArg', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
        },
      },
    })
    const expected = `import useSWRMutation from 'swr/mutation'
import type { SWRMutationConfiguration } from 'swr/mutation'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function createItemMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function useCreateItem<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>(
  config?: SWRMutationConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    ReturnType<typeof createItemMutationKey>,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >,
) {
  return useSWRMutation<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    ReturnType<typeof createItemMutationKey>,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >(
    createItemMutationKey(),
    async (
      _key: ReturnType<typeof createItemMutationKey>,
      {
        arg,
      }: {
        arg: {
          body: Parameters<typeof client.items.post>[0]
          options?: Parameters<typeof client.items.post>[1]
        }
      },
    ) => {
      const { data, error } = await client.items.post(arg.body, arg.options)
      if (error) throw error
      return data
    },
    config,
  )
}
`
    expect(code).toBe(expected)
  })

  it('DELETE (body method): emits useSWRMutation with `{ body; options? }` ExtraArg (eden delete takes body, options)', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          delete: { operationId: 'deleteItem', responses: { '204': { description: 'ok' } } },
        },
      },
    })
    const expected = `import useSWRMutation from 'swr/mutation'
import type { SWRMutationConfiguration } from 'swr/mutation'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function deleteItemMutationKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', 'DELETE', params] as const
}

export function useDeleteItem<
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  config?: SWRMutationConfiguration<
    Extract<
      Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>,
      { error: null }
    >['data'],
    TError,
    ReturnType<typeof deleteItemMutationKey>,
    {
      body: Parameters<ReturnType<typeof client.items>['delete']>[0]
      options?: Parameters<ReturnType<typeof client.items>['delete']>[1]
    }
  >,
) {
  return useSWRMutation<
    Extract<
      Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>,
      { error: null }
    >['data'],
    TError,
    ReturnType<typeof deleteItemMutationKey>,
    {
      body: Parameters<ReturnType<typeof client.items>['delete']>[0]
      options?: Parameters<ReturnType<typeof client.items>['delete']>[1]
    }
  >(
    deleteItemMutationKey(params),
    async (
      _key: ReturnType<typeof deleteItemMutationKey>,
      {
        arg,
      }: {
        arg: {
          body: Parameters<ReturnType<typeof client.items>['delete']>[0]
          options?: Parameters<ReturnType<typeof client.items>['delete']>[1]
        }
      },
    ) => {
      const { data, error } = await client.items(params).delete(arg.body, arg.options)
      if (error) throw error
      return data
    },
    config,
  )
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input (no operations)', async () => {
    const result = await runGenerator(
      swr(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/swr.ts',
        './lib',
      ),
    )
    expect(result).toStrictEqual('No operations found')
  })

  it('split mode: emits one file per operation + index.ts barrel with selective per-file imports', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-swr-split-'))
    process.chdir(dir)
    try {
      const outDir = path.join(dir, 'src/swr')
      await runGenerator(
        swr(
          {
            openapi: '3.1.0',
            info: { title: 'T', version: '0' },
            paths: {
              '/items': {
                get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
                post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
              },
            },
          },
          outDir,
          './lib',
          undefined,
          undefined,
          true,
        ),
      )
      const files = readdirSync(outDir).toSorted()
      expect(files).toStrictEqual(['createItem.ts', 'index.ts', 'keys.ts', 'listItems.ts'])

      const expectedIndex = `export * from './keys'
export * from './listItems'
export * from './createItem'
`
      expect(readFileSync(path.join(outDir, 'index.ts'), 'utf8')).toBe(expectedIndex)

      const expectedKeys = `export function getItemsKey() {
  return ['items'] as const
}
`
      expect(readFileSync(path.join(outDir, 'keys.ts'), 'utf8')).toBe(expectedKeys)

      // Mutation file imports ONLY swr/mutation — no swr/swr/infinite.
      const expectedCreateItem = `import useSWRMutation from 'swr/mutation'
import type { SWRMutationConfiguration } from 'swr/mutation'
import { client } from './lib'

export function createItemMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function useCreateItem<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>(
  config?: SWRMutationConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    ReturnType<typeof createItemMutationKey>,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >,
) {
  return useSWRMutation<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    ReturnType<typeof createItemMutationKey>,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >(
    createItemMutationKey(),
    async (
      _key: ReturnType<typeof createItemMutationKey>,
      {
        arg,
      }: {
        arg: {
          body: Parameters<typeof client.items.post>[0]
          options?: Parameters<typeof client.items.post>[1]
        }
      },
    ) => {
      const { data, error } = await client.items.post(arg.body, arg.options)
      if (error) throw error
      return data
    },
    config,
  )
}
`
      expect(readFileSync(path.join(outDir, 'createItem.ts'), 'utf8')).toBe(expectedCreateItem)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('split mode: errors when an operation resolves to the reserved keys.ts file name', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-swr-keys-collision-'))
    process.chdir(dir)
    try {
      const result = await runGeneratorError(
        swr(
          {
            openapi: '3.1.0',
            info: { title: 'T', version: '0' },
            paths: {
              '/keys': {
                get: { operationId: 'keys', responses: { '200': { description: 'ok' } } },
              },
            },
          },
          path.join(dir, 'src/swr'),
          './lib',
          undefined,
          undefined,
          true,
        ),
      )
      expect(result.message).toStrictEqual(
        "Operation file name 'keys.ts' collides with the aggregated cache-key file. Rename the operation (operationId) that resolves to 'keys'.",
      )
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('split mode: emits no keys.ts (and no barrel entry) when there are no prefixes', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-swr-no-prefix-'))
    process.chdir(dir)
    try {
      const outDir = path.join(dir, 'src/swr')
      await runGenerator(
        swr(
          {
            openapi: '3.1.0',
            info: { title: 'T', version: '0' },
            paths: {
              '/': {
                get: { operationId: 'getRoot', responses: { '200': { description: 'ok' } } },
              },
            },
          },
          outDir,
          './lib',
          undefined,
          undefined,
          true,
        ),
      )
      const files = readdirSync(outDir).toSorted()
      expect(files).toStrictEqual(['getRoot.ts', 'index.ts'])
      expect(readFileSync(path.join(outDir, 'index.ts'), 'utf8')).toBe(
        `export * from './getRoot'\n`,
      )
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('tanstack-query generator', () => {
  const tanstackQuery = (
    openAPI: OpenAPI,
    output: string,
    importPath: string,
    client = 'client',
    basePath?: string,
    split?: boolean,
    packageName?: string,
  ) =>
    makeQueryHooks(
      openAPI,
      output,
      importPath,
      packageName
        ? { ...HOOK_CONFIGS['tanstack-query'], packageName }
        : HOOK_CONFIGS['tanstack-query'],
      client,
      basePath,
      split,
    )

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-tq-'))
    process.chdir(dir)
    try {
      await runGenerator(tanstackQuery(api, 'src/tanstack.ts', './lib'))
      return readFileSync(path.join(dir, 'src/tanstack.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  const generateSplitAndRead = async (
    api: OpenAPI,
  ): Promise<{ files: string[]; index: string; perOp: Record<string, string> }> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-tq-split-'))
    process.chdir(dir)
    try {
      const outDir = path.join(dir, 'src/tanstack')
      await runGenerator(tanstackQuery(api, outDir, './lib', undefined, undefined, true))
      const files = readdirSync(outDir).toSorted()
      const perOp: Record<string, string> = {}
      for (const f of files) {
        if (f === 'index.ts') continue
        perOp[f] = readFileSync(path.join(outDir, f), 'utf8')
      }
      const index = readFileSync(path.join(outDir, 'index.ts'), 'utf8')
      return { files, index, perOp }
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('GET (simple, no tags, no pagination): emits keyGetter + queryOptions factory + useQuery + useSuspenseQuery', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { useQuery, useSuspenseQuery, queryOptions } from '@tanstack/react-query'
import type { UseQueryOptions, UseSuspenseQueryOptions } from '@tanstack/react-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    UseQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useSuspenseListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    UseSuspenseQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useSuspenseQuery<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}
`
    expect(code).toBe(expected)
  })

  it('GET with x-pagination: also emits Infinite key getter + Infinite factory + useInfiniteQuery + useSuspenseInfiniteQuery', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            'x-pagination': true,
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    })
    const expected = `import { useQuery, useSuspenseQuery, queryOptions } from '@tanstack/react-query'
import type { UseQueryOptions, UseSuspenseQueryOptions } from '@tanstack/react-query'
import {
  useInfiniteQuery,
  useSuspenseInfiniteQuery,
  infiniteQueryOptions,
} from '@tanstack/react-query'
import type {
  UseInfiniteQueryOptions,
  InfiniteData,
  UseSuspenseInfiniteQueryOptions,
} from '@tanstack/react-query'
import type { QueryFunctionContext } from '@tanstack/react-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    UseQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useSuspenseListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    UseSuspenseQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useSuspenseQuery<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function listItemsInfiniteQueryKey(options?: Parameters<typeof client.items.get>[0]) {
  const { headers: _h, fetch: _f, throwHttpError: _t, ...keyArgs } = options ?? {}
  return ['items', '/items', 'infinite', keyArgs] as const
}

export function listItemsInfiniteQueryOptions<TPageParam>(
  options: Parameters<typeof client.items.get>[0] | undefined,
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    buildInit: (pageParam: unknown) => Parameters<typeof client.items.get>[0]
  },
) {
  return infiniteQueryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
    InfiniteData<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TPageParam
    >,
    ReturnType<typeof listItemsInfiniteQueryKey>,
    TPageParam
  >({
    queryKey: listItemsInfiniteQueryKey(options),
    queryFn: async ({ pageParam, signal }) => {
      const overlay = pagination.buildInit(pageParam)
      const { data, error } = await client.items.get({
        ...options,
        ...overlay,
        query: { ...options?.query, ...overlay?.query },
        headers: { ...options?.headers, ...overlay?.headers },
        fetch: { ...options?.fetch, ...overlay?.fetch, signal },
      })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  })
}

export function useListItemsInfinite<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options: Parameters<typeof client.items.get>[0] | undefined,
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    buildInit: (pageParam: unknown) => Parameters<typeof client.items.get>[0]
  },
  queryOptions?: Omit<
    UseInfiniteQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData,
      ReturnType<typeof listItemsInfiniteQueryKey>,
      TPageParam
    >,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
  >,
) {
  return useInfiniteQuery({
    ...queryOptions,
    queryKey: listItemsInfiniteQueryKey(options),
    queryFn: async ({
      pageParam,
      signal,
    }: QueryFunctionContext<ReturnType<typeof listItemsInfiniteQueryKey>, TPageParam>) => {
      const overlay = pagination.buildInit(pageParam)
      const { data, error } = await client.items.get({
        ...options,
        ...overlay,
        query: { ...options?.query, ...overlay?.query },
        headers: { ...options?.headers, ...overlay?.headers },
        fetch: { ...options?.fetch, ...overlay?.fetch, signal },
      })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  })
}

export function useSuspenseListItemsInfinite<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options: Parameters<typeof client.items.get>[0] | undefined,
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    buildInit: (pageParam: unknown) => Parameters<typeof client.items.get>[0]
  },
  queryOptions?: Omit<
    UseSuspenseInfiniteQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData,
      ReturnType<typeof listItemsInfiniteQueryKey>,
      TPageParam
    >,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
  >,
) {
  return useSuspenseInfiniteQuery({
    ...queryOptions,
    queryKey: listItemsInfiniteQueryKey(options),
    queryFn: async ({
      pageParam,
      signal,
    }: QueryFunctionContext<ReturnType<typeof listItemsInfiniteQueryKey>, TPageParam>) => {
      const overlay = pagination.buildInit(pageParam)
      const { data, error } = await client.items.get({
        ...options,
        ...overlay,
        query: { ...options?.query, ...overlay?.query },
        headers: { ...options?.headers, ...overlay?.headers },
        fetch: { ...options?.fetch, ...overlay?.fetch, signal },
      })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  })
}
`
    expect(code).toBe(expected)
  })

  it('GET with path parameter: keyGetter + factory + hooks thread `params` ahead of `options`', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          get: { operationId: 'getItem', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { useQuery, useSuspenseQuery, queryOptions } from '@tanstack/react-query'
import type { UseQueryOptions, UseSuspenseQueryOptions } from '@tanstack/react-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemQueryKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', params] as const
}

export function getItemQueryOptions(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
) {
  return queryOptions({
    queryKey: getItemQueryKey(params),
    queryFn: async ({ signal }) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}

export function useGetItem<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
  queryOptions?: Omit<
    UseQueryOptions<
      Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery<
    Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: getItemQueryKey(params),
    queryFn: async ({ signal }) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}

export function useSuspenseGetItem<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
  queryOptions?: Omit<
    UseSuspenseQueryOptions<
      Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useSuspenseQuery<
    Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: getItemQueryKey(params),
    queryFn: async ({ signal }) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}
`
    expect(code).toBe(expected)
  })

  it('GET on /v1/widgets: version segment is skipped during resource derivation (`widgets` wins, not `v1`)', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/v1/widgets': {
          get: { operationId: 'listWidgets', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { useQuery, useSuspenseQuery, queryOptions } from '@tanstack/react-query'
import type { UseQueryOptions, UseSuspenseQueryOptions } from '@tanstack/react-query'
import { client } from './lib'

export function getV1Key() {
  return ['v1'] as const
}

export function listWidgetsQueryKey() {
  return ['v1', '/v1/widgets'] as const
}

export function listWidgetsQueryOptions(options?: Parameters<typeof client.v1.widgets.get>[0]) {
  return queryOptions({
    queryKey: listWidgetsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.v1.widgets.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useListWidgets<
  TData = Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.v1.widgets.get>>['error'], null>,
>(
  options?: Parameters<typeof client.v1.widgets.get>[0],
  queryOptions?: Omit<
    UseQueryOptions<
      Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery<
    Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: listWidgetsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.v1.widgets.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useSuspenseListWidgets<
  TData = Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.v1.widgets.get>>['error'], null>,
>(
  options?: Parameters<typeof client.v1.widgets.get>[0],
  queryOptions?: Omit<
    UseSuspenseQueryOptions<
      Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useSuspenseQuery<
    Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: listWidgetsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.v1.widgets.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}
`
    expect(code).toBe(expected)
  })

  it('POST (body method): emits mutationOptions factory + useMutation spreading it, with `{ body, options? }` variables', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { useMutation, mutationOptions } from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function createItemMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function createItemMutationOptions<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>() {
  return mutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >({
    mutationKey: createItemMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items.post(body, options)
      if (error) throw error
      return data
    },
  })
}

export function useCreateItem<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>(
  mutationOptions?: UseMutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >,
) {
  return useMutation<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >({ ...mutationOptions, ...createItemMutationOptions<TError>() })
}
`
    expect(code).toBe(expected)
  })

  it('DELETE (body method): emits mutationOptions factory + useMutation with `{ body; options? }` variables (eden delete takes body, options)', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          delete: { operationId: 'deleteItem', responses: { '204': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { useMutation, mutationOptions } from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function deleteItemMutationKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', 'DELETE', params] as const
}

export function deleteItemMutationOptions<
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>['error'], null>,
>(params: Parameters<typeof client.items>[0]) {
  return mutationOptions<
    Extract<
      Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>,
      { error: null }
    >['data'],
    TError,
    {
      body: Parameters<ReturnType<typeof client.items>['delete']>[0]
      options?: Parameters<ReturnType<typeof client.items>['delete']>[1]
    }
  >({
    mutationKey: deleteItemMutationKey(params),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items(params).delete(body, options)
      if (error) throw error
      return data
    },
  })
}

export function useDeleteItem<
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  mutationOptions?: UseMutationOptions<
    Extract<
      Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>,
      { error: null }
    >['data'],
    TError,
    {
      body: Parameters<ReturnType<typeof client.items>['delete']>[0]
      options?: Parameters<ReturnType<typeof client.items>['delete']>[1]
    }
  >,
) {
  return useMutation<
    Extract<
      Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>,
      { error: null }
    >['data'],
    TError,
    {
      body: Parameters<ReturnType<typeof client.items>['delete']>[0]
      options?: Parameters<ReturnType<typeof client.items>['delete']>[1]
    }
  >({ ...mutationOptions, ...deleteItemMutationOptions<TError>(params) })
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input (no operations)', async () => {
    const result = await runGenerator(
      tanstackQuery(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/tanstack.ts',
        './lib',
      ),
    )
    expect(result).toStrictEqual('No operations found')
  })

  it('split mode: emits one file per operation + index.ts barrel with selective per-file imports', async () => {
    const { files, index, perOp } = await generateSplitAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
          post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
        },
      },
    })
    expect(files).toStrictEqual(['createItem.ts', 'index.ts', 'keys.ts', 'listItems.ts'])
    const expectedIndex = `export * from './keys'
export * from './listItems'
export * from './createItem'
`
    expect(index).toBe(expectedIndex)

    const expectedKeys = `export function getItemsKey() {
  return ['items'] as const
}
`
    expect(perOp['keys.ts']).toBe(expectedKeys)

    const expectedListItems = `import { useQuery, useSuspenseQuery, queryOptions } from '@tanstack/react-query'
import type { UseQueryOptions, UseSuspenseQueryOptions } from '@tanstack/react-query'
import { client } from './lib'

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    UseQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useSuspenseListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    UseSuspenseQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useSuspenseQuery<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}
`
    expect(perOp['listItems.ts']).toBe(expectedListItems)

    // Mutation file imports ONLY the mutation hook, helper and option type — no useQuery
    // / queryOptions (selective per-file imports proves the import scoping).
    const expectedCreateItem = `import { useMutation, mutationOptions } from '@tanstack/react-query'
import type { UseMutationOptions } from '@tanstack/react-query'
import { client } from './lib'

export function createItemMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function createItemMutationOptions<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>() {
  return mutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >({
    mutationKey: createItemMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items.post(body, options)
      if (error) throw error
      return data
    },
  })
}

export function useCreateItem<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>(
  mutationOptions?: UseMutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >,
) {
  return useMutation<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >({ ...mutationOptions, ...createItemMutationOptions<TError>() })
}
`
    expect(perOp['createItem.ts']).toBe(expectedCreateItem)
  })

  it('packageName arg flows into emitted import (non-default package, non-split mode)', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-tq-pkg-'))
    process.chdir(dir)
    try {
      await runGenerator(
        tanstackQuery(
          {
            openapi: '3.1.0',
            info: { title: 'T', version: '0' },
            paths: {
              '/items': {
                get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
              },
            },
          },
          'src/tanstack.ts',
          './lib',
          undefined,
          undefined,
          false,
          '@example/custom-query',
        ),
      )
      const code = readFileSync(path.join(dir, 'src/tanstack.ts'), 'utf8')
      const expected = `import { useQuery, useSuspenseQuery, queryOptions } from '@example/custom-query'
import type { UseQueryOptions, UseSuspenseQueryOptions } from '@example/custom-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    UseQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useSuspenseListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    UseSuspenseQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useSuspenseQuery<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData
  >({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}
`
      expect(code).toBe(expected)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('preact-query generator', () => {
  it('imports every hook, helper and type from @tanstack/preact-query, not the React package', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-preact-'))
    process.chdir(dir)
    try {
      await runGenerator(
        makeQueryHooks(
          {
            openapi: '3.1.0',
            info: { title: 'T', version: '0' },
            paths: {
              '/items': {
                get: {
                  operationId: 'listItems',
                  'x-pagination': true,
                  responses: { '200': { description: 'ok' } },
                },
                post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
              },
            },
          },
          'src/preact.ts',
          './lib',
          HOOK_CONFIGS['preact-query'],
          'client',
        ),
      )
      const code = readFileSync(path.join(dir, 'src/preact.ts'), 'utf8')
      const header = code.slice(0, code.indexOf("import { client } from './lib'"))
      const expected = `import { useQuery, useSuspenseQuery, queryOptions } from '@tanstack/preact-query'
import type { UseQueryOptions, UseSuspenseQueryOptions } from '@tanstack/preact-query'
import {
  useInfiniteQuery,
  useSuspenseInfiniteQuery,
  infiniteQueryOptions,
} from '@tanstack/preact-query'
import type {
  UseInfiniteQueryOptions,
  InfiniteData,
  UseSuspenseInfiniteQueryOptions,
} from '@tanstack/preact-query'
import { useMutation, mutationOptions } from '@tanstack/preact-query'
import type { UseMutationOptions } from '@tanstack/preact-query'
import type { QueryFunctionContext } from '@tanstack/preact-query'
`
      expect(header).toBe(expected)
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('vue-query generator', () => {
  const vueQuery = (
    openAPI: OpenAPI,
    output: string,
    importPath: string,
    client = 'client',
    basePath?: string,
    split?: boolean,
  ) =>
    makeQueryHooks(openAPI, output, importPath, HOOK_CONFIGS['vue-query'], client, basePath, split)

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-vue-'))
    process.chdir(dir)
    try {
      await runGenerator(vueQuery(api, 'src/vue.ts', './lib'))
      return readFileSync(path.join(dir, 'src/vue.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('GET emits useQuery hook with use<Op> naming + 5-generic UseQueryOptions', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { useQuery, queryOptions } from '@tanstack/vue-query'
import type { UseQueryOptions } from '@tanstack/vue-query'
import type { QueryFunctionContext } from '@tanstack/vue-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    Extract<
      UseQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        ReturnType<typeof listItemsQueryKey>
      >,
      { queryKey: unknown }
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input', async () => {
    const result = await runGenerator(
      vueQuery(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/vue.ts',
        './lib',
      ),
    )
    expect(result).toStrictEqual('No operations found')
  })

  it('GET with path parameter: keyGetter + factory + hook thread `params` ahead of `options`', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          get: { operationId: 'getItem', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { useQuery, queryOptions } from '@tanstack/vue-query'
import type { UseQueryOptions } from '@tanstack/vue-query'
import type { QueryFunctionContext } from '@tanstack/vue-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemQueryKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', params] as const
}

export function getItemQueryOptions(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
) {
  return queryOptions({
    queryKey: getItemQueryKey(params),
    queryFn: async ({ signal }) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}

export function useGetItem<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
  queryOptions?: Omit<
    Extract<
      UseQueryOptions<
        Extract<
          Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
          { error: null }
        >['data'],
        TError,
        TData,
        Extract<
          Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
          { error: null }
        >['data'],
        ReturnType<typeof getItemQueryKey>
      >,
      { queryKey: unknown }
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery({
    ...queryOptions,
    queryKey: getItemQueryKey(params),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}
`
    expect(code).toBe(expected)
  })

  it('GET with x-pagination: also emits Infinite key getter + useInfiniteQuery hook taking `pagination.buildInit`', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            'x-pagination': true,
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    })
    const expected = `import { useQuery, queryOptions } from '@tanstack/vue-query'
import type { UseQueryOptions } from '@tanstack/vue-query'
import { useInfiniteQuery } from '@tanstack/vue-query'
import type { UseInfiniteQueryOptions, InfiniteData } from '@tanstack/vue-query'
import type { QueryFunctionContext } from '@tanstack/vue-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function useListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    Extract<
      UseQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        ReturnType<typeof listItemsQueryKey>
      >,
      { queryKey: unknown }
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useQuery({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function listItemsInfiniteQueryKey(options?: Parameters<typeof client.items.get>[0]) {
  const { headers: _h, fetch: _f, throwHttpError: _t, ...keyArgs } = options ?? {}
  return ['items', '/items', 'infinite', keyArgs] as const
}

export function useListItemsInfinite<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options: Parameters<typeof client.items.get>[0] | undefined,
  pagination: { buildInit: (pageParam: unknown) => Parameters<typeof client.items.get>[0] },
  queryOptions: Omit<
    Extract<
      UseInfiniteQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof listItemsInfiniteQueryKey>,
        TPageParam
      >,
      { queryKey: unknown }
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return useInfiniteQuery({
    ...queryOptions,
    queryKey: listItemsInfiniteQueryKey(options),
    queryFn: async ({ pageParam, signal }: QueryFunctionContext) => {
      const overlay = pagination.buildInit(pageParam)
      const { data, error } = await client.items.get({
        ...options,
        ...overlay,
        query: { ...options?.query, ...overlay?.query },
        headers: { ...options?.headers, ...overlay?.headers },
        fetch: { ...options?.fetch, ...overlay?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}
`
    expect(code).toBe(expected)
  })

  it('POST (body method): emits mutationOptions factory + useMutation hook with `{ body, options? }` variables', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { useMutation, mutationOptions } from '@tanstack/vue-query'
import type { UseMutationOptions } from '@tanstack/vue-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function createItemMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function createItemMutationOptions<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>() {
  return mutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >({
    mutationKey: createItemMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items.post(body, options)
      if (error) throw error
      return data
    },
  })
}

export function useCreateItem<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>(
  mutationOptions?: UseMutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >,
) {
  return useMutation({ ...mutationOptions, ...createItemMutationOptions<TError>() })
}
`
    expect(code).toBe(expected)
  })
})

describe('solid-query generator', () => {
  const solidQuery = (
    openAPI: OpenAPI,
    output: string,
    importPath: string,
    client = 'client',
    basePath?: string,
    split?: boolean,
  ) =>
    makeQueryHooks(
      openAPI,
      output,
      importPath,
      HOOK_CONFIGS['solid-query'],
      client,
      basePath,
      split,
    )

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-solid-'))
    process.chdir(dir)
    try {
      await runGenerator(solidQuery(api, 'src/solid.ts', './lib'))
      return readFileSync(path.join(dir, 'src/solid.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('GET emits createQuery hook with create<Op> naming + accessor wrap', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { createQuery, queryOptions } from '@tanstack/solid-query'
import type { UndefinedInitialDataOptions } from '@tanstack/solid-query'
import type { QueryFunctionContext } from '@tanstack/solid-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function createListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: () => Omit<
    ReturnType<
      UndefinedInitialDataOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof listItemsQueryKey>
      >
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return createQuery(() => ({
    ...queryOptions?.(),
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  }))
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input', async () => {
    const result = await runGenerator(
      solidQuery(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/solid.ts',
        './lib',
      ),
    )
    expect(result).toStrictEqual('No operations found')
  })

  it('GET with path parameter: keyGetter + factory + hook thread `params` ahead of `options`', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          get: { operationId: 'getItem', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { createQuery, queryOptions } from '@tanstack/solid-query'
import type { UndefinedInitialDataOptions } from '@tanstack/solid-query'
import type { QueryFunctionContext } from '@tanstack/solid-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemQueryKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', params] as const
}

export function getItemQueryOptions(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
) {
  return queryOptions({
    queryKey: getItemQueryKey(params),
    queryFn: async ({ signal }) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}

export function createGetItem<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
  queryOptions?: () => Omit<
    ReturnType<
      UndefinedInitialDataOptions<
        Extract<
          Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
          { error: null }
        >['data'],
        TError,
        TData,
        ReturnType<typeof getItemQueryKey>
      >
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return createQuery(() => ({
    ...queryOptions?.(),
    queryKey: getItemQueryKey(params),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  }))
}
`
    expect(code).toBe(expected)
  })

  it('GET with x-pagination: also emits Infinite key getter + infiniteQueryOptions factory + createInfiniteQuery hook (unwrapped accessor options)', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            'x-pagination': true,
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    })
    const expected = `import { createQuery, queryOptions } from '@tanstack/solid-query'
import type { UndefinedInitialDataOptions } from '@tanstack/solid-query'
import { createInfiniteQuery, infiniteQueryOptions } from '@tanstack/solid-query'
import type { UndefinedInitialDataInfiniteOptions, InfiniteData } from '@tanstack/solid-query'
import type { QueryFunctionContext } from '@tanstack/solid-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function createListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: () => Omit<
    ReturnType<
      UndefinedInitialDataOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof listItemsQueryKey>
      >
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return createQuery(() => ({
    ...queryOptions?.(),
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  }))
}

export function listItemsInfiniteQueryKey(options?: Parameters<typeof client.items.get>[0]) {
  const { headers: _h, fetch: _f, throwHttpError: _t, ...keyArgs } = options ?? {}
  return ['items', '/items', 'infinite', keyArgs] as const
}

export function listItemsInfiniteQueryOptions<TPageParam>(
  options: Parameters<typeof client.items.get>[0] | undefined,
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    buildInit: (pageParam: unknown) => Parameters<typeof client.items.get>[0]
  },
) {
  return infiniteQueryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
    InfiniteData<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TPageParam
    >,
    ReturnType<typeof listItemsInfiniteQueryKey>,
    TPageParam
  >({
    queryKey: listItemsInfiniteQueryKey(options),
    queryFn: async ({ pageParam, signal }) => {
      const overlay = pagination.buildInit(pageParam)
      const { data, error } = await client.items.get({
        ...options,
        ...overlay,
        query: { ...options?.query, ...overlay?.query },
        headers: { ...options?.headers, ...overlay?.headers },
        fetch: { ...options?.fetch, ...overlay?.fetch, signal },
      })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  })
}

export function createListItemsInfinite<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options: Parameters<typeof client.items.get>[0] | undefined,
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    buildInit: (pageParam: unknown) => Parameters<typeof client.items.get>[0]
  },
  queryOptions?: () => Omit<
    ReturnType<
      UndefinedInitialDataInfiniteOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof listItemsInfiniteQueryKey>,
        TPageParam
      >
    >,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
  >,
) {
  return createInfiniteQuery(() => ({
    ...queryOptions?.(),
    queryKey: listItemsInfiniteQueryKey(options),
    queryFn: async ({
      pageParam,
      signal,
    }: QueryFunctionContext<ReturnType<typeof listItemsInfiniteQueryKey>, TPageParam>) => {
      const overlay = pagination.buildInit(pageParam)
      const { data, error } = await client.items.get({
        ...options,
        ...overlay,
        query: { ...options?.query, ...overlay?.query },
        headers: { ...options?.headers, ...overlay?.headers },
        fetch: { ...options?.fetch, ...overlay?.fetch, signal },
      })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  }))
}
`
    expect(code).toBe(expected)
  })

  it('POST (body method): emits mutationOptions factory + createMutation hook with unwrapped (ReturnType) mutationOptions and `{ body, options? }` variables', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { createMutation, mutationOptions } from '@tanstack/solid-query'
import type { CreateMutationOptions } from '@tanstack/solid-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function createItemMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function createItemMutationOptions<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>() {
  return mutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >({
    mutationKey: createItemMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items.post(body, options)
      if (error) throw error
      return data
    },
  })
}

export function createCreateItem<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>(
  mutationOptions?: () => ReturnType<
    CreateMutationOptions<
      Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
      TError,
      {
        body: Parameters<typeof client.items.post>[0]
        options?: Parameters<typeof client.items.post>[1]
      }
    >
  >,
) {
  return createMutation(() => ({ ...mutationOptions?.(), ...createItemMutationOptions<TError>() }))
}
`
    expect(code).toBe(expected)
  })
})

describe('svelte-query generator', () => {
  const svelteQuery = (
    openAPI: OpenAPI,
    output: string,
    importPath: string,
    client = 'client',
    basePath?: string,
    split?: boolean,
  ) =>
    makeQueryHooks(
      openAPI,
      output,
      importPath,
      HOOK_CONFIGS['svelte-query'],
      client,
      basePath,
      split,
    )

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-svelte-'))
    process.chdir(dir)
    try {
      await runGenerator(svelteQuery(api, 'src/svelte.ts', './lib'))
      return readFileSync(path.join(dir, 'src/svelte.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('GET emits createQuery hook with create<Op> naming + key getter + queryOptions factory', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { createQuery, queryOptions } from '@tanstack/svelte-query'
import type { CreateQueryOptions } from '@tanstack/svelte-query'
import type { QueryFunctionContext } from '@tanstack/svelte-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function createListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    CreateQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return createQuery(() => ({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  }))
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input', async () => {
    const result = await runGenerator(
      svelteQuery(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/svelte.ts',
        './lib',
      ),
    )
    expect(result).toStrictEqual('No operations found')
  })

  it('GET with path parameter: keyGetter + factory + hook thread `params` ahead of `options`', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          get: { operationId: 'getItem', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { createQuery, queryOptions } from '@tanstack/svelte-query'
import type { CreateQueryOptions } from '@tanstack/svelte-query'
import type { QueryFunctionContext } from '@tanstack/svelte-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemQueryKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', params] as const
}

export function getItemQueryOptions(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
) {
  return queryOptions({
    queryKey: getItemQueryKey(params),
    queryFn: async ({ signal }) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}

export function createGetItem<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
  queryOptions?: Omit<
    CreateQueryOptions<
      Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return createQuery(() => ({
    ...queryOptions,
    queryKey: getItemQueryKey(params),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  }))
}
`
    expect(code).toBe(expected)
  })

  it('GET with x-pagination: also emits Infinite key getter + infiniteQueryOptions factory + createInfiniteQuery hook', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            'x-pagination': true,
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    })
    const expected = `import { createQuery, queryOptions } from '@tanstack/svelte-query'
import type { CreateQueryOptions } from '@tanstack/svelte-query'
import { createInfiniteQuery, infiniteQueryOptions } from '@tanstack/svelte-query'
import type { CreateInfiniteQueryOptions, InfiniteData } from '@tanstack/svelte-query'
import type { QueryFunctionContext } from '@tanstack/svelte-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function createListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    CreateQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return createQuery(() => ({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  }))
}

export function listItemsInfiniteQueryKey(options?: Parameters<typeof client.items.get>[0]) {
  const { headers: _h, fetch: _f, throwHttpError: _t, ...keyArgs } = options ?? {}
  return ['items', '/items', 'infinite', keyArgs] as const
}

export function listItemsInfiniteQueryOptions<TPageParam>(
  options: Parameters<typeof client.items.get>[0] | undefined,
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    buildInit: (pageParam: unknown) => Parameters<typeof client.items.get>[0]
  },
) {
  return infiniteQueryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
    InfiniteData<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TPageParam
    >,
    ReturnType<typeof listItemsInfiniteQueryKey>,
    TPageParam
  >({
    queryKey: listItemsInfiniteQueryKey(options),
    queryFn: async ({ pageParam, signal }) => {
      const overlay = pagination.buildInit(pageParam)
      const { data, error } = await client.items.get({
        ...options,
        ...overlay,
        query: { ...options?.query, ...overlay?.query },
        headers: { ...options?.headers, ...overlay?.headers },
        fetch: { ...options?.fetch, ...overlay?.fetch, signal },
      })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  })
}

export function createListItemsInfinite<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options: Parameters<typeof client.items.get>[0] | undefined,
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    buildInit: (pageParam: unknown) => Parameters<typeof client.items.get>[0]
  },
  queryOptions?: Omit<
    CreateInfiniteQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData,
      ReturnType<typeof listItemsInfiniteQueryKey>,
      TPageParam
    >,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
  >,
) {
  return createInfiniteQuery(() => ({
    ...queryOptions,
    queryKey: listItemsInfiniteQueryKey(options),
    queryFn: async ({
      pageParam,
      signal,
    }: QueryFunctionContext<ReturnType<typeof listItemsInfiniteQueryKey>, TPageParam>) => {
      const overlay = pagination.buildInit(pageParam)
      const { data, error } = await client.items.get({
        ...options,
        ...overlay,
        query: { ...options?.query, ...overlay?.query },
        headers: { ...options?.headers, ...overlay?.headers },
        fetch: { ...options?.fetch, ...overlay?.fetch, signal },
      })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  }))
}
`
    expect(code).toBe(expected)
  })

  it('POST (body method): emits mutationOptions factory + createMutation hook with `{ body, options? }` variables', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { createMutation, mutationOptions } from '@tanstack/svelte-query'
import type { CreateMutationOptions } from '@tanstack/svelte-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function createItemMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function createItemMutationOptions<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>() {
  return mutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >({
    mutationKey: createItemMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items.post(body, options)
      if (error) throw error
      return data
    },
  })
}

export function createCreateItem<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>(
  mutationOptions?: CreateMutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >,
) {
  return createMutation(() => ({ ...mutationOptions, ...createItemMutationOptions<TError>() }))
}
`
    expect(code).toBe(expected)
  })
})

describe('angular-query generator', () => {
  const angularQuery = (
    openAPI: OpenAPI,
    output: string,
    importPath: string,
    client = 'client',
    basePath?: string,
    split?: boolean,
  ) =>
    makeQueryHooks(
      openAPI,
      output,
      importPath,
      HOOK_CONFIGS['angular-query'],
      client,
      basePath,
      split,
    )

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-angular-'))
    process.chdir(dir)
    try {
      await runGenerator(angularQuery(api, 'src/angular.ts', './lib'))
      return readFileSync(path.join(dir, 'src/angular.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('GET emits injectQuery hook with inject<Op> naming + accessor wrap (DI factory)', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { injectQuery, queryOptions } from '@tanstack/angular-query-experimental'
import type { CreateQueryOptions } from '@tanstack/angular-query-experimental'
import type { QueryFunctionContext } from '@tanstack/angular-query-experimental'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function injectListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    CreateQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return injectQuery(() => ({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  }))
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input', async () => {
    const result = await runGenerator(
      angularQuery(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/angular.ts',
        './lib',
      ),
    )
    expect(result).toStrictEqual('No operations found')
  })

  it('GET with path parameter: keyGetter + factory + hook thread `params` ahead of `options`', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          get: { operationId: 'getItem', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { injectQuery, queryOptions } from '@tanstack/angular-query-experimental'
import type { CreateQueryOptions } from '@tanstack/angular-query-experimental'
import type { QueryFunctionContext } from '@tanstack/angular-query-experimental'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemQueryKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', params] as const
}

export function getItemQueryOptions(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
) {
  return queryOptions({
    queryKey: getItemQueryKey(params),
    queryFn: async ({ signal }) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}

export function injectGetItem<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
  queryOptions?: Omit<
    CreateQueryOptions<
      Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return injectQuery(() => ({
    ...queryOptions,
    queryKey: getItemQueryKey(params),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  }))
}
`
    expect(code).toBe(expected)
  })

  it('GET with x-pagination: also emits Infinite key getter + infiniteQueryOptions factory + injectInfiniteQuery hook', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: {
            operationId: 'listItems',
            'x-pagination': true,
            responses: { '200': { description: 'ok' } },
          },
        },
      },
    })
    const expected = `import { injectQuery, queryOptions } from '@tanstack/angular-query-experimental'
import type { CreateQueryOptions } from '@tanstack/angular-query-experimental'
import { injectInfiniteQuery, infiniteQueryOptions } from '@tanstack/angular-query-experimental'
import type { CreateInfiniteQueryOptions, InfiniteData } from '@tanstack/angular-query-experimental'
import type { QueryFunctionContext } from '@tanstack/angular-query-experimental'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function listItemsQueryKey() {
  return ['items', '/items'] as const
}

export function listItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions({
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  })
}

export function injectListItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: Parameters<typeof client.items.get>[0],
  queryOptions?: Omit<
    CreateQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData
    >,
    'queryKey' | 'queryFn'
  >,
) {
  return injectQuery(() => ({
    ...queryOptions,
    queryKey: listItemsQueryKey(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  }))
}

export function listItemsInfiniteQueryKey(options?: Parameters<typeof client.items.get>[0]) {
  const { headers: _h, fetch: _f, throwHttpError: _t, ...keyArgs } = options ?? {}
  return ['items', '/items', 'infinite', keyArgs] as const
}

export function listItemsInfiniteQueryOptions<TPageParam>(
  options: Parameters<typeof client.items.get>[0] | undefined,
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    buildInit: (pageParam: unknown) => Parameters<typeof client.items.get>[0]
  },
) {
  return infiniteQueryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
    InfiniteData<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TPageParam
    >,
    ReturnType<typeof listItemsInfiniteQueryKey>,
    TPageParam
  >({
    queryKey: listItemsInfiniteQueryKey(options),
    queryFn: async ({ pageParam, signal }) => {
      const overlay = pagination.buildInit(pageParam)
      const { data, error } = await client.items.get({
        ...options,
        ...overlay,
        query: { ...options?.query, ...overlay?.query },
        headers: { ...options?.headers, ...overlay?.headers },
        fetch: { ...options?.fetch, ...overlay?.fetch, signal },
      })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  })
}

export function injectListItemsInfinite<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options: Parameters<typeof client.items.get>[0] | undefined,
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    buildInit: (pageParam: unknown) => Parameters<typeof client.items.get>[0]
  },
  queryOptions?: Omit<
    CreateInfiniteQueryOptions<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError,
      TData,
      ReturnType<typeof listItemsInfiniteQueryKey>,
      TPageParam
    >,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
  >,
) {
  return injectInfiniteQuery(() => ({
    ...queryOptions,
    queryKey: listItemsInfiniteQueryKey(options),
    queryFn: async ({
      pageParam,
      signal,
    }: QueryFunctionContext<ReturnType<typeof listItemsInfiniteQueryKey>, TPageParam>) => {
      const overlay = pagination.buildInit(pageParam)
      const { data, error } = await client.items.get({
        ...options,
        ...overlay,
        query: { ...options?.query, ...overlay?.query },
        headers: { ...options?.headers, ...overlay?.headers },
        fetch: { ...options?.fetch, ...overlay?.fetch, signal },
      })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  }))
}
`
    expect(code).toBe(expected)
  })

  it('POST (body method): emits mutationOptions factory + injectMutation hook with `{ body, options? }` variables', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { injectMutation, mutationOptions } from '@tanstack/angular-query-experimental'
import type { CreateMutationOptions } from '@tanstack/angular-query-experimental'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function createItemMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function createItemMutationOptions<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>() {
  return mutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >({
    mutationKey: createItemMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items.post(body, options)
      if (error) throw error
      return data
    },
  })
}

export function injectCreateItem<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>(
  mutationOptions?: CreateMutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  >,
) {
  return injectMutation(() => ({ ...mutationOptions, ...createItemMutationOptions<TError>() }))
}
`
    expect(code).toBe(expected)
  })
})
