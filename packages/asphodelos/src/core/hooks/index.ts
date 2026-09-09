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

const TANSTACK: QueryHookConfig = {
  label: 'tanstack-query',
  packageName: '@tanstack/react-query',
  hookPrefix: 'use',
  queryFn: 'useQuery',
  mutationFn: 'useMutation',
  infiniteQueryFn: 'useInfiniteQuery',
  useQueryGenerics: true,
  suspenseQueryFn: 'useSuspenseQuery',
  suspenseInfiniteQueryFn: 'useSuspenseInfiniteQuery',
  queryOptionsType: 'UseQueryOptions',
  suspenseQueryOptionsType: 'UseSuspenseQueryOptions',
  mutationOptionsType: 'UseMutationOptions',
  infiniteOptionsType: 'UseInfiniteQueryOptions',
  suspenseInfiniteOptionsType: 'UseSuspenseInfiniteQueryOptions',
}

export const HOOK_CONFIGS = {
  swr: {
    label: 'swr',
    packageName: 'swr',
    hookPrefix: 'use',
    queryFn: 'useSWR',
    mutationFn: 'useSWRMutation',
    infiniteQueryFn: 'useSWRInfinite',
    isSWR: true,
  },
  'tanstack-query': TANSTACK,
  'preact-query': TANSTACK,
  'vue-query': {
    label: 'vue-query',
    packageName: '@tanstack/vue-query',
    hookPrefix: 'use',
    queryFn: 'useQuery',
    mutationFn: 'useMutation',
    infiniteQueryFn: 'useInfiniteQuery',
    queryFnContext: true,
    mutationFnAnnotation: true,
    needsInfiniteData: true,
    queryOptionsType: 'UseQueryOptions',
    mutationOptionsType: 'UseMutationOptions',
    infiniteOptionsType: 'UseInfiniteQueryOptions',
  },
  'solid-query': {
    label: 'solid-query',
    packageName: '@tanstack/solid-query',
    hookPrefix: 'create',
    queryFn: 'createQuery',
    mutationFn: 'createMutation',
    infiniteQueryFn: 'createInfiniteQuery',
    queryFnContext: true,
    useThunk: true,
    thunkOptionsCall: true,
    mutationFnAnnotation: true,
    needsInfiniteData: true,
    queryOptionsType: 'UndefinedInitialDataOptions',
    mutationOptionsType: 'CreateMutationOptions',
    infiniteOptionsType: 'UndefinedInitialDataInfiniteOptions',
  },
  'svelte-query': {
    label: 'svelte-query',
    packageName: '@tanstack/svelte-query',
    hookPrefix: 'create',
    queryFn: 'createQuery',
    mutationFn: 'createMutation',
    infiniteQueryFn: 'createInfiniteQuery',
    queryFnContext: true,
    useThunk: true,
    mutationFnAnnotation: true,
    queryOptionsType: 'CreateQueryOptions',
    mutationOptionsType: 'CreateMutationOptions',
    infiniteOptionsType: 'CreateInfiniteQueryOptions',
  },
  'angular-query': {
    label: 'angular-query',
    packageName: '@tanstack/angular-query-experimental',
    hookPrefix: 'inject',
    queryFn: 'injectQuery',
    mutationFn: 'injectMutation',
    infiniteQueryFn: 'injectInfiniteQuery',
    queryFnContext: true,
    useThunk: true,
    mutationFnAnnotation: true,
    queryOptionsType: 'CreateQueryOptions',
    mutationOptionsType: 'CreateMutationOptions',
    infiniteOptionsType: 'CreateInfiniteQueryOptions',
  },
} as const satisfies Record<HookLibrary, QueryHookConfig>

export function hooks(
  openAPI: OpenAPI,
  output: string,
  importPath: string,
  library: HookLibrary,
  options: { readonly client: string; readonly basePath?: string; readonly split?: boolean },
) {
  return makeQueryHooks(
    openAPI,
    output,
    importPath,
    HOOK_CONFIGS[library],
    options.client,
    options.basePath,
    options.split,
  )
}
