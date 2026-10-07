import path from 'node:path'

import { makeModuleSpec } from '../../helper/code.js'
import type { QueryHookConfig } from '../../helper/query.js'
import { makeQueryHooks } from '../../helper/query.js'
import type { OpenAPI } from '../../openapi/index.js'

type HookLibrary =
  | 'swr'
  | 'tanstack-query'
  | 'preact-query'
  | 'vue-query'
  | 'svelte-query'
  | 'solid-query'
  | 'angular-query'

// The trailing argument each library's hooks take after their options, forwarded as it is.
const QUERY_CLIENT_TAIL = {
  name: 'queryClient',
  query: 'QueryClient',
  infinite: 'QueryClient',
  mutation: 'QueryClient',
  imports: ['QueryClient'],
} as const
// Solid and Svelte take the client as an accessor.
const QUERY_CLIENT_ACCESSOR_TAIL = {
  name: 'queryClient',
  query: '() => QueryClient',
  infinite: '() => QueryClient',
  mutation: '() => QueryClient',
  imports: ['QueryClient'],
} as const
const INJECT_OPTIONS_TAIL = {
  name: 'injectOptions',
  query: 'InjectQueryOptions',
  infinite: 'InjectInfiniteQueryOptions',
  mutation: 'InjectMutationOptions',
  imports: ['InjectQueryOptions', 'InjectInfiniteQueryOptions', 'InjectMutationOptions'],
} as const

const TANSTACK: QueryHookConfig = {
  label: 'tanstack-query',
  packageName: '@tanstack/react-query',
  hookPrefix: 'use',
  queryFn: 'useQuery',
  mutationFn: 'useMutation',
  infiniteQueryFn: 'useInfiniteQuery',
  suspenseQueryFn: 'useSuspenseQuery',
  suspenseInfiniteQueryFn: 'useSuspenseInfiniteQuery',
  queryOptionsType: 'UseQueryOptions',
  suspenseQueryOptionsType: 'UseSuspenseQueryOptions',
  mutationOptionsType: 'UseMutationOptions',
  infiniteOptionsType: 'UseInfiniteQueryOptions',
  suspenseInfiniteOptionsType: 'UseSuspenseInfiniteQueryOptions',
  hookTail: QUERY_CLIENT_TAIL,
}

export const HOOK_CONFIGS = {
  swr: {
    label: 'swr',
    packageName: 'swr',
    hookPrefix: 'use',
    queryFn: 'useSWR',
    mutationFn: 'useSWRMutation',
    infiniteQueryFn: 'useSWRInfinite',
    immutableQueryFn: 'useSWRImmutable',
    isSWR: true,
  },
  'tanstack-query': TANSTACK,
  'preact-query': { ...TANSTACK, label: 'preact-query', packageName: '@tanstack/preact-query' },
  // Vue Query's `queryOptions()` / `infiniteQueryOptions()` do not take the generic factories (its
  // `MaybeRefDeep<TPageParam>` never narrows from a generic parameter), so Vue gets plain
  // factories and inline hooks. It also has no suspense hooks: suspense is `<Suspense>`.
  'vue-query': {
    label: 'vue-query',
    packageName: '@tanstack/vue-query',
    hookPrefix: 'use',
    queryFn: 'useQuery',
    mutationFn: 'useMutation',
    infiniteQueryFn: 'useInfiniteQuery',
    isVueQuery: true,
    queryOptionsType: 'UseQueryOptions',
    mutationOptionsType: 'UseMutationOptions',
    infiniteOptionsType: 'UseInfiniteQueryOptions',
    hookTail: QUERY_CLIENT_TAIL,
  },
  // Solid Query takes the whole options object as an accessor, and aliases every `Create*Options`
  // type to `Accessor<...>`; `createQuery` has only the Undefined / Defined `initialData` overloads,
  // so the Undefined variant is the one the spread resolves against.
  'solid-query': {
    label: 'solid-query',
    packageName: '@tanstack/solid-query',
    hookPrefix: 'create',
    queryFn: 'createQuery',
    mutationFn: 'createMutation',
    infiniteQueryFn: 'createInfiniteQuery',
    useThunk: true,
    unwrapOptionsAccessor: true,
    queryOptionsType: 'UndefinedInitialDataOptions',
    mutationOptionsType: 'CreateMutationOptions',
    infiniteOptionsType: 'UndefinedInitialDataInfiniteOptions',
    hookTail: QUERY_CLIENT_ACCESSOR_TAIL,
  },
  // Svelte Query v5+ takes the options as a thunk, `createQuery(() => options)`.
  // @see https://tanstack.com/query/v5/docs/framework/svelte/reactivity
  'svelte-query': {
    label: 'svelte-query',
    packageName: '@tanstack/svelte-query',
    hookPrefix: 'create',
    queryFn: 'createQuery',
    mutationFn: 'createMutation',
    infiniteQueryFn: 'createInfiniteQuery',
    useThunk: true,
    queryOptionsType: 'CreateQueryOptions',
    mutationOptionsType: 'CreateMutationOptions',
    infiniteOptionsType: 'CreateInfiniteQueryOptions',
    hookTail: QUERY_CLIENT_ACCESSOR_TAIL,
  },
  // Angular replaces suspense with signal-based reactivity, so there are no suspense hooks.
  'angular-query': {
    label: 'angular-query',
    packageName: '@tanstack/angular-query-experimental',
    hookPrefix: 'inject',
    queryFn: 'injectQuery',
    mutationFn: 'injectMutation',
    infiniteQueryFn: 'injectInfiniteQuery',
    useThunk: true,
    queryOptionsType: 'CreateQueryOptions',
    mutationOptionsType: 'CreateMutationOptions',
    infiniteOptionsType: 'CreateInfiniteQueryOptions',
    hookTail: INJECT_OPTIONS_TAIL,
  },
} as const satisfies Record<HookLibrary, QueryHookConfig>

/**
 * Generates the hooks of one client library into `output`.
 *
 * `schemas` is where `components.schemas` is written: a hook for a path Eden cannot type (a
 * segment with a `.` or a partial parameter) falls back to `fetch` and types its data by the
 * component the response names, so it has to import that component from wherever the schemas
 * generator put it — by the specifier the config names, or relative to `output`.
 */
export function hooks(
  openAPI: OpenAPI,
  output: string,
  importPath: string,
  library: HookLibrary,
  options: {
    readonly client: string
    readonly basePath?: string
    readonly schemas?: {
      readonly output: string
      readonly split?: boolean
      readonly import?: string
    }
  },
) {
  const schemasImport =
    options.schemas?.import ??
    (options.schemas
      ? makeModuleSpec(path.resolve(process.cwd(), output), {
          output: path.resolve(process.cwd(), options.schemas.output),
          split: options.schemas.split,
        })
      : undefined)
  return makeQueryHooks(
    openAPI,
    output,
    importPath,
    HOOK_CONFIGS[library],
    options.client,
    options.basePath,
    schemasImport,
  )
}
