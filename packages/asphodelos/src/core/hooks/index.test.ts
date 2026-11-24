import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { Effect } from 'effect'

import { fileSystemLayer } from '../../fsp/index.js'
import { makeQueryHooks } from '../../helper/query.js'
import type { OpenAPI } from '../../openapi/index.js'
import { HOOK_CONFIGS, hooks } from './index.js'

describe('swr generator', () => {
  const swr = (
    openAPI: OpenAPI,
    output: string,
    importPath: string,
    client = 'client',
    basePath?: string,
  ) => makeQueryHooks(openAPI, output, importPath, HOOK_CONFIGS.swr, client, basePath)

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-swr-'))
    process.chdir(dir)
    try {
      await Effect.runPromise(swr(api, 'src/swr.ts', './lib').pipe(Effect.provide(fileSystemLayer)))
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
import useSWRImmutable from 'swr/immutable'
import type { Key, SWRConfiguration } from 'swr'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getGetItemsKey() {
  return ['items', '/items'] as const
}

export function useGetItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: {
  swr?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  > & { swrKey?: Key; enabled?: boolean }
  options?: Parameters<typeof client.items.get>[0]
}) {
  const { swr: swrOptions, options: clientOptions } = options ?? {}
  const { swrKey: customKey, enabled, ...restSwrOptions } = swrOptions ?? {}
  const swrKey = enabled !== false ? (customKey === undefined ? getGetItemsKey() : customKey) : null
  return {
    swrKey,
    ...useSWR<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError
    >(
      swrKey,
      async () => {
        const { data, error } = await client.items.get(clientOptions)
        if (error) throw error
        return data
      },
      restSwrOptions,
    ),
  }
}

export function useImmutableGetItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: {
  swr?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  > & { swrKey?: Key; enabled?: boolean }
  options?: Parameters<typeof client.items.get>[0]
}) {
  const { swr: swrOptions, options: clientOptions } = options ?? {}
  const { swrKey: customKey, enabled, ...restSwrOptions } = swrOptions ?? {}
  const swrKey = enabled !== false ? (customKey === undefined ? getGetItemsKey() : customKey) : null
  return {
    swrKey,
    ...useSWRImmutable<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError
    >(
      swrKey,
      async () => {
        const { data, error } = await client.items.get(clientOptions)
        if (error) throw error
        return data
      },
      restSwrOptions,
    ),
  }
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
import useSWRImmutable from 'swr/immutable'
import type { Key, SWRConfiguration } from 'swr'
import { client } from './lib'

export function getSearchKey() {
  return ['search'] as const
}

export function getGetSearchKey(options: Parameters<typeof client.search.get>[0]) {
  const { headers: _a, fetch: _b, throwHttpError: _c, ...keyArgs } = options ?? {}
  return ['search', '/search', keyArgs] as const
}

export function useGetSearch<
  TError = Exclude<Awaited<ReturnType<typeof client.search.get>>['error'], null>,
>(options: {
  swr?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.search.get>>, { error: null }>['data'],
    TError
  > & { swrKey?: Key; enabled?: boolean }
  options: Parameters<typeof client.search.get>[0]
}) {
  const { swr: swrOptions, options: clientOptions } = options
  const { swrKey: customKey, enabled, ...restSwrOptions } = swrOptions ?? {}
  const swrKey =
    enabled !== false
      ? customKey === undefined
        ? getGetSearchKey(clientOptions)
        : customKey
      : null
  return {
    swrKey,
    ...useSWR<
      Extract<Awaited<ReturnType<typeof client.search.get>>, { error: null }>['data'],
      TError
    >(
      swrKey,
      async () => {
        const { data, error } = await client.search.get(clientOptions)
        if (error) throw error
        return data
      },
      restSwrOptions,
    ),
  }
}

export function useImmutableGetSearch<
  TError = Exclude<Awaited<ReturnType<typeof client.search.get>>['error'], null>,
>(options: {
  swr?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.search.get>>, { error: null }>['data'],
    TError
  > & { swrKey?: Key; enabled?: boolean }
  options: Parameters<typeof client.search.get>[0]
}) {
  const { swr: swrOptions, options: clientOptions } = options
  const { swrKey: customKey, enabled, ...restSwrOptions } = swrOptions ?? {}
  const swrKey =
    enabled !== false
      ? customKey === undefined
        ? getGetSearchKey(clientOptions)
        : customKey
      : null
  return {
    swrKey,
    ...useSWRImmutable<
      Extract<Awaited<ReturnType<typeof client.search.get>>, { error: null }>['data'],
      TError
    >(
      swrKey,
      async () => {
        const { data, error } = await client.search.get(clientOptions)
        if (error) throw error
        return data
      },
      restSwrOptions,
    ),
  }
}
`
    expect(code).toBe(expected)
  })

  it('GET with x-pagination: also emits an infinite key getter + useSWRInfinite with pagination.getRequestArgs', async () => {
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
import useSWRImmutable from 'swr/immutable'
import type { Key, SWRConfiguration } from 'swr'
import useSWRInfinite from 'swr/infinite'
import type { SWRInfiniteConfiguration } from 'swr/infinite'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getGetItemsKey() {
  return ['items', '/items'] as const
}

export function useGetItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: {
  swr?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  > & { swrKey?: Key; enabled?: boolean }
  options?: Parameters<typeof client.items.get>[0]
}) {
  const { swr: swrOptions, options: clientOptions } = options ?? {}
  const { swrKey: customKey, enabled, ...restSwrOptions } = swrOptions ?? {}
  const swrKey = enabled !== false ? (customKey === undefined ? getGetItemsKey() : customKey) : null
  return {
    swrKey,
    ...useSWR<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError
    >(
      swrKey,
      async () => {
        const { data, error } = await client.items.get(clientOptions)
        if (error) throw error
        return data
      },
      restSwrOptions,
    ),
  }
}

export function useImmutableGetItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: {
  swr?: SWRConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  > & { swrKey?: Key; enabled?: boolean }
  options?: Parameters<typeof client.items.get>[0]
}) {
  const { swr: swrOptions, options: clientOptions } = options ?? {}
  const { swrKey: customKey, enabled, ...restSwrOptions } = swrOptions ?? {}
  const swrKey = enabled !== false ? (customKey === undefined ? getGetItemsKey() : customKey) : null
  return {
    swrKey,
    ...useSWRImmutable<
      Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      TError
    >(
      swrKey,
      async () => {
        const { data, error } = await client.items.get(clientOptions)
        if (error) throw error
        return data
      },
      restSwrOptions,
    ),
  }
}

export function getGetItemsInfiniteKey() {
  return ['items', '/items', 'infinite'] as const
}

export function useInfiniteGetItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options: {
  swr?: SWRInfiniteConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError
  > & {
    swrKey?: (
      index: number,
      previousPageData:
        | Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data']
        | null,
    ) => readonly [...ReturnType<typeof getGetItemsInfiniteKey>, number] | null
    enabled?: boolean
  }
  options?: Parameters<typeof client.items.get>[0]
  pagination: {
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      index: number,
    ) => Parameters<typeof client.items.get>[0]
  }
}) {
  const { swr: swrOptions, options: clientOptions, pagination } = options
  const { swrKey: customKeyLoader, enabled, ...restSwrOptions } = swrOptions ?? {}
  const keyLoader =
    enabled !== false
      ? (customKeyLoader ?? ((index: number) => [...getGetItemsInfiniteKey(), index] as const))
      : () => null
  return useSWRInfinite(
    keyLoader,
    async ([, , , index]: readonly [...ReturnType<typeof getGetItemsInfiniteKey>, number]) => {
      const page = pagination.getRequestArgs(clientOptions, index)
      const { data, error } = await client.items.get(page)
      if (error) throw error
      return data
    },
    restSwrOptions,
  )
}
`
    expect(code).toBe(expected)
  })

  it('GET on a path key with its own query string: the fetch fallback appends the query with `&`', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/jobs/{id}?beta=true': {
          get: {
            operationId: 'getJobBeta',
            parameters: [
              { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
              { name: 'limit', in: 'query', schema: { type: 'integer' } },
            ],
            responses: { '204': { description: 'ok' } },
          },
        },
      },
    })
    expect(code).toContain('?beta=true${search.size ? `&${search}`')
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
import useSWRImmutable from 'swr/immutable'
import type { Key, SWRConfiguration } from 'swr'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getGetItemsIdKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', params] as const
}

