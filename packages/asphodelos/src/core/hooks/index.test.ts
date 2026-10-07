import { describe, expect, it } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { makeQueryHooks } from '../../helper/query.js'
import type { OpenAPI } from '../../openapi/index.js'
import { runGenerator } from '../../testing/index.js'
import { HOOK_CONFIGS } from './index.js'

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
    const result = await runGenerator(
      swr(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/swr.ts',
        './lib',
      ),
    )
    expect(result).toStrictEqual('No operations found')
  })

  // Eden cannot type a segment that mixes a parameter with static text, so the hook falls back
  // to `fetch` and names its data by the response's component — which has to be imported from
  // the schemas module the config writes.
  it('imports the response component a fetch fallback hook is typed by', async () => {
    const cwd = process.cwd()
    const dir = mkdtempSync(path.join(tmpdir(), 'asphodelos-swr-fetch-'))
    process.chdir(dir)
    try {
      await runGenerator(
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
        ),
      )
      const code = readFileSync(path.join(dir, 'src/hooks/swr.ts'), 'utf8')
      expect(code).toContain("import type { Account } from '../components/schemas'")
      expect(code).toContain('useSWR<Account, TError>')
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
      await runGenerator(tanstackQuery(api, 'src/tanstack.ts', './lib'))
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
    const result = await runGenerator(
      tanstackQuery(
        { openapi: '3.1.0', info: { title: 'T', version: '0' }, paths: {} },
        'src/tanstack.ts',
        './lib',
      ),
    )
    expect(result).toStrictEqual('No operations found')
  })

  it('packageName arg flows into emitted import (non-default package)', async () => {
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
          '@example/custom-query',
        ),
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
      await runGenerator(vueQuery(api, 'src/vue.ts', './lib'))
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
      await runGenerator(solidQuery(api, 'src/solid.ts', './lib'))
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
      await runGenerator(svelteQuery(api, 'src/svelte.ts', './lib'))
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
      await runGenerator(angularQuery(api, 'src/angular.ts', './lib'))
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
    const expected = `import { injectQuery, queryOptions } from '@tanstack/angular-query-experimental'
import type { CreateQueryOptions, InjectQueryOptions } from '@tanstack/angular-query-experimental'
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
  injectOptions?: InjectQueryOptions,
) {
  return injectQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsQueryOptions<TData, TError>(clientOptions), ...query }
  }, injectOptions)
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
import type { CreateQueryOptions, InjectQueryOptions } from '@tanstack/angular-query-experimental'
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
  injectOptions?: InjectQueryOptions,
) {
  return injectQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsIdQueryOptions<TData, TError>(params(), clientOptions), ...query }
  }, injectOptions)
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
} from '@tanstack/angular-query-experimental'
import type {
  CreateQueryOptions,
  QueryFunctionContext,
  CreateInfiniteQueryOptions,
  InfiniteData,
  InjectQueryOptions,
  InjectInfiniteQueryOptions,
} from '@tanstack/angular-query-experimental'
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
  injectOptions?: InjectQueryOptions,
) {
  return injectQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return { ...getItemsQueryOptions<TData, TError>(clientOptions), ...query }
  }, injectOptions)
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
  injectOptions?: InjectInfiniteQueryOptions,
) {
  return injectInfiniteQuery(() => {
    const { query, options: clientOptions } = options?.() ?? {}
    return {
      ...getItemsInfiniteQueryOptions<TPageParam, TData, TError>(pagination, clientOptions),
      ...query,
    }
  }, injectOptions)
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
import type {
  CreateMutationOptions,
  InjectMutationOptions,
} from '@tanstack/angular-query-experimental'
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
  injectOptions?: InjectMutationOptions,
) {
  return injectMutation(() => {
    const { mutation } = options?.() ?? {}
    const mutationDefaults = getPostItemsMutationOptions<TError, TOnMutateResult>()
    return {
      ...mutation,
      ...mutationDefaults,
      mutationKey: mutation?.mutationKey ?? mutationDefaults.mutationKey,
    }
  }, injectOptions)
}
`
    expect(code).toBe(expected)
  })
})