export function useGetItemsId<
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: {
    swr?: SWRConfiguration<
      Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
      TError
    > & { swrKey?: Key; enabled?: boolean }
    options?: Parameters<ReturnType<typeof client.items>['get']>[0]
  },
) {
  const { swr: swrOptions, options: clientOptions } = options ?? {}
  const { swrKey: customKey, enabled, ...restSwrOptions } = swrOptions ?? {}
  const swrKey =
    enabled !== false ? (customKey === undefined ? getGetItemsIdKey(params) : customKey) : null
  return {
    swrKey,
    ...useSWR<
      Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
      TError
    >(
      swrKey,
      async () => {
        const { data, error } = await client.items(params).get(clientOptions)
        if (error) throw error
        return data
      },
      restSwrOptions,
    ),
  }
}

export function useImmutableGetItemsId<
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: {
    swr?: SWRConfiguration<
      Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
      TError
    > & { swrKey?: Key; enabled?: boolean }
    options?: Parameters<ReturnType<typeof client.items>['get']>[0]
  },
) {
  const { swr: swrOptions, options: clientOptions } = options ?? {}
  const { swrKey: customKey, enabled, ...restSwrOptions } = swrOptions ?? {}
  const swrKey =
    enabled !== false ? (customKey === undefined ? getGetItemsIdKey(params) : customKey) : null
  return {
    swrKey,
    ...useSWRImmutable<
      Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
      TError
    >(
      swrKey,
      async () => {
        const { data, error } = await client.items(params).get(clientOptions)
        if (error) throw error
        return data
      },
      restSwrOptions,
    ),
  }
}
`
    expect(code).toBe(expected)
  })

  it('POST (body method): emits useSWRMutation with `{ body, options? }` variables and a swrKey override', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          post: { operationId: 'createItem', responses: { '201': { description: 'ok' } } },
        },
      },
    })
    const expected = `import type { Key } from 'swr'
import useSWRMutation from 'swr/mutation'
import type { SWRMutationConfiguration } from 'swr/mutation'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getPostItemsKey() {
  return ['items', '/items', 'POST'] as const
}

export function usePostItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
>(options?: {
  mutation?: SWRMutationConfiguration<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    Key,
    {
      body?: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    }
  > & { swrKey?: Key; throwOnError?: boolean }
}) {
  const { mutation: mutationOptions } = options ?? {}
  const { swrKey: customKey, ...restMutationOptions } = mutationOptions ?? {}
  const swrKey = customKey ?? getPostItemsKey()
  return {
    swrKey,
    ...useSWRMutation<
      Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
      TError,
      Key,
      {
        body?: Parameters<typeof client.items.post>[0]
        options?: Parameters<typeof client.items.post>[1]
      }
    >(
      swrKey,
      async (
        _key: Key,
        {
          arg,
        }: {
          arg: {
            body?: Parameters<typeof client.items.post>[0]
            options?: Parameters<typeof client.items.post>[1]
          }
        },
      ) => {
        const { data, error } = await client.items.post(arg.body, arg.options)
        if (error) throw error
        return data
      },
      restMutationOptions,
    ),
  }
}
`
    expect(code).toBe(expected)
  })

  it('DELETE (body method, no request body): emits useSWRMutation with `{ body?; options? }` variables', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items/{id}': {
          delete: { operationId: 'deleteItem', responses: { '204': { description: 'ok' } } },
        },
      },
    })
    const expected = `import type { Key } from 'swr'
import useSWRMutation from 'swr/mutation'
import type { SWRMutationConfiguration } from 'swr/mutation'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getDeleteItemsIdKey() {
  return ['items', '/items/{id}', 'DELETE'] as const
}

export function useDeleteItemsId<
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: {
    mutation?: SWRMutationConfiguration<
      Extract<
        Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>,
        { error: null }
      >['data'],
      TError,
      Key,
      {
        body?: Parameters<ReturnType<typeof client.items>['delete']>[0]
        options?: Parameters<ReturnType<typeof client.items>['delete']>[1]
      }
    > & { swrKey?: Key; throwOnError?: boolean }
  },
) {
  const { mutation: mutationOptions } = options ?? {}
  const { swrKey: customKey, ...restMutationOptions } = mutationOptions ?? {}
  const swrKey = customKey ?? getDeleteItemsIdKey()
  return {
    swrKey,
    ...useSWRMutation<
      Extract<
        Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>,
        { error: null }
      >['data'],
      TError,
      Key,
      {
        body?: Parameters<ReturnType<typeof client.items>['delete']>[0]
        options?: Parameters<ReturnType<typeof client.items>['delete']>[1]
      }
    >(
      swrKey,
      async (
        _key: Key,
        {
          arg,
        }: {
          arg: {
            body?: Parameters<ReturnType<typeof client.items>['delete']>[0]
            options?: Parameters<ReturnType<typeof client.items>['delete']>[1]
          }
        },
      ) => {
        const { data, error } = await client.items(params).delete(arg.body, arg.options)
        if (error) throw error
        return data
      },
      restMutationOptions,
    ),
  }
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input (no operations)', async () => {
    const result = await Effect.runPromise(
      swr(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/swr.ts',
        './lib',
      ).pipe(Effect.provide(fileSystemLayer)),
    )
    expect(result).toStrictEqual('No operations found')
  })

  // Eden cannot type a segment that mixes a parameter with static text, so the hook falls back
  // to `fetch` and types its data by the response's component — whose schema const has to be
  // imported from the schemas module the config writes. Only the const is exported by default
  // (its type alias, `Account`, needs `exportTypes`), so the data is `Static` of it.
  it('imports the response component a fetch fallback hook is typed by', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-swr-fetch-'))
    process.chdir(dir)
    try {
      await Effect.runPromise(
        makeQueryHooks(
          {
            openapi: '3.1.0',
            info: { title: 'T', version: '0' },
            paths: {
              '/Accounts/{Sid}.json': {
                get: {
                  operationId: 'fetchAccount',
                  parameters: [
                    { name: 'Sid', in: 'path', required: true, schema: { type: 'string' } },
                  ],
                  responses: {
                    '200': {
                      description: 'ok',
                      content: {
                        'application/json': {
                          schema: { $ref: '#/components/schemas/Account' },
                        },
                      },
                    },
                  },
                },
              },
            },
            components: { schemas: { Account: { type: 'object' } } },
          },
          'src/hooks/swr.ts',
          '../client',
          HOOK_CONFIGS.swr,
          'client',
          undefined,
          '../components/schemas',
        ).pipe(Effect.provide(fileSystemLayer)),
      )
      const code = readFileSync(path.join(dir, 'src/hooks/swr.ts'), 'utf8')
      expect(code).toContain("import type { Static } from 'elysia'")
      expect(code).toContain("import type { AccountSchema } from '../components/schemas'")
      expect(code).toContain('useSWR<Static<typeof AccountSchema>, TError>')
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
    )

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-tq-'))
    process.chdir(dir)
    try {
      await Effect.runPromise(
        tanstackQuery(api, 'src/tanstack.ts', './lib').pipe(Effect.provide(fileSystemLayer)),
      )
      return readFileSync(path.join(dir, 'src/tanstack.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('GET (simple, no pagination): emits keyGetter + queryOptions factory + useQuery + useSuspenseQuery taking `{ query, options }` and a queryClient', async () => {
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
import type { UseQueryOptions, UseSuspenseQueryOptions, QueryClient } from '@tanstack/react-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsQueryKey() {
  return ['items', '/items'] as const
}

export function getItemsQueryOptions<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsQueryKey>
  >({
    queryKey: getItemsQueryKey(),
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

export function useItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: {
    query?: Omit<
      UseQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useQuery(
    { ...getItemsQueryOptions<TData, TError>(clientOptions), ...queryOptions },
    queryClient,
  )
}

export function useSuspenseItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: {
    query?: Omit<
      UseSuspenseQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useSuspenseQuery(
    { ...getItemsQueryOptions<TData, TError>(clientOptions), ...queryOptions },
    queryClient,
  )
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
    const expected = `import {
  useQuery,
  useSuspenseQuery,
  useInfiniteQuery,
  useSuspenseInfiniteQuery,
  queryOptions,
  infiniteQueryOptions,
} from '@tanstack/react-query'
import type {
  UseQueryOptions,
  QueryFunctionContext,
  UseSuspenseQueryOptions,
  UseInfiniteQueryOptions,
  UseSuspenseInfiniteQueryOptions,
  InfiniteData,
  QueryClient,
} from '@tanstack/react-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsQueryKey() {
  return ['items', '/items'] as const
}

export function getItemsQueryOptions<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsQueryKey>
  >({
    queryKey: getItemsQueryKey(),
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

export function useItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: {
    query?: Omit<
      UseQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useQuery(
    { ...getItemsQueryOptions<TData, TError>(clientOptions), ...queryOptions },
    queryClient,
  )
}

export function useSuspenseItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: {
    query?: Omit<
      UseSuspenseQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useSuspenseQuery(
    { ...getItemsQueryOptions<TData, TError>(clientOptions), ...queryOptions },
    queryClient,
  )
}

export function getItemsInfiniteQueryKey() {
  return ['items', '/items', 'infinite'] as const
}

export function getItemsInfiniteQueryOptions<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      pageParam: unknown,
    ) => Parameters<typeof client.items.get>[0]
  },
  options?: Parameters<typeof client.items.get>[0],
) {
  return infiniteQueryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsInfiniteQueryKey>,
    TPageParam
  >({
    queryKey: getItemsInfiniteQueryKey(),
    queryFn: async ({
      pageParam,
      signal,
    }: QueryFunctionContext<ReturnType<typeof getItemsInfiniteQueryKey>, TPageParam>) => {
      const page = pagination.getRequestArgs(options, pageParam)
      const { data, error } = await client.items.get({ ...page, fetch: { ...page?.fetch, signal } })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  })
}

export function useInfiniteItems<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      pageParam: unknown,
    ) => Parameters<typeof client.items.get>[0]
  },
  options?: {
    query?: Omit<
      UseInfiniteQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsInfiniteQueryKey>,
        TPageParam
      >,
      'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useInfiniteQuery(
    {
      ...getItemsInfiniteQueryOptions<TPageParam, TData, TError>(pagination, clientOptions),
      ...queryOptions,
    },
    queryClient,
  )
}

export function useSuspenseInfiniteItems<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      pageParam: unknown,
    ) => Parameters<typeof client.items.get>[0]
  },
  options?: {
    query?: Omit<
      UseSuspenseInfiniteQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsInfiniteQueryKey>,
        TPageParam
      >,
      'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useSuspenseInfiniteQuery(
    {
      ...getItemsInfiniteQueryOptions<TPageParam, TData, TError>(pagination, clientOptions),
      ...queryOptions,
    },
    queryClient,
  )
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
import type { UseQueryOptions, UseSuspenseQueryOptions, QueryClient } from '@tanstack/react-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsIdQueryKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', params] as const
}

export function getItemsIdQueryOptions<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
) {
  return queryOptions<
    Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsIdQueryKey>
  >({
    queryKey: getItemsIdQueryKey(params),
    queryFn: async ({ signal }) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}

export function useItemsId<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: {
    query?: Omit<
      UseQueryOptions<
        Extract<
          Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
          { error: null }
        >['data'],
        TError,
        TData,
        ReturnType<typeof getItemsIdQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<ReturnType<typeof client.items>['get']>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useQuery(
    { ...getItemsIdQueryOptions<TData, TError>(params, clientOptions), ...queryOptions },
    queryClient,
  )
}

export function useSuspenseItemsId<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: {
    query?: Omit<
      UseSuspenseQueryOptions<
        Extract<
          Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
          { error: null }
        >['data'],
        TError,
        TData,
        ReturnType<typeof getItemsIdQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<ReturnType<typeof client.items>['get']>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useSuspenseQuery(
    { ...getItemsIdQueryOptions<TData, TError>(params, clientOptions), ...queryOptions },
    queryClient,
  )
}
`
    expect(code).toBe(expected)
  })

  it('GET on /v1/widgets: the raw first segment is the prefix (`v1`), and the name carries the whole path', async () => {
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
import type { UseQueryOptions, UseSuspenseQueryOptions, QueryClient } from '@tanstack/react-query'
import { client } from './lib'

export function getV1Key() {
  return ['v1'] as const
}

export function getV1WidgetsQueryKey() {
  return ['v1', '/v1/widgets'] as const
}

export function getV1WidgetsQueryOptions<
  TData = Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.v1.widgets.get>>['error'], null>,
>(options?: Parameters<typeof client.v1.widgets.get>[0]) {
  return queryOptions<
    Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getV1WidgetsQueryKey>
  >({
    queryKey: getV1WidgetsQueryKey(),
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

export function useV1Widgets<
  TData = Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.v1.widgets.get>>['error'], null>,
>(
  options?: {
    query?: Omit<
      UseQueryOptions<
        Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getV1WidgetsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.v1.widgets.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useQuery(
    { ...getV1WidgetsQueryOptions<TData, TError>(clientOptions), ...queryOptions },
    queryClient,
  )
}

export function useSuspenseV1Widgets<
  TData = Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.v1.widgets.get>>['error'], null>,
>(
  options?: {
    query?: Omit<
      UseSuspenseQueryOptions<
        Extract<Awaited<ReturnType<typeof client.v1.widgets.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getV1WidgetsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.v1.widgets.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useSuspenseQuery(
    { ...getV1WidgetsQueryOptions<TData, TError>(clientOptions), ...queryOptions },
    queryClient,
  )
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
import type { UseMutationOptions, QueryClient } from '@tanstack/react-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getPostItemsMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function getPostItemsMutationOptions<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
  TOnMutateResult = unknown,
>() {
  return mutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body?: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    },
    TOnMutateResult
  >({
    mutationKey: getPostItemsMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items.post(body, options)
      if (error) throw error
      return data
    },
  })
}

export function usePostItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
  TOnMutateResult = unknown,
>(
  options?: {
    mutation?: Omit<
      UseMutationOptions<
        Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
        TError,
        {
          body?: Parameters<typeof client.items.post>[0]
          options?: Parameters<typeof client.items.post>[1]
        },
        TOnMutateResult
      >,
      'mutationFn'
    >
  },
  queryClient?: QueryClient,
) {
  const { mutation } = options ?? {}
  const mutationDefaults = getPostItemsMutationOptions<TError, TOnMutateResult>()
  return useMutation(
    {
      ...mutation,
      ...mutationDefaults,
      mutationKey: mutation?.mutationKey ?? mutationDefaults.mutationKey,
    },
    queryClient,
  )
}
`
    expect(code).toBe(expected)
  })

  it('DELETE (body method, no request body): emits mutationOptions factory + useMutation with `{ body?; options? }` variables', async () => {
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
import type { UseMutationOptions, QueryClient } from '@tanstack/react-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getDeleteItemsIdMutationKey() {
  return ['items', '/items/{id}', 'DELETE'] as const
}

export function getDeleteItemsIdMutationOptions<
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>['error'], null>,
  TOnMutateResult = unknown,
>(params: Parameters<typeof client.items>[0]) {
  return mutationOptions<
    Extract<
      Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>,
      { error: null }
    >['data'],
    TError,
    {
      body?: Parameters<ReturnType<typeof client.items>['delete']>[0]
      options?: Parameters<ReturnType<typeof client.items>['delete']>[1]
    },
    TOnMutateResult
  >({
    mutationKey: getDeleteItemsIdMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items(params).delete(body, options)
      if (error) throw error
      return data
    },
  })
}

export function useDeleteItemsId<
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>['error'], null>,
  TOnMutateResult = unknown,
>(
  params: Parameters<typeof client.items>[0],
  options?: {
    mutation?: Omit<
      UseMutationOptions<
        Extract<
          Awaited<ReturnType<ReturnType<typeof client.items>['delete']>>,
          { error: null }
        >['data'],
        TError,
        {
          body?: Parameters<ReturnType<typeof client.items>['delete']>[0]
          options?: Parameters<ReturnType<typeof client.items>['delete']>[1]
        },
        TOnMutateResult
      >,
      'mutationFn'
    >
  },
  queryClient?: QueryClient,
) {
  const { mutation } = options ?? {}
  const mutationDefaults = getDeleteItemsIdMutationOptions<TError, TOnMutateResult>(params)
  return useMutation(
    {
      ...mutation,
      ...mutationDefaults,
      mutationKey: mutation?.mutationKey ?? mutationDefaults.mutationKey,
    },
    queryClient,
  )
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input (no operations)', async () => {
    const result = await Effect.runPromise(
      tanstackQuery(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/tanstack.ts',
        './lib',
      ).pipe(Effect.provide(fileSystemLayer)),
    )
    expect(result).toStrictEqual('No operations found')
  })

  it('packageName arg flows into emitted import (non-default package)', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-tq-pkg-'))
    process.chdir(dir)
    try {
      await Effect.runPromise(
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
          '@example/custom-query',
        ).pipe(Effect.provide(fileSystemLayer)),
      )
      const code = readFileSync(path.join(dir, 'src/tanstack.ts'), 'utf8')
      const expected = `import { useQuery, useSuspenseQuery, queryOptions } from '@example/custom-query'
import type { UseQueryOptions, UseSuspenseQueryOptions, QueryClient } from '@example/custom-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsQueryKey() {
  return ['items', '/items'] as const
}

export function getItemsQueryOptions<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsQueryKey>
  >({
    queryKey: getItemsQueryKey(),
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

export function useItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: {
    query?: Omit<
      UseQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useQuery(
    { ...getItemsQueryOptions<TData, TError>(clientOptions), ...queryOptions },
    queryClient,
  )
}

export function useSuspenseItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: {
    query?: Omit<
      UseSuspenseQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useSuspenseQuery(
    { ...getItemsQueryOptions<TData, TError>(clientOptions), ...queryOptions },
    queryClient,
  )
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
      await Effect.runPromise(
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
        ).pipe(Effect.provide(fileSystemLayer)),
      )
      const code = readFileSync(path.join(dir, 'src/preact.ts'), 'utf8')
      const header = code.slice(0, code.indexOf("import { client } from './lib'"))
      const expected = `import {
  useQuery,
  useSuspenseQuery,
  useInfiniteQuery,
  useSuspenseInfiniteQuery,
  useMutation,
  queryOptions,
  infiniteQueryOptions,
  mutationOptions,
} from '@tanstack/preact-query'
import type {
  UseQueryOptions,
  QueryFunctionContext,
  UseSuspenseQueryOptions,
  UseInfiniteQueryOptions,
  UseSuspenseInfiniteQueryOptions,
  InfiniteData,
  UseMutationOptions,
  QueryClient,
} from '@tanstack/preact-query'
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
  ) => makeQueryHooks(openAPI, output, importPath, HOOK_CONFIGS['vue-query'], client, basePath)

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-vue-'))
    process.chdir(dir)
    try {
      await Effect.runPromise(
        vueQuery(api, 'src/vue.ts', './lib').pipe(Effect.provide(fileSystemLayer)),
      )
      return readFileSync(path.join(dir, 'src/vue.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('GET emits useQuery hook named by path + 5-generic UseQueryOptions', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { useQuery } from '@tanstack/vue-query'
import type { UseQueryOptions, QueryFunctionContext, QueryClient } from '@tanstack/vue-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsQueryKey() {
  return ['items', '/items'] as const
}

export function getItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return {
    queryKey: getItemsQueryKey(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  }
}

export function useItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: {
    query?: Omit<
      Extract<
        UseQueryOptions<
          Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
          TError,
          TData,
          Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
          ReturnType<typeof getItemsQueryKey>
        >,
        { queryKey: unknown }
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useQuery(
    {
      ...queryOptions,
      queryKey: getItemsQueryKey(),
      queryFn: async ({ signal }) => {
        const { data, error } = await client.items.get({
          ...clientOptions,
          fetch: { ...clientOptions?.fetch, signal },
        })
        if (error) throw error
        return data
      },
    },
    queryClient,
  )
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input', async () => {
    const result = await Effect.runPromise(
      vueQuery(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/vue.ts',
        './lib',
      ).pipe(Effect.provide(fileSystemLayer)),
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
    const expected = `import { useQuery } from '@tanstack/vue-query'
import type { UseQueryOptions, QueryFunctionContext, QueryClient } from '@tanstack/vue-query'
import { computed, toValue } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsIdQueryKey(params: MaybeRefOrGetter<Parameters<typeof client.items>[0]>) {
  return ['items', '/items/{id}', toValue(params)] as const
}

export function getItemsIdQueryOptions(
  params: MaybeRefOrGetter<Parameters<typeof client.items>[0]>,
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
) {
  return {
    queryKey: computed(() => getItemsIdQueryKey(params)),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client
        .items(toValue(params))
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  }
}

export function useItemsId<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: MaybeRefOrGetter<Parameters<typeof client.items>[0]>,
  options?: {
    query?: Omit<
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
          ReturnType<typeof getItemsIdQueryKey>
        >,
        { queryKey: unknown }
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<ReturnType<typeof client.items>['get']>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useQuery(
    {
      ...queryOptions,
      queryKey: computed(() => getItemsIdQueryKey(params)),
      queryFn: async ({ signal }) => {
        const { data, error } = await client
          .items(toValue(params))
          .get({ ...clientOptions, fetch: { ...clientOptions?.fetch, signal } })
        if (error) throw error
        return data
      },
    },
    queryClient,
  )
}
`
    expect(code).toBe(expected)
  })

  it('GET with x-pagination: also emits Infinite key getter + plain factory + useInfiniteQuery hook taking `pagination.getRequestArgs`', async () => {
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
    const expected = `import { useQuery, useInfiniteQuery } from '@tanstack/vue-query'
import type {
  UseQueryOptions,
  QueryFunctionContext,
  UseInfiniteQueryOptions,
  InfiniteData,
  QueryClient,
} from '@tanstack/vue-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsQueryKey() {
  return ['items', '/items'] as const
}

export function getItemsQueryOptions(options?: Parameters<typeof client.items.get>[0]) {
  return {
    queryKey: getItemsQueryKey(),
    queryFn: async ({ signal }: QueryFunctionContext) => {
      const { data, error } = await client.items.get({
        ...options,
        fetch: { ...options?.fetch, signal },
      })
      if (error) throw error
      return data
    },
  }
}

export function useItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: {
    query?: Omit<
      Extract<
        UseQueryOptions<
          Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
          TError,
          TData,
          Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
          ReturnType<typeof getItemsQueryKey>
        >,
        { queryKey: unknown }
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options ?? {}
  return useQuery(
    {
      ...queryOptions,
      queryKey: getItemsQueryKey(),
      queryFn: async ({ signal }) => {
        const { data, error } = await client.items.get({
          ...clientOptions,
          fetch: { ...clientOptions?.fetch, signal },
        })
        if (error) throw error
        return data
      },
    },
    queryClient,
  )
}

export function getItemsInfiniteQueryKey() {
  return ['items', '/items', 'infinite'] as const
}

export function getItemsInfiniteQueryOptions<TPageParam = unknown>(
  pagination: {
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      pageParam: unknown,
    ) => Parameters<typeof client.items.get>[0]
  },
  options?: Parameters<typeof client.items.get>[0],
) {
  return {
    queryKey: getItemsInfiniteQueryKey(),
    queryFn: async ({
      pageParam,
      signal,
    }: QueryFunctionContext<ReturnType<typeof getItemsInfiniteQueryKey>, TPageParam>) => {
      const page = pagination.getRequestArgs(options, pageParam)
      const { data, error } = await client.items.get({ ...page, fetch: { ...page?.fetch, signal } })
      if (error) throw error
      return data
    },
  }
}

export function useInfiniteItems<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  pagination: {
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      pageParam: unknown,
    ) => Parameters<typeof client.items.get>[0]
  },
  options: {
    query: Omit<
      Extract<
        UseInfiniteQueryOptions<
          Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
          TError,
          TData,
          ReturnType<typeof getItemsInfiniteQueryKey>,
          TPageParam
        >,
        { queryKey: unknown }
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: QueryClient,
) {
  const { query: queryOptions, options: clientOptions } = options
  return useInfiniteQuery(
    {
      ...queryOptions,
      queryKey: getItemsInfiniteQueryKey(),
      queryFn: async ({
        pageParam,
        signal,
      }: QueryFunctionContext<ReturnType<typeof getItemsInfiniteQueryKey>, TPageParam>) => {
        const page = pagination.getRequestArgs(clientOptions, pageParam)
        const { data, error } = await client.items.get({
          ...page,
          fetch: { ...page?.fetch, signal },
        })
        if (error) throw error
        return data
      },
    },
    queryClient,
  )
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
import type { UseMutationOptions, QueryClient } from '@tanstack/vue-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getPostItemsMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function getPostItemsMutationOptions<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
  TOnMutateResult = unknown,
>() {
  return mutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body?: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    },
    TOnMutateResult
  >({
    mutationKey: getPostItemsMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items.post(body, options)
      if (error) throw error
      return data
    },
  })
}

export function usePostItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
  TOnMutateResult = unknown,
>(
  options?: {
    mutation?: Omit<
      Extract<
        UseMutationOptions<
          Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
          TError,
          {
            body?: Parameters<typeof client.items.post>[0]
            options?: Parameters<typeof client.items.post>[1]
          },
          TOnMutateResult
        >,
        { mutationFn?: unknown }
      >,
      'mutationFn'
    >
  },
  queryClient?: QueryClient,
) {
  const { mutation } = options ?? {}
  const mutationDefaults = getPostItemsMutationOptions<TError, TOnMutateResult>()
  return useMutation(
    {
      ...mutation,
      ...mutationDefaults,
      mutationKey: mutation?.mutationKey ?? mutationDefaults.mutationKey,
    },
    queryClient,
  )
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
  ) => makeQueryHooks(openAPI, output, importPath, HOOK_CONFIGS['solid-query'], client, basePath)

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-solid-'))
    process.chdir(dir)
    try {
      await Effect.runPromise(
        solidQuery(api, 'src/solid.ts', './lib').pipe(Effect.provide(fileSystemLayer)),
      )
      return readFileSync(path.join(dir, 'src/solid.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('GET emits createQuery hook named by path + accessor wrap', async () => {
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
import type { UndefinedInitialDataOptions, QueryClient } from '@tanstack/solid-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsQueryKey() {
  return ['items', '/items'] as const
}

export function getItemsQueryOptions<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsQueryKey>
  >({
    queryKey: getItemsQueryKey(),
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

export function createItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: () => {
    query?: Omit<
      ReturnType<
        UndefinedInitialDataOptions<
          Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
          TError,
          TData,
          ReturnType<typeof getItemsQueryKey>
        >
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: () => QueryClient,
) {
  return createQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsQueryOptions<TData, TError>(clientOptions), ...query }
  }, queryClient)
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input', async () => {
    const result = await Effect.runPromise(
      solidQuery(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/solid.ts',
        './lib',
      ).pipe(Effect.provide(fileSystemLayer)),
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
import type { UndefinedInitialDataOptions, QueryClient } from '@tanstack/solid-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsIdQueryKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', params] as const
}

export function getItemsIdQueryOptions<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
) {
  return queryOptions<
    Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsIdQueryKey>
  >({
    queryKey: getItemsIdQueryKey(params),
    queryFn: async ({ signal }) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}

export function createItemsId<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: () => Parameters<typeof client.items>[0],
  options?: () => {
    query?: Omit<
      ReturnType<
        UndefinedInitialDataOptions<
          Extract<
            Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
            { error: null }
          >['data'],
          TError,
          TData,
          ReturnType<typeof getItemsIdQueryKey>
        >
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<ReturnType<typeof client.items>['get']>[0]
  },
  queryClient?: () => QueryClient,
) {
  return createQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsIdQueryOptions<TData, TError>(params(), clientOptions), ...query }
  }, queryClient)
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
    const expected = `import {
  createQuery,
  createInfiniteQuery,
  queryOptions,
  infiniteQueryOptions,
} from '@tanstack/solid-query'
import type {
  UndefinedInitialDataOptions,
  QueryFunctionContext,
  UndefinedInitialDataInfiniteOptions,
  InfiniteData,
  QueryClient,
} from '@tanstack/solid-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsQueryKey() {
  return ['items', '/items'] as const
}

export function getItemsQueryOptions<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsQueryKey>
  >({
    queryKey: getItemsQueryKey(),
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

export function createItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: () => {
    query?: Omit<
      ReturnType<
        UndefinedInitialDataOptions<
          Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
          TError,
          TData,
          ReturnType<typeof getItemsQueryKey>
        >
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: () => QueryClient,
) {
  return createQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsQueryOptions<TData, TError>(clientOptions), ...query }
  }, queryClient)
}

export function getItemsInfiniteQueryKey() {
  return ['items', '/items', 'infinite'] as const
}

export function getItemsInfiniteQueryOptions<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      pageParam: unknown,
    ) => Parameters<typeof client.items.get>[0]
  },
  options?: Parameters<typeof client.items.get>[0],
) {
  return infiniteQueryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsInfiniteQueryKey>,
    TPageParam
  >({
    queryKey: getItemsInfiniteQueryKey(),
    queryFn: async ({
      pageParam,
      signal,
    }: QueryFunctionContext<ReturnType<typeof getItemsInfiniteQueryKey>, TPageParam>) => {
      const page = pagination.getRequestArgs(options, pageParam)
      const { data, error } = await client.items.get({ ...page, fetch: { ...page?.fetch, signal } })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  })
}

export function createInfiniteItems<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      pageParam: unknown,
    ) => Parameters<typeof client.items.get>[0]
  },
  options?: () => {
    query?: Omit<
      ReturnType<
        UndefinedInitialDataInfiniteOptions<
          Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
          TError,
          TData,
          ReturnType<typeof getItemsInfiniteQueryKey>,
          TPageParam
        >
      >,
      'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: () => QueryClient,
) {
  return createInfiniteQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return {
      ...getItemsInfiniteQueryOptions<TPageParam, TData, TError>(pagination, clientOptions),
      ...query,
    }
  }, queryClient)
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
import type { CreateMutationOptions, QueryClient } from '@tanstack/solid-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getPostItemsMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function getPostItemsMutationOptions<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
  TOnMutateResult = unknown,
>() {
  return mutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body?: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    },
    TOnMutateResult
  >({
    mutationKey: getPostItemsMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items.post(body, options)
      if (error) throw error
      return data
    },
  })
}

export function createPostItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
  TOnMutateResult = unknown,
>(
  options?: () => {
    mutation?: Omit<
      ReturnType<
        CreateMutationOptions<
          Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
          TError,
          {
            body?: Parameters<typeof client.items.post>[0]
            options?: Parameters<typeof client.items.post>[1]
          },
          TOnMutateResult
        >
      >,
      'mutationFn'
    >
  },
  queryClient?: () => QueryClient,
) {
  return createMutation(() => {
    const { mutation } = options?.() ?? {}
    const mutationDefaults = getPostItemsMutationOptions<TError, TOnMutateResult>()
    return {
      ...mutation,
      ...mutationDefaults,
      mutationKey: mutation?.mutationKey ?? mutationDefaults.mutationKey,
    }
  }, queryClient)
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
  ) => makeQueryHooks(openAPI, output, importPath, HOOK_CONFIGS['svelte-query'], client, basePath)

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-svelte-'))
    process.chdir(dir)
    try {
      await Effect.runPromise(
        svelteQuery(api, 'src/svelte.ts', './lib').pipe(Effect.provide(fileSystemLayer)),
      )
      return readFileSync(path.join(dir, 'src/svelte.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('GET emits createQuery hook named by path + key getter + queryOptions factory', async () => {
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
import type { CreateQueryOptions, QueryClient } from '@tanstack/svelte-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsQueryKey() {
  return ['items', '/items'] as const
}

export function getItemsQueryOptions<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsQueryKey>
  >({
    queryKey: getItemsQueryKey(),
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

export function createItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: () => {
    query?: Omit<
      CreateQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: () => QueryClient,
) {
  return createQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsQueryOptions<TData, TError>(clientOptions), ...query }
  }, queryClient)
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input', async () => {
    const result = await Effect.runPromise(
      svelteQuery(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/svelte.ts',
        './lib',
      ).pipe(Effect.provide(fileSystemLayer)),
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
import type { CreateQueryOptions, QueryClient } from '@tanstack/svelte-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsIdQueryKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', params] as const
}

export function getItemsIdQueryOptions<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
) {
  return queryOptions<
    Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsIdQueryKey>
  >({
    queryKey: getItemsIdQueryKey(params),
    queryFn: async ({ signal }) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}

export function createItemsId<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: () => Parameters<typeof client.items>[0],
  options?: () => {
    query?: Omit<
      CreateQueryOptions<
        Extract<
          Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
          { error: null }
        >['data'],
        TError,
        TData,
        ReturnType<typeof getItemsIdQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<ReturnType<typeof client.items>['get']>[0]
  },
  queryClient?: () => QueryClient,
) {
  return createQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsIdQueryOptions<TData, TError>(params(), clientOptions), ...query }
  }, queryClient)
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
    const expected = `import {
  createQuery,
  createInfiniteQuery,
  queryOptions,
  infiniteQueryOptions,
} from '@tanstack/svelte-query'
import type {
  CreateQueryOptions,
  QueryFunctionContext,
  CreateInfiniteQueryOptions,
  InfiniteData,
  QueryClient,
} from '@tanstack/svelte-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsQueryKey() {
  return ['items', '/items'] as const
}

export function getItemsQueryOptions<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsQueryKey>
  >({
    queryKey: getItemsQueryKey(),
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

export function createItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: () => {
    query?: Omit<
      CreateQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: () => QueryClient,
) {
  return createQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsQueryOptions<TData, TError>(clientOptions), ...query }
  }, queryClient)
}

export function getItemsInfiniteQueryKey() {
  return ['items', '/items', 'infinite'] as const
}

export function getItemsInfiniteQueryOptions<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      pageParam: unknown,
    ) => Parameters<typeof client.items.get>[0]
  },
  options?: Parameters<typeof client.items.get>[0],
) {
  return infiniteQueryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsInfiniteQueryKey>,
    TPageParam
  >({
    queryKey: getItemsInfiniteQueryKey(),
    queryFn: async ({
      pageParam,
      signal,
    }: QueryFunctionContext<ReturnType<typeof getItemsInfiniteQueryKey>, TPageParam>) => {
      const page = pagination.getRequestArgs(options, pageParam)
      const { data, error } = await client.items.get({ ...page, fetch: { ...page?.fetch, signal } })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  })
}

export function createInfiniteItems<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      pageParam: unknown,
    ) => Parameters<typeof client.items.get>[0]
  },
  options?: () => {
    query?: Omit<
      CreateInfiniteQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsInfiniteQueryKey>,
        TPageParam
      >,
      'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
  queryClient?: () => QueryClient,
) {
  return createInfiniteQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return {
      ...getItemsInfiniteQueryOptions<TPageParam, TData, TError>(pagination, clientOptions),
      ...query,
    }
  }, queryClient)
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
import type { CreateMutationOptions, QueryClient } from '@tanstack/svelte-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getPostItemsMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function getPostItemsMutationOptions<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
  TOnMutateResult = unknown,
>() {
  return mutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body?: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    },
    TOnMutateResult
  >({
    mutationKey: getPostItemsMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items.post(body, options)
      if (error) throw error
      return data
    },
  })
}

export function createPostItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
  TOnMutateResult = unknown,
>(
  options?: () => {
    mutation?: Omit<
      CreateMutationOptions<
        Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
        TError,
        {
          body?: Parameters<typeof client.items.post>[0]
          options?: Parameters<typeof client.items.post>[1]
        },
        TOnMutateResult
      >,
      'mutationFn'
    >
  },
  queryClient?: () => QueryClient,
) {
  return createMutation(() => {
    const { mutation } = options?.() ?? {}
    const mutationDefaults = getPostItemsMutationOptions<TError, TOnMutateResult>()
    return {
      ...mutation,
      ...mutationDefaults,
      mutationKey: mutation?.mutationKey ?? mutationDefaults.mutationKey,
    }
  }, queryClient)
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
  ) => makeQueryHooks(openAPI, output, importPath, HOOK_CONFIGS['angular-query'], client, basePath)

  const generateAndRead = async (api: OpenAPI): Promise<string> => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-angular-'))
    process.chdir(dir)
    try {
      await Effect.runPromise(
        angularQuery(api, 'src/angular.ts', './lib').pipe(Effect.provide(fileSystemLayer)),
      )
      return readFileSync(path.join(dir, 'src/angular.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it('GET emits injectQuery hook named by path + accessor wrap (DI factory)', async () => {
    const code = await generateAndRead({
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {
        '/items': {
          get: { operationId: 'listItems', responses: { '200': { description: 'ok' } } },
        },
      },
    })
    const expected = `import { injectQuery, queryOptions } from '@tanstack/angular-query'
import type { CreateQueryOptions } from '@tanstack/angular-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsQueryKey() {
  return ['items', '/items'] as const
}

export function getItemsQueryOptions<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsQueryKey>
  >({
    queryKey: getItemsQueryKey(),
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

export function injectItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: () => {
    query?: Omit<
      CreateQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
) {
  return injectQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsQueryOptions<TData, TError>(clientOptions), ...query }
  })
}
`
    expect(code).toBe(expected)
  })

  it('returns no-op marker for empty input', async () => {
    const result = await Effect.runPromise(
      angularQuery(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/angular.ts',
        './lib',
      ).pipe(Effect.provide(fileSystemLayer)),
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
    const expected = `import { injectQuery, queryOptions } from '@tanstack/angular-query'
import type { CreateQueryOptions } from '@tanstack/angular-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsIdQueryKey(params: Parameters<typeof client.items>[0]) {
  return ['items', '/items/{id}', params] as const
}

export function getItemsIdQueryOptions<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: Parameters<typeof client.items>[0],
  options?: Parameters<ReturnType<typeof client.items>['get']>[0],
) {
  return queryOptions<
    Extract<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsIdQueryKey>
  >({
    queryKey: getItemsIdQueryKey(params),
    queryFn: async ({ signal }) => {
      const { data, error } = await client
        .items(params)
        .get({ ...options, fetch: { ...options?.fetch, signal } })
      if (error) throw error
      return data
    },
  })
}

export function injectItemsId<
  TData = Extract<
    Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
    { error: null }
  >['data'],
  TError = Exclude<Awaited<ReturnType<ReturnType<typeof client.items>['get']>>['error'], null>,
>(
  params: () => Parameters<typeof client.items>[0],
  options?: () => {
    query?: Omit<
      CreateQueryOptions<
        Extract<
          Awaited<ReturnType<ReturnType<typeof client.items>['get']>>,
          { error: null }
        >['data'],
        TError,
        TData,
        ReturnType<typeof getItemsIdQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<ReturnType<typeof client.items>['get']>[0]
  },
) {
  return injectQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsIdQueryOptions<TData, TError>(params(), clientOptions), ...query }
  })
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
    const expected = `import {
  injectQuery,
  injectInfiniteQuery,
  queryOptions,
  infiniteQueryOptions,
} from '@tanstack/angular-query'
import type {
  CreateQueryOptions,
  QueryFunctionContext,
  CreateInfiniteQueryOptions,
  InfiniteData,
} from '@tanstack/angular-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getItemsQueryKey() {
  return ['items', '/items'] as const
}

export function getItemsQueryOptions<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(options?: Parameters<typeof client.items.get>[0]) {
  return queryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsQueryKey>
  >({
    queryKey: getItemsQueryKey(),
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

export function injectItems<
  TData = Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  options?: () => {
    query?: Omit<
      CreateQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsQueryKey>
      >,
      'queryKey' | 'queryFn'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
) {
  return injectQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsQueryOptions<TData, TError>(clientOptions), ...query }
  })
}

export function getItemsInfiniteQueryKey() {
  return ['items', '/items', 'infinite'] as const
}

export function getItemsInfiniteQueryOptions<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      pageParam: unknown,
    ) => Parameters<typeof client.items.get>[0]
  },
  options?: Parameters<typeof client.items.get>[0],
) {
  return infiniteQueryOptions<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TError,
    TData,
    ReturnType<typeof getItemsInfiniteQueryKey>,
    TPageParam
  >({
    queryKey: getItemsInfiniteQueryKey(),
    queryFn: async ({
      pageParam,
      signal,
    }: QueryFunctionContext<ReturnType<typeof getItemsInfiniteQueryKey>, TPageParam>) => {
      const page = pagination.getRequestArgs(options, pageParam)
      const { data, error } = await client.items.get({ ...page, fetch: { ...page?.fetch, signal } })
      if (error) throw error
      return data
    },
    initialPageParam: pagination.initialPageParam,
    getNextPageParam: pagination.getNextPageParam,
  })
}

export function injectInfiniteItems<
  TPageParam = unknown,
  TData = InfiniteData<
    Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
    TPageParam
  >,
  TError = Exclude<Awaited<ReturnType<typeof client.items.get>>['error'], null>,
>(
  pagination: {
    initialPageParam: TPageParam
    getNextPageParam: (
      lastPage: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
      allPages: Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'][],
      lastPageParam: TPageParam,
      allPageParams: TPageParam[],
    ) => TPageParam | undefined | null
    getRequestArgs: (
      options: Parameters<typeof client.items.get>[0],
      pageParam: unknown,
    ) => Parameters<typeof client.items.get>[0]
  },
  options?: () => {
    query?: Omit<
      CreateInfiniteQueryOptions<
        Extract<Awaited<ReturnType<typeof client.items.get>>, { error: null }>['data'],
        TError,
        TData,
        ReturnType<typeof getItemsInfiniteQueryKey>,
        TPageParam
      >,
      'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
    >
    options?: Parameters<typeof client.items.get>[0]
  },
) {
  return injectInfiniteQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return {
      ...getItemsInfiniteQueryOptions<TPageParam, TData, TError>(pagination, clientOptions),
      ...query,
    }
  })
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
    const expected = `import { injectMutation, mutationOptions } from '@tanstack/angular-query'
import type { CreateMutationOptions } from '@tanstack/angular-query'
import { client } from './lib'

export function getItemsKey() {
  return ['items'] as const
}

export function getPostItemsMutationKey() {
  return ['items', '/items', 'POST'] as const
}

export function getPostItemsMutationOptions<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
  TOnMutateResult = unknown,
>() {
  return mutationOptions<
    Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
    TError,
    {
      body?: Parameters<typeof client.items.post>[0]
      options?: Parameters<typeof client.items.post>[1]
    },
    TOnMutateResult
  >({
    mutationKey: getPostItemsMutationKey(),
    mutationFn: async ({ body, options }) => {
      const { data, error } = await client.items.post(body, options)
      if (error) throw error
      return data
    },
  })
}

export function injectPostItems<
  TError = Exclude<Awaited<ReturnType<typeof client.items.post>>['error'], null>,
  TOnMutateResult = unknown,
>(
  options?: () => {
    mutation?: Omit<
      CreateMutationOptions<
        Extract<Awaited<ReturnType<typeof client.items.post>>, { error: null }>['data'],
        TError,
        {
          body?: Parameters<typeof client.items.post>[0]
          options?: Parameters<typeof client.items.post>[1]
        },
        TOnMutateResult
      >,
      'mutationFn'
    >
  },
) {
  return injectMutation(() => {
    const { mutation } = options?.() ?? {}
    const mutationDefaults = getPostItemsMutationOptions<TError, TOnMutateResult>()
    return {
      ...mutation,
      ...mutationDefaults,
      mutationKey: mutation?.mutationKey ?? mutationDefaults.mutationKey,
    }
  })
}
`
    expect(code).toBe(expected)
  })
})

// A path Eden cannot type falls back to `fetch`. Its URL starts at the origin the client module
// exports, so the request goes where the client's do — not to the page's origin, and not to a
// bare path that a runtime without a page rejects. Its path parameters are named the way the
// Eden hooks name theirs, so one the document calls `clientOrigin` or `search` hides nothing.
describe('fetch fallback', () => {
  const api: OpenAPI = {
    openapi: '3.1.0',
    info: { title: 'Widget', version: '1' },
    paths: {
      '/widget.json': {
        get: { operationId: 'getWidget', responses: { '200': { description: 'OK' } } },
        post: { operationId: 'postWidget', responses: { '200': { description: 'OK' } } },
      },
      '/files/{clientOrigin}/{search}.txt': {
        get: {
          operationId: 'getFile',
          parameters: [
            { name: 'clientOrigin', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'search', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'raw', in: 'query', schema: { type: 'boolean' } },
          ],
          responses: { '200': { description: 'OK' } },
        },
      },
    },
  }

  const generateAndRead = async (library: keyof typeof HOOK_CONFIGS, openAPI = api) => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-fetch-'))
    process.chdir(dir)
    try {
      await Effect.runPromise(
        makeQueryHooks(openAPI, 'src/hooks.ts', './lib', HOOK_CONFIGS[library], 'client').pipe(
          Effect.provide(fileSystemLayer),
        ),
      )
      return readFileSync(path.join(dir, 'src/hooks.ts'), 'utf8')
    } finally {
      process.chdir(cwd)
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it.each(['tanstack-query', 'swr'] as const)(
    '%s: queries and mutations fetch from the origin the client module exports',
    async (library) => {
      const code = await generateAndRead(library)
      expect(code).toContain("import { client, clientOrigin } from './lib'")
      expect(code).toContain('await fetch(`${clientOrigin}/widget.json`, {')
      expect(code).toMatch(
        /await fetch\(\s*`\$\{clientOrigin\}\/files\/\$\{encodeURIComponent\(params\)\}\/\$\{encodeURIComponent\(params2\)\}\.txt\$\{search\.size/u,
      )
      expect(code).toContain('params: string,\n  params2: string,')
      expect(code).not.toMatch(/fetch\(`\//u)
    },
  )

  // Eden Treaty turns a date string in a JSON response into a `Date`, and `Static` of a response
  // component says `Date` for a `format: date-time` string. The fallback parses with a reviver of
  // its own, so it hands over what the Eden hooks do and what its type says.
  it.each(['tanstack-query', 'swr'] as const)(
    '%s: a response is parsed with the date reviver',
    async (library) => {
      const code = await generateAndRead(library)
      expect(code).toContain('function reviveDate(_key: string, value: unknown) {')
      expect(code).toContain('JSON.parse(text, reviveDate)')
      expect(code).not.toContain('JSON.parse(text)')
      expect(code).not.toContain('res.json()')
    },
  )

  // The helpers the fallback hooks call, as the hooks file carries them.
  const importHelpers = async () => {
    const code = await generateAndRead('tanstack-query')
    const source = code.slice(code.indexOf('const ISO8601'), code.indexOf('export '))
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-fetch-helpers-'))
    const file = path.join(dir, 'helpers.ts')
    writeFileSync(file, `${source}\nexport { readResponse, toSearch }\n`)
    try {
      return (await import(file)) as {
        readonly readResponse: (res: Response) => Promise<unknown>
        readonly toSearch: (query: { [key: string]: unknown } | undefined) => URLSearchParams
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }

  it.each(['tanstack-query', 'swr'] as const)(
    '%s: queries and mutations read the response and build the search string with the helpers',
    async (library) => {
      const code = await generateAndRead(library)
      expect(code).toContain('return readResponse(res)')
      expect(code).toMatch(/const search = toSearch\(\w+\?\.query\)/u)
      expect(code).not.toContain('String(v)')
    },
  )

  // A response without content is typed `void`: there is no JSON in it to parse.
  it('a response without a body resolves with undefined', async () => {
    const { readResponse } = await importHelpers()
    expect(await readResponse(new Response(null, { status: 204 }))).toBeUndefined()
    expect(await readResponse(new Response('', { status: 200 }))).toBeUndefined()
  })

  it('a JSON response resolves with its dates revived', async () => {
    const { readResponse } = await importHelpers()
    expect(
      await readResponse(Response.json({ id: 1, at: '2026-11-24T03:10:22.000Z' })),
    ).toStrictEqual({ id: 1, at: new Date('2026-11-24T03:10:22.000Z') })
  })

  it('a JSON error body rejects with the body, its dates revived', async () => {
    const { readResponse } = await importHelpers()
    const res = Response.json({ message: 'gone', at: '2026-11-24T03:10:22.000Z' }, { status: 410 })
    expect(await readResponse(res).catch((error: unknown) => error)).toStrictEqual({
      message: 'gone',
      at: new Date('2026-11-24T03:10:22.000Z'),
    })
  })

  // A proxy's HTML page or an empty `404` is not JSON: the error says so by its status and text
  // rather than by the `SyntaxError` of a failed parse.
  it.each([
    { name: 'an HTML page', body: '<html>Bad Gateway</html>', status: 502 },
    { name: 'an empty body', body: '', status: 404 },
  ])('an error with $name rejects with the status and the text', async ({ body, status }) => {
    const { readResponse } = await importHelpers()
    const error = await readResponse(new Response(body, { status })).catch(
      (error_: unknown) => error_,
    )
    expect(error).toBeInstanceOf(Error)
    expect(error).not.toBeInstanceOf(SyntaxError)
    expect(error).toMatchObject({ status, value: body })
  })

  // Eden Treaty sends a `Date` as its ISO string, which a `format: date-time` parameter reads.
  it('a Date in the query is sent as its ISO string', async () => {
    const { toSearch } = await importHelpers()
    const at = new Date('2026-11-24T03:10:22.000Z')
    const search = toSearch({ at, between: [at, 'now'], raw: true, limit: 3 })
    expect([...search]).toStrictEqual([
      ['at', '2026-11-24T03:10:22.000Z'],
      ['between', '2026-11-24T03:10:22.000Z'],
      ['between', 'now'],
      ['raw', 'true'],
      ['limit', '3'],
    ])
    expect([...toSearch(undefined)]).toStrictEqual([])
  })

  // The rest of what Eden Treaty does with a query value: `null` and `undefined` are left out,
  // as a value and as an item, and an object goes out as its JSON.
  it('the query leaves out null and undefined and sends an object as its JSON', async () => {
    const { toSearch } = await importHelpers()
    const search = toSearch({
      skip: undefined,
      cursor: null,
      ids: [1, undefined, null, 2],
      filter: { name: 'a' },
    })
    expect([...search]).toStrictEqual([
      ['ids', '1'],
      ['ids', '2'],
      ['filter', '{"name":"a"}'],
    ])
  })

  it.each(['tanstack-query', 'swr'] as const)(
    '%s: a HEAD operation is sent as HEAD',
    async (library) => {
      const code = await generateAndRead(library, {
        ...api,
        paths: {
          '/widget.json': {
            head: { operationId: 'headWidget', responses: { '200': { description: 'OK' } } },
          },
        },
      })
      expect(code).toMatch(/await fetch\(`\$\{clientOrigin\}\/widget\.json`, \{\s*method: 'HEAD',/u)
    },
  )

  it('a document whose fallbacks take no query carries no search helper', async () => {
    const code = await generateAndRead('tanstack-query', {
      ...api,
      paths: { '/widget.json': api.paths?.['/widget.json'] ?? {} },
    })
    expect(code).toContain('async function readResponse(res: Response) {')
    expect(code).not.toContain('toSearch')
  })

  it('the reviver turns the date strings Eden does into a Date and leaves the rest', async () => {
    const code = await generateAndRead('tanstack-query')
    const source = code.slice(code.indexOf('const ISO8601'), code.indexOf('export '))
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-fetch-reviver-'))
    const file = path.join(dir, 'reviver.ts')
    writeFileSync(file, `${source}\nexport { reviveDate }\n`)
    const { reviveDate } = (await import(file)) as {
      readonly reviveDate: (key: string, value: unknown) => unknown
    }
    rmSync(dir, { recursive: true, force: true })
    const parse = (value: unknown) => JSON.parse(JSON.stringify(value), reviveDate)
    expect(
      parse({
        at: '2026-11-24T03:10:22.000Z',
        offset: '2026-11-24T03:10:22+09:00',
        day: '2026-11-24',
        nested: [{ at: '2026-11-24T03:10Z' }],
      }),
    ).toStrictEqual({
      at: new Date('2026-11-24T03:10:22.000Z'),
      offset: new Date('2026-11-24T03:10:22+09:00'),
      day: new Date('2026-11-24'),
      nested: [{ at: new Date('2026-11-24T03:10Z') }],
    })
    // Eden's patterns, and so its misses: a date-time without an offset and a year outside
    // 1900–2099 stay strings, as they do behind the Eden hooks.
    const plain = {
      name: 'Alice',
      id: '2026',
      count: 3,
      when: '2026-13-45T99:99:99Z',
      naive: '2026-11-24T03:10:22',
      never: '9999-12-31',
      none: null,
    }
    expect(parse(plain)).toStrictEqual(plain)
  })

  // Keys that differ only in case share a pascal-cased name, so the schemas generator writes all
  // but the first under a suffixed const. The hook names the const that was written. A split
  // output resolves the names per file, so there the hook follows the schemas generator into the
  // plain name — which the barrel then exports twice; that is the split generator's to fix (#54).
  describe('a response component whose key collides in case', () => {
    const colliding: OpenAPI = {
      openapi: '3.1.0',
      info: { title: 'Collide', version: '1' },
      paths: {
        '/user.json': {
          get: {
            operationId: 'getUser',
            responses: {
              '200': {
                description: 'OK',
                content: { 'application/json': { schema: { $ref: '#/components/schemas/user' } } },
              },
            },
          },
        },
      },
      components: { schemas: { User: { type: 'object' }, user: { type: 'object' } } },
    }

    const generate = async (split: boolean) => {
      const cwd = process.cwd()
      const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-fetch-names-'))
      process.chdir(dir)
      try {
        await Effect.runPromise(
          hooks(colliding, 'src/hooks.ts', './lib', 'tanstack-query', {
            client: 'client',
            schemas: { output: 'src/schemas.ts', split },
          }).pipe(Effect.provide(fileSystemLayer)),
        )
        return readFileSync(path.join(dir, 'src/hooks.ts'), 'utf8')
      } finally {
        process.chdir(cwd)
        rmSync(dir, { recursive: true, force: true })
      }
    }

    it('is typed by the suffixed const the schemas file exports', async () => {
      const code = await generate(false)
      expect(code).toContain("import type { User2Schema } from './schemas'")
      expect(code).toContain('Static<typeof User2Schema>')
      expect(code).not.toMatch(/\bUserSchema\b/u)
    })

    it('is typed by the name the split schemas generator resolves per file', async () => {
      const code = await generate(true)
      expect(code).toContain("import type { UserSchema } from './schemas'")
      expect(code).toContain('Static<typeof UserSchema>')
    })
  })

  it('a document Eden types throughout imports the client alone', async () => {
    const code = await generateAndRead('tanstack-query', {
      ...api,
      paths: {
        '/widgets': {
          get: { operationId: 'listWidgets', responses: { '200': { description: 'OK' } } },
        },
      },
    })
    expect(code).toContain("import { client } from './lib'")
    expect(code).not.toContain('clientOrigin')
    expect(code).not.toContain('reviveDate')
    expect(code).not.toContain('readResponse')
    expect(code).not.toContain('toSearch')
  })
})
