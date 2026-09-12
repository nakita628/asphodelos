import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../emit/index.js'
import { GenerateError } from '../error/index.js'
import { pathEntries } from '../openapi/index.js'
import type { OpenAPI, Operation } from '../openapi/index.js'
import { capitalize, pascalCase, resourcePrefix, toSafeIdentifier } from '../utils/index.js'
import { edenChain } from './eden.js'
import {
  HTTP_METHODS,
  makePrefixKeyCodes,
  resolveOperation,
  resolveOperationId,
} from './openapi.js'
import { responseInfo } from './schema.js'

export type QueryHookConfig = {
  readonly label: string
  readonly packageName: string
  readonly hookPrefix: string
  readonly queryFn: string
  readonly mutationFn: string
  readonly infiniteQueryFn: string
  readonly immutableQueryFn?: string
  readonly isSWR?: boolean
  readonly queryFnContext?: boolean
  readonly useThunk?: boolean
  readonly thunkOptionsCall?: boolean
  readonly useQueryGenerics?: boolean
  readonly maybeRefOptions?: boolean
  readonly suspenseQueryFn?: string
  readonly suspenseInfiniteQueryFn?: string
  readonly queryOptionsType?: string
  readonly suspenseQueryOptionsType?: string
  readonly mutationOptionsType?: string
  readonly infiniteOptionsType?: string
  readonly suspenseInfiniteOptionsType?: string
  readonly hasInfiniteQueryOptionsHelper?: boolean
  readonly unwrapOptionsAccessor?: boolean
}

type OpDeps = { isQuery: boolean; isInfinite: boolean; isMutation: boolean }

// Solid aliases every `Create*Options` type to `Accessor<...>` (a thunk), because `createQuery`
// takes the whole options object as one. The user-facing slot must be the unwrapped object:
// typed as the accessor, `...queryOptions?.()` spreads a function's (empty) own properties, so
// the caller's options are silently dropped. `ReturnType` is the unwrapping Solid itself uses.
function optionsObjectType(config: QueryHookConfig, optionsType: string) {
  return config.unwrapOptionsAccessor ? `ReturnType<${optionsType}>` : optionsType
}

// The hook supplies these itself, so the caller's options leave them out — the shape
// openapi-react-query uses. The libraries type `queryKey` as required, which otherwise forces the
// caller to pass a key the hook then overwrites, and leaves `select` unable to bind TData.
const QUERY_OMIT_KEYS = `'queryKey' | 'queryFn'`
// Infinite hooks also supply both page-param functions, from `pagination`.
const INFINITE_OMIT_KEYS = `'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'`

// Vue's options types are `MaybeRef<{...}>` (`Ref | ComputedRef | object`), and a plain `Omit` over
// that union keeps only the keys all three share — none. The hook spreads the value, which only
// works on the plain object anyway, so `Extract` keeps that member (the only one with `queryKey`).
function omitInjectedKeys(config: QueryHookConfig, optionsType: string, keys: string) {
  const objectType = config.maybeRefOptions
    ? `Extract<${optionsType}, { queryKey: unknown }>`
    : optionsObjectType(config, optionsType)
  return `Omit<${objectType}, ${keys}>`
}

function makeGetQueryOptionsParam(config: QueryHookConfig, dataT: string, keyName: string) {
  const optType = config.queryOptionsType
  const omit = (optionsType: string) => omitInjectedKeys(config, optionsType, QUERY_OMIT_KEYS)
  if (config.useQueryGenerics) {
    // The TQueryKey generic is inferred from the queryKey the hook passes, so it
    // doesn't need to be spelled out here.
    return `queryOptions?: ${omit(`${optType}<${dataT}, TError, TData>`)}`
  }
  if (config.maybeRefOptions) {
    return `queryOptions?: ${omit(`${optType}<${dataT}, TError, TData, ${dataT}, ReturnType<typeof ${keyName}>>`)}`
  }
  if (config.thunkOptionsCall) {
    return `queryOptions?: () => ${omit(`${optType}<${dataT}, TError, TData, ReturnType<typeof ${keyName}>>`)}`
  }
  return `queryOptions?: ${omit(`${optType}<${dataT}, TError, TData>`)}`
}

function makeMutationOptionsParam(
  config: QueryHookConfig,
  dataT: string,
  errorT: string,
  variablesType: string,
) {
  const optType = `${config.mutationOptionsType}<${dataT}, ${errorT}, ${variablesType}>`
  return config.thunkOptionsCall
    ? `mutationOptions?: () => ${optionsObjectType(config, optType)}`
    : `mutationOptions?: ${optType}`
}

function makeGetHookBody(
  config: QueryHookConfig,
  dataT: string,
  keyCall: string,
  queryFnBlock: string,
) {
  const spread = config.thunkOptionsCall ? '...queryOptions?.()' : '...queryOptions'
  const inner = `${spread},queryKey:${keyCall},${queryFnBlock}`
  if (config.useQueryGenerics) {
    return `${config.queryFn}<${dataT},TError,TData>({${inner}})`
  }
  if (config.useThunk) {
    return `${config.queryFn}(()=>({${inner}}))`
  }
  return `${config.queryFn}({${inner}})`
}

// The mutation counterpart of the `queryOptions` factory: a typed, reusable options object (for
// `queryClient.setMutationDefaults`, or to spread into a hook yourself). Unlike the query hooks,
// the mutation hook consumes it — `mutationOptions()` adds no DataTag brand, so its result stays
// assignable to the hook's generics and the request lives in one place. TError is a parameter so
// the hook's own TError reaches `onError`.
function makeMutationFactoryCode(
  name: string,
  keySig: string,
  keyCall: string,
  dataT: string,
  errorT: string,
  variablesType: string,
  mutationFnBlock: string,
) {
  return `export function ${name}<TError = ${errorT}>(${keySig}){return mutationOptions<${dataT},TError,${variablesType}>({mutationKey:${keyCall},${mutationFnBlock}})}`
}

function makeMutationHookBody(
  config: QueryHookConfig,
  dataT: string,
  variablesType: string,
  factoryCall: string,
) {
  // The caller's options spread first so the factory's key and request win.
  const spread = config.thunkOptionsCall ? '...mutationOptions?.()' : '...mutationOptions'
  const inner = `${spread},...${factoryCall}`
  if (config.useQueryGenerics) {
    return `${config.mutationFn}<${dataT},TError,${variablesType}>({${inner}})`
  }
  if (config.useThunk) {
    return `${config.mutationFn}(()=>({${inner}}))`
  }
  return `${config.mutationFn}({${inner}})`
}

function makeTanstackInfiniteParts(
  config: QueryHookConfig,
  args: {
    funcName: string
    hookName: string
    suspenseHookName: string
    keyPrefix: string
    pathStr: string
    paramSig: readonly string[]
    paramPass: readonly string[]
    optionsType: string
    dataT: string
    errorT: string
    callExpr: string
  },
) {
  const { funcName, hookName, suspenseHookName, keyPrefix, pathStr } = args
  const { paramSig, paramPass, optionsType, dataT, errorT, callExpr } = args
  const infiniteKeyName = `${funcName}InfiniteQueryKey`
  const infiniteKeySig = [...paramSig, `options?: ${optionsType}`].join(', ')
  const infiniteKeyTuple = [
    `'${keyPrefix}'`,
    `'${pathStr}'`,
    `'infinite'`,
    ...paramPass,
    'keyArgs',
  ].join(', ')
  const infiniteKeyCode = `export function ${infiniteKeyName}(${infiniteKeySig}){const{headers:_h,fetch:_f,throwHttpError:_t,...keyArgs}=options??{};return[${infiniteKeyTuple}]as const}`
  const infiniteKeyCall = `${infiniteKeyName}(${[...paramPass, 'options'].join(', ')})`
  const infiniteHookName = `${hookName}Infinite`
  const suspenseInfiniteHookName = `${suspenseHookName}Infinite`
  const queryKeyType = `ReturnType<typeof ${infiniteKeyName}>`

  // `pagination` carries the three page-param concerns TanStack v5 requires that an
  // `x-pagination: true` flag can't supply: where paging starts (initialPageParam), how to
  // read the next cursor (getNextPageParam), and how a pageParam maps onto the request
  // (buildInit — eden has no page-param slot, so the per-page overlay is merged into the call).
  const paginationParam = `pagination: { initialPageParam: TPageParam; getNextPageParam: (lastPage: ${dataT}, allPages: ${dataT}[], lastPageParam: TPageParam, allPageParams: TPageParam[]) => TPageParam | undefined | null; buildInit: (pageParam: unknown) => ${optionsType} }`
  const infiniteSig = [...paramSig, `options: ${optionsType} | undefined`, paginationParam].join(
    ', ',
  )

  // `pageParam` is `unknown` at the QueryFunctionContext boundary (TanStack can't know
  // TPageParam there), so buildInit accepts `unknown` and the caller narrows it — no cast emitted.
  const infiniteQueryFnBody = `queryFn:async({pageParam,signal})=>{const overlay=pagination.buildInit(pageParam);const{data,error}=await ${callExpr}({...options,...overlay,query:{...options?.query,...overlay?.query},headers:{...options?.headers,...overlay?.headers},fetch:{...options?.fetch,...overlay?.fetch,signal}});if(error)throw error;return data},`
  // Spell out all five infiniteQueryOptions generics. Inferring TPageParam from a generic
  // factory body collapses `pageParam` to `unknown` and the helper's 3 overloads then match
  // none; the explicit args bind TPageParam so `useInfiniteQuery(factory(...))` resolves
  // data.pages / data.pageParams to their real types. `TPageParam` has no `= unknown` default
  // for the same reason — a default would re-collapse it.
  const infiniteOptionsName = `${funcName}InfiniteQueryOptions`
  const infiniteOptionsCode = `export function ${infiniteOptionsName}<TPageParam>(${infiniteSig}){return infiniteQueryOptions<${dataT},${errorT},InfiniteData<${dataT},TPageParam>,${queryKeyType},TPageParam>({queryKey:${infiniteKeyCall},${infiniteQueryFnBody}initialPageParam:pagination.initialPageParam,getNextPageParam:pagination.getNextPageParam})}`

  // Like hono-takibi, the hooks build their options inline rather than spreading the factory:
  // `infiniteQueryOptions()` brands its result with the factory's fixed TData/TError, which is
  // not assignable to the hook's own TData/TError generics. The caller's options spread first,
  // then the key, the request and the page-param functions, so the operation contract wins.
  const infiniteGenerics = `<TPageParam = unknown, TData = InfiniteData<${dataT}, TPageParam>, TError = ${errorT}>`
  const hookQueryFnBody = `queryFn:async({pageParam,signal}:QueryFunctionContext<${queryKeyType},TPageParam>)=>{const overlay=pagination.buildInit(pageParam);const{data,error}=await ${callExpr}({...options,...overlay,query:{...options?.query,...overlay?.query},headers:{...options?.headers,...overlay?.headers},fetch:{...options?.fetch,...overlay?.fetch,signal}});if(error)throw error;return data},`
  const spread = config.thunkOptionsCall ? '...queryOptions?.()' : '...queryOptions'
  const inner = `${spread},queryKey:${infiniteKeyCall},${hookQueryFnBody}initialPageParam:pagination.initialPageParam,getNextPageParam:pagination.getNextPageParam`
  const hookBody = (queryFn: string) =>
    config.useThunk ? `${queryFn}(()=>({${inner}}))` : `${queryFn}({${inner}})`
  const hookSig = (libOptionsType: string | undefined) => {
    const fullType = omitInjectedKeys(
      config,
      `${libOptionsType}<${dataT}, TError, TData, ${queryKeyType}, TPageParam>`,
      INFINITE_OMIT_KEYS,
    )
    const queryOptionsParam = config.thunkOptionsCall
      ? `queryOptions?: () => ${fullType}`
      : `queryOptions?: ${fullType}`
    return [infiniteSig, queryOptionsParam].join(', ')
  }
  const infiniteCode = `export function ${infiniteHookName}${infiniteGenerics}(${hookSig(config.infiniteOptionsType)}){return ${hookBody(config.infiniteQueryFn)}}`
  if (!config.suspenseInfiniteQueryFn) {
    return [infiniteKeyCode, infiniteOptionsCode, infiniteCode]
  }
  const suspenseInfiniteCode = `export function ${suspenseInfiniteHookName}${infiniteGenerics}(${hookSig(config.suspenseInfiniteOptionsType)}){return ${hookBody(config.suspenseInfiniteQueryFn)}}`

  return [infiniteKeyCode, infiniteOptionsCode, infiniteCode, suspenseInfiniteCode]
}

function makeInfiniteParts(
  config: QueryHookConfig,
  args: {
    funcName: string
    hookName: string
    suspenseHookName: string
    keyPrefix: string
    pathStr: string
    paramSig: readonly string[]
    paramPass: readonly string[]
    optionsType: string
    dataT: string
    errorT: string
    callExpr: string
  },
) {
  if (config.hasInfiniteQueryOptionsHelper) {
    return makeTanstackInfiniteParts(config, args)
  }
  // Vue Query: its `infiniteQueryOptions()` (and `useInfiniteQuery`) type `initialPageParam` as
  // `MaybeRefDeep<TPageParam>`, which a generic `TPageParam` is never assignable to — even with
  // all five generics spelled out. So there is no factory and `pagination` carries only
  // `buildInit`; the page-param functions travel in the (required) `queryOptions` instead.
  const { funcName, hookName, keyPrefix, pathStr } = args
  const { paramSig, paramPass, optionsType, dataT, errorT, callExpr } = args
  const infiniteKeyName = `${funcName}InfiniteQueryKey`
  const infiniteKeySig = [...paramSig, `options?: ${optionsType}`].join(', ')
  const infiniteKeyTuple = [
    `'${keyPrefix}'`,
    `'${pathStr}'`,
    `'infinite'`,
    ...paramPass,
    'keyArgs',
  ].join(', ')
  const infiniteKeyCode = `export function ${infiniteKeyName}(${infiniteKeySig}){const{headers:_h,fetch:_f,throwHttpError:_t,...keyArgs}=options??{};return[${infiniteKeyTuple}]as const}`
  const infiniteKeyCall = `${infiniteKeyName}(${[...paramPass, 'options'].join(', ')})`
  const infiniteHookName = `${hookName}Infinite`

  const infiniteGenerics = `<TPageParam = unknown, TData = InfiniteData<${dataT}, TPageParam>, TError = ${errorT}>`
  const infiniteQueryFnBlock = `queryFn:async({pageParam,signal}:QueryFunctionContext)=>{const overlay=pagination.buildInit(pageParam);const{data,error}=await ${callExpr}({...options,...overlay,query:{...options?.query,...overlay?.query},headers:{...options?.headers,...overlay?.headers},fetch:{...options?.fetch,...overlay?.fetch,signal}});if(error)throw error;return data},`
  const fullOptionsType = `${config.infiniteOptionsType}<${dataT}, TError, TData, ReturnType<typeof ${infiniteKeyName}>, TPageParam>`
  const infiniteHookSig = [
    ...paramSig,
    `options: ${optionsType} | undefined`,
    `pagination: { buildInit: (pageParam: unknown) => ${optionsType} }`,
    `queryOptions: ${omitInjectedKeys(config, fullOptionsType, QUERY_OMIT_KEYS)}`,
  ].join(', ')
  const inner = `...queryOptions,queryKey:${infiniteKeyCall},${infiniteQueryFnBlock}`
  const infiniteCode = `export function ${infiniteHookName}${infiniteGenerics}(${infiniteHookSig}){return ${config.infiniteQueryFn}({${inner}})}`

  return [infiniteKeyCode, infiniteCode]
}

function makeSwrOperation(
  config: QueryHookConfig,
  args: {
    hookName: string
    immutableHookName: string
    keyName: string
    keyPrefix: string
    pathStr: string
    method: (typeof HTTP_METHODS)[number]
    paramSig: readonly string[]
    paramPass: readonly string[]
    argsType: string
    optionsType: string
    dataT: string
    errorT: string
    callExpr: string
    isQuery: boolean
    isBodyMethod: boolean
    isPaginated: boolean
    hasKeyArgs: boolean
    optMark: string
  },
) {
  const { hookName, immutableHookName, keyName, keyPrefix, pathStr, method } = args
  const { paramSig, paramPass } = args
  const { argsType, optionsType, dataT, errorT, callExpr } = args
  const { isQuery, isBodyMethod, isPaginated, hasKeyArgs, optMark } = args

  if (isQuery) {
    const keySig = (hasKeyArgs ? [...paramSig, `options?: ${optionsType}`] : paramSig).join(', ')
    const keyTuple = [
      `'${keyPrefix}'`,
      `'${pathStr}'`,
      ...paramPass,
      ...(hasKeyArgs ? ['keyArgs'] : []),
    ].join(', ')
    const keyCode = hasKeyArgs
      ? `export function ${keyName}(${keySig}){const{headers:_h,fetch:_f,throwHttpError:_t,...keyArgs}=options??{};return[${keyTuple}]as const}`
      : `export function ${keyName}(${keySig}){return[${keyTuple}]as const}`
    const keyCall = `${keyName}(${[...paramPass, ...(hasKeyArgs ? ['options'] : [])].join(', ')})`
    const generics = `<TError = ${errorT}>`
    const hookSig = [
      ...paramSig,
      `options${optMark}: ${optionsType}`,
      `config?: SWRConfiguration<${dataT}, TError>`,
    ].join(', ')
    const swrHook = (name: string, swrFn: string) =>
      `export function ${name}${generics}(${hookSig}){return ${swrFn}<${dataT},TError>(${keyCall},async()=>{const{data,error}=await ${callExpr}(options);if(error)throw error;return data},config)}`
    // The immutable variant shares the key and fetcher: same cache entry, fetched once and never
    // revalidated — for data that does not change while the page is open.
    const hookCode = config.immutableQueryFn
      ? `${swrHook(hookName, config.queryFn)}\n\n${swrHook(immutableHookName, config.immutableQueryFn)}`
      : swrHook(hookName, config.queryFn)

    if (isPaginated) {
      const infiniteHookName = `${hookName}Infinite`
      const infiniteHookSig = [
        ...paramSig,
        `buildInit: (pageIndex: number, previousPage: ${dataT} | null) => ${optionsType} | null`,
        `config?: SWRInfiniteConfiguration<${dataT}, TError>`,
      ].join(', ')
      const infiniteKeyTuple = [
        `'${keyPrefix}'`,
        `'${pathStr}'`,
        `'infinite'`,
        'pageIndex',
        ...paramPass,
        'keyArgs',
      ].join(', ')
      // Naming the key loader and threading `typeof getKey` as the third useSWRInfinite generic
      // keeps the fetcher's key precisely typed (otherwise it widens to `Arguments`, and the
      // recovered keyArgs would need an `as` cast). Path params come back typed but stay unused —
      // the call uses the typed hook params from the closure — so bind them to throwaway names.
      const fetcherDestructure = [
        '_resource',
        '_opId',
        '_infinite',
        '_pageIndex',
        ...paramPass.map((_, i) => `_key${i}`),
        'keyArgs',
      ].join(', ')
      const getKey = `const getKey=(pageIndex:number,previousPage:${dataT}|null)=>{const options=buildInit(pageIndex,previousPage);if(options===null)return null;const{headers:_h,fetch:_f,throwHttpError:_t,...keyArgs}=options??{};return[${infiniteKeyTuple}]as const}`
      const infiniteCode = `export function ${infiniteHookName}${generics}(${infiniteHookSig}){${getKey};return useSWRInfinite<${dataT},TError,typeof getKey>(getKey,async([${fetcherDestructure}])=>{const{data,error}=await ${callExpr}(keyArgs);if(error)throw error;return data},config)}`
      return `${keyCode}\n\n${hookCode}\n\n${infiniteCode}`
    }
    return `${keyCode}\n\n${hookCode}`
  }

  const keySig = paramSig.join(', ')
  const keyExpr = `[${[`'${keyPrefix}'`, `'${pathStr}'`, `'${method.toUpperCase()}'`, ...paramPass].join(', ')}] as const`
  const keyCode = `export function ${keyName}(${keySig}){return ${keyExpr}}`
  const keyCall = `${keyName}(${paramPass.join(', ')})`

  const variablesType = isBodyMethod
    ? `{ body: ${argsType}[0]; options${optMark}: ${argsType}[1] }`
    : `{ options${optMark}: ${argsType}[0] }`
  const triggerCallExpr = isBodyMethod
    ? `${callExpr}(arg.body, arg.options)`
    : `${callExpr}(arg.options)`
  const mutationGenerics = `<TError = ${errorT}>`
  const hookSig = [
    ...paramSig,
    `config?: SWRMutationConfiguration<${dataT}, TError, ReturnType<typeof ${keyName}>, ${variablesType}>`,
  ].join(', ')
  const triggerCb = `async(_key:ReturnType<typeof ${keyName}>,{arg}:{arg:${variablesType}})=>{const{data,error}=await ${triggerCallExpr};if(error)throw error;return data}`
  const hookCode = `export function ${hookName}${mutationGenerics}(${hookSig}){return useSWRMutation<${dataT},TError,ReturnType<typeof ${keyName}>,${variablesType}>(${keyCall},${triggerCb},config)}`
  return `${keyCode}\n\n${hookCode}`
}

// Eden treaty projects a path onto a property/function tree, so a segment it cannot turn into
// a clean node breaks the whole chain: a partial param (`/{Sid}.json` — a `{param}` mixed with
// static text has no function node) and, transitively, every sibling under the same resource
// (the parent position becomes a union whose branches expose disjoint children). File-extension
// REST (Twilio/Shopify put `.json` on every endpoint) hits both. A segment carrying a `.` or a
// partial param marks the path as untypeable through eden — fall back to a literal-path `fetch`
// hook (the approach orval/openapi-typescript take, which has no path-tree to break).
function needsFetchHook(pathStr: string) {
  return pathStr
    .split('/')
    .filter(Boolean)
    .some((seg) => seg.includes('.') || (seg.includes('{') && !/^\{[^}]+\}$/u.test(seg)))
}

function pathParamNames(pathStr: string): readonly string[] {
  return [...pathStr.matchAll(/\{([^}]+)\}/gu)].map((m) => m[1] ?? '')
}

// The data type for a partial-param op comes from its 2xx response schema — the eden chain
// that normally yields it is untypeable here. A component `$ref` resolves to its exported
// `Static` alias (imported from the schemas module); inline/void degrade to a safe wide type.
function successType(operation: Operation): {
  readonly dataT: string
  readonly importName?: string
} {
  const ok = Object.entries(operation.responses ?? {}).find(([status]) => status.startsWith('2'))
  if (!ok) return { dataT: 'void' }
  const info = responseInfo(ok[1])
  if (info.ref) return { dataT: pascalCase(info.ref), importName: pascalCase(info.ref) }
  if (info.void) return { dataT: 'void' }
  return { dataT: 'unknown' }
}

export function fetchTypeImport(pathStr: string, operation: Operation): string | undefined {
  return needsFetchHook(pathStr) ? successType(operation).importName : undefined
}

// Literal-path fetch hook for a partial-param op. Reuses the same hook shape (key + options +
// generics) as the eden path, swapping the eden call for a typed `fetch`. Path params are
// strings in a URL, so they are typed `{ name: string }` rather than via the (unreachable)
// eden param type.
function makeFetchOperation(
  pathStr: string,
  method: (typeof HTTP_METHODS)[number],
  operation: Operation,
  config: QueryHookConfig,
) {
  const funcName = toSafeIdentifier(resolveOperationId(operation, method, pathStr))
  const Op = capitalize(funcName)
  const hookName = `${config.hookPrefix}${Op}`
  const suspenseHookName = `${config.hookPrefix}Suspense${Op}`
  const immutableHookName = `${config.hookPrefix}Immutable${Op}`
  const keyPrefix = resourcePrefix(pathStr)
  const isQuery = method === 'get' || method === 'head'
  const params = pathParamNames(pathStr)
  const paramSig = params.map((p) => `${p}: string`)
  const paramPass = [...params]
  // Mirror the eden path: `query` params reach the URL and the cache key; `headers` are
  // forwarded but never keyed on. Without this the fetch hook silently drops filters and
  // pagination, and distinct queries collide on one cache key.
  const hasQuery = (operation.parameters ?? []).some((p) => 'in' in p && p.in === 'query')
  const optionsType = hasQuery
    ? '{ headers?: Record<string, string>; query?: Record<string, unknown> }'
    : '{ headers?: Record<string, string> }'
  const { dataT } = successType(operation)
  const errorT = 'unknown'
  const urlInner = pathStr.replaceAll(/\{([^}]+)\}/gu, (_, n) => `\${encodeURIComponent(${n})}`)
  const urlExpr = hasQuery
    ? `\`${urlInner}\${search.size ? \`?\${search}\` : ''}\``
    : `\`${urlInner}\``
  const searchCode = (opt: string) =>
    hasQuery
      ? `const search=new URLSearchParams();for(const[k,v]of Object.entries(${opt}?.query??{})){if(v===undefined)continue;if(Array.isArray(v)){for(const x of v){search.append(k,String(x))}}else{search.set(k,String(v))}}`
      : ''
  // Read body via res.json() would type as unknown (unassignable); res.text() + JSON.parse
  // yields `any`, keeping the annotated return type without an `as` cast.
  const getBody = (returnAnnotation: string, opt: string, signal: boolean) =>
    `${searchCode(opt)}const res=await fetch(${urlExpr},{headers:${opt}?.headers${signal ? ',signal' : ''}});if(!res.ok)throw await res.json();return JSON.parse(await res.text())`

  const keyArgsDecl = hasQuery ? 'const{headers:_h,...keyArgs}=options??{};' : ''
  const keyTuple = [
    `'${keyPrefix}'`,
    `'${pathStr}'`,
    ...paramPass,
    ...(hasQuery ? ['keyArgs'] : []),
  ].join(', ')

  if (config.isSWR && isQuery) {
    const keyName = `${funcName}QueryKey`
    const keySig = [...paramSig, `options?: ${optionsType}`].join(', ')
    const keyCode = `export function ${keyName}(${keySig}){${keyArgsDecl}return[${keyTuple}]as const}`
    const keyCall = `${keyName}(${[...paramPass, 'options'].join(', ')})`
    const fetcher = `async():Promise<${dataT}>=>{${getBody(dataT, 'options', false)}}`
    const hookSig = [
      ...paramSig,
      `options?: ${optionsType}`,
      `config?: SWRConfiguration<${dataT}, TError>`,
    ].join(', ')
    const swrHook = (name: string, swrFn: string) =>
      `export function ${name}<TError=${errorT}>(${hookSig}){return ${swrFn}<${dataT},TError>(${keyCall},${fetcher},config)}`
    const hookCode = config.immutableQueryFn
      ? `${swrHook(hookName, config.queryFn)}\n\n${swrHook(immutableHookName, config.immutableQueryFn)}`
      : swrHook(hookName, config.queryFn)
    return `${keyCode}\n\n${hookCode}`
  }

  const mutationBody = (opt: string, body: string) =>
    `${searchCode(opt)}const res=await fetch(${urlExpr},{method:'${method.toUpperCase()}',headers:{'content-type':'application/json',...${opt}?.headers},body:${body}===undefined?undefined:JSON.stringify(${body})});if(!res.ok)throw await res.json();return JSON.parse(await res.text())`
  const variablesType = `{ body?: unknown; options?: ${optionsType} }`

  if (config.isSWR) {
    const keyName = `${funcName}MutationKey`
    const keyExpr = `[${[`'${keyPrefix}'`, `'${pathStr}'`, `'${method.toUpperCase()}'`, ...paramPass].join(', ')}] as const`
    const keyCode = `export function ${keyName}(${paramSig.join(', ')}){return ${keyExpr}}`
    const keyCall = `${keyName}(${paramPass.join(', ')})`
    const triggerCb = `async(_key:ReturnType<typeof ${keyName}>,{arg}:{arg:${variablesType}}):Promise<${dataT}>=>{${mutationBody('arg.options', 'arg.body')}}`
    const hookSig = [
      ...paramSig,
      `config?: SWRMutationConfiguration<${dataT}, TError, ReturnType<typeof ${keyName}>, ${variablesType}>`,
    ].join(', ')
    const hookCode = `export function ${hookName}<TError=${errorT}>(${hookSig}){return useSWRMutation<${dataT},TError,ReturnType<typeof ${keyName}>,${variablesType}>(${keyCall},${triggerCb},config)}`
    return `${keyCode}\n\n${hookCode}`
  }

  if (isQuery) {
    const keyName = `${funcName}QueryKey`
    const keySig = [...paramSig, `options?: ${optionsType}`].join(', ')
    const keyCode = `export function ${keyName}(${keySig}){${keyArgsDecl}return[${keyTuple}]as const}`
    const keyCall = `${keyName}(${[...paramPass, 'options'].join(', ')})`
    const sigParam = config.queryFnContext ? '{signal}:QueryFunctionContext' : '{signal}'
    const queryFnBlock = `queryFn:async(${sigParam}):Promise<${dataT}>=>{${getBody(dataT, 'options', true)}},`
    const queryOptionsName = `${funcName}QueryOptions`
    const queryOptionsSig = [...paramSig, `options?: ${optionsType}`].join(', ')
    const queryOptionsCode = `export function ${queryOptionsName}(${queryOptionsSig}){return queryOptions({queryKey:${keyCall},queryFn:async({signal}):Promise<${dataT}>=>{${getBody(dataT, 'options', true)}}})}`
    const generics = `<TData = ${dataT}, TError = ${errorT}>`
    const queryOptionsParam = makeGetQueryOptionsParam(config, dataT, keyName)
    const hookSig = [...paramSig, `options?: ${optionsType}`, queryOptionsParam].join(', ')
    const hookBody = makeGetHookBody(config, dataT, keyCall, queryFnBlock)
    const hookCode = `export function ${hookName}${generics}(${hookSig}){return ${hookBody}}`
    const parts = [keyCode, queryOptionsCode, hookCode]
    if (config.suspenseQueryFn) {
      const suspenseHookSig = [
        ...paramSig,
        `options?: ${optionsType}`,
        `queryOptions?: ${omitInjectedKeys(config, `${config.suspenseQueryOptionsType}<${dataT}, TError, TData>`, QUERY_OMIT_KEYS)}`,
      ].join(', ')
      const suspenseHookCode = `export function ${suspenseHookName}${generics}(${suspenseHookSig}){return ${config.suspenseQueryFn}<${dataT},TError,TData>({...queryOptions,queryKey:${keyCall},${queryFnBlock}})}`
      parts.push(suspenseHookCode)
    }
    return parts.join('\n\n')
  }

  const keyName = `${funcName}MutationKey`
  const keyExpr = `[${[`'${keyPrefix}'`, `'${pathStr}'`, `'${method.toUpperCase()}'`, ...paramPass].join(', ')}] as const`
  const keyCode = `export function ${keyName}(${paramSig.join(', ')}){return ${keyExpr}}`
  const keyCall = `${keyName}(${paramPass.join(', ')})`
  const mutationFnBlock = `mutationFn:async({body,options}):Promise<${dataT}>=>{${mutationBody('options', 'body')}},`
  const mutationOptionsName = `${funcName}MutationOptions`
  const factoryCode = makeMutationFactoryCode(
    mutationOptionsName,
    paramSig.join(', '),
    keyCall,
    dataT,
    errorT,
    variablesType,
    mutationFnBlock,
  )
  const factoryCall = `${mutationOptionsName}<TError>(${paramPass.join(', ')})`
  const mutationOptionsParam = makeMutationOptionsParam(config, dataT, 'TError', variablesType)
  const hookSig = [...paramSig, mutationOptionsParam].join(', ')
  const bodyExpr = makeMutationHookBody(config, dataT, variablesType, factoryCall)
  const hookCode = `export function ${hookName}<TError=${errorT}>(${hookSig}){return ${bodyExpr}}`
  return `${keyCode}\n\n${factoryCode}\n\n${hookCode}`
}

function makeOperation(
  pathStr: string,
  method: (typeof HTTP_METHODS)[number],
  operation: Operation,
  client: string,
  config: QueryHookConfig,
) {
  if (needsFetchHook(pathStr)) return makeFetchOperation(pathStr, method, operation, config)
  const funcName = toSafeIdentifier(resolveOperationId(operation, method, pathStr))
  const Op = capitalize(funcName)
  const hookName = `${config.hookPrefix}${Op}`
  const suspenseHookName = `${config.hookPrefix}Suspense${Op}`
  const immutableHookName = `${config.hookPrefix}Immutable${Op}`
  const isQuery = method === 'get' || method === 'head'
  const keyName = `${funcName}${isQuery ? 'QueryKey' : 'MutationKey'}`
  const keyPrefix = resourcePrefix(pathStr)
  const { callExpr, methodHostTypeExpr, paramArgs } = edenChain(pathStr, client, method)

  const paramSig = paramArgs.map((p) => `${p.name}: ${p.typeExpr}`)
  const paramPass = paramArgs.map((p) => p.name)
  const argsType = `Parameters<${methodHostTypeExpr}>`
  const optionsType = `${argsType}[0]`

  // Eden's `Awaited<ReturnType<M>>` is a discriminated union: the success branch
  // is `{ data: SuccessData; error: null }`, the error branch `{ data: null;
  // error: Err }`. Select the success branch by `error: null` to recover the
  // response data — `Exclude<data, null>` would wrongly drop a legitimately
  // nullable response value (the queryFn returns it, so the hook's TData must
  // keep it; see openapi-nullable). Error stays `Exclude<…['error'], null>`
  // since the error sentinel null only lives on the success branch.
  const response = `Awaited<ReturnType<${methodHostTypeExpr}>>`
  const dataT = `Extract<${response}, { error: null }>['data']`
  const errorT = `Exclude<${response}['error'], null>`

  // Eden treaty types every method except get/head as `(body, options)` — the
  // first arg is the request body, the second the query/header options. delete
  // is therefore a body method: passing options into the body slot breaks when
  // the operation has a required body (TS2345) or a required query (the options
  // arg becomes mandatory, TS2554).
  const isBodyMethod =
    method === 'post' || method === 'put' || method === 'patch' || method === 'delete'
  const isPaginated = operation['x-pagination'] === true
  const hasKeyArgs = (operation.parameters ?? []).some((p) => ('in' in p ? p.in === 'query' : true))
  // When the operation has a required query/header param, the eden call's options
  // argument is itself required (e.g. `query` is non-optional), so the hook can't
  // type it as `options?` — that would collapse the required member under
  // `exactOptionalPropertyTypes`. Thread the optionality through the signatures and
  // the `options.fetch` access used for AbortSignal injection.
  const requiredOptions = (operation.parameters ?? []).some(
    (p) => 'in' in p && (p.in === 'query' || p.in === 'header') && p.required === true,
  )
  const optMark = requiredOptions ? '' : '?'
  const optFetch = requiredOptions ? 'options.fetch' : 'options?.fetch'

  if (config.isSWR) {
    return makeSwrOperation(config, {
      hookName,
      immutableHookName,
      keyName,
      keyPrefix,
      pathStr,
      method,
      paramSig,
      paramPass,
      argsType,
      optionsType,
      dataT,
      errorT,
      callExpr,
      isQuery,
      isBodyMethod,
      isPaginated,
      hasKeyArgs,
      optMark,
    })
  }

  if (isQuery) {
    const keySig = (hasKeyArgs ? [...paramSig, `options?: ${optionsType}`] : paramSig).join(', ')
    const keyTuple = [
      `'${keyPrefix}'`,
      `'${pathStr}'`,
      ...paramPass,
      ...(hasKeyArgs ? ['keyArgs'] : []),
    ].join(', ')
    const keyCode = hasKeyArgs
      ? `export function ${keyName}(${keySig}){const{headers:_h,fetch:_f,throwHttpError:_t,...keyArgs}=options??{};return[${keyTuple}]as const}`
      : `export function ${keyName}(${keySig}){return[${keyTuple}]as const}`
    const keyCall = `${keyName}(${[...paramPass, ...(hasKeyArgs ? ['options'] : [])].join(', ')})`

    const queryOptionsName = `${funcName}QueryOptions`
    const queryOptionsSig = [...paramSig, `options${optMark}: ${optionsType}`].join(', ')
    const queryOptionsCode = `export function ${queryOptionsName}(${queryOptionsSig}){return queryOptions({queryKey:${keyCall},queryFn:async({signal})=>{const{data,error}=await ${callExpr}({...options,fetch:{...${optFetch},signal}});if(error)throw error;return data}})}`

    const sigParam = config.queryFnContext ? '{signal}:QueryFunctionContext' : '{signal}'
    const queryFnBlock = `queryFn:async(${sigParam})=>{const{data,error}=await ${callExpr}({...options,fetch:{...${optFetch},signal}});if(error)throw error;return data},`
    const generics = `<TData = ${dataT}, TError = ${errorT}>`
    const queryOptionsParam = makeGetQueryOptionsParam(config, dataT, keyName)
    const hookSig = [...paramSig, `options${optMark}: ${optionsType}`, queryOptionsParam].join(', ')
    const hookBody = makeGetHookBody(config, dataT, keyCall, queryFnBlock)
    const hookCode = `export function ${hookName}${generics}(${hookSig}){return ${hookBody}}`

    const parts = [keyCode, queryOptionsCode, hookCode]
    if (config.suspenseQueryFn) {
      const suspenseHookSig = [
        ...paramSig,
        `options${optMark}: ${optionsType}`,
        `queryOptions?: ${omitInjectedKeys(config, `${config.suspenseQueryOptionsType}<${dataT}, TError, TData>`, QUERY_OMIT_KEYS)}`,
      ].join(', ')
      const suspenseHookCode = `export function ${suspenseHookName}${generics}(${suspenseHookSig}){return ${config.suspenseQueryFn}<${dataT},TError,TData>({...queryOptions,queryKey:${keyCall},${queryFnBlock}})}`
      parts.push(suspenseHookCode)
    }
    if (isPaginated) {
      parts.push(
        ...makeInfiniteParts(config, {
          funcName,
          hookName,
          suspenseHookName,
          keyPrefix,
          pathStr,
          paramSig,
          paramPass,
          optionsType,
          dataT,
          errorT,
          callExpr,
        }),
      )
    }
    return parts.join('\n\n')
  }

  const keySig = paramSig.join(', ')
  const keyExpr = `[${[`'${keyPrefix}'`, `'${pathStr}'`, `'${method.toUpperCase()}'`, ...paramPass].join(', ')}] as const`
  const keyCode = `export function ${keyName}(${keySig}){return ${keyExpr}}`
  const keyCall = `${keyName}(${paramPass.join(', ')})`

  const variablesType = isBodyMethod
    ? `{ body: ${argsType}[0]; options${optMark}: ${argsType}[1] }`
    : `{ options${optMark}: ${argsType}[0] }`
  const mutationFnBlock = isBodyMethod
    ? `mutationFn:async({body,options})=>{const{data,error}=await ${callExpr}(body,options);if(error)throw error;return data},`
    : `mutationFn:async({options})=>{const{data,error}=await ${callExpr}(options);if(error)throw error;return data},`

  const mutationOptionsName = `${funcName}MutationOptions`
  const factoryCode = makeMutationFactoryCode(
    mutationOptionsName,
    keySig,
    keyCall,
    dataT,
    errorT,
    variablesType,
    mutationFnBlock,
  )
  const factoryCall = `${mutationOptionsName}<TError>(${paramPass.join(', ')})`
  const mutationGenerics = `<TError = ${errorT}>`
  const mutationOptionsParam = makeMutationOptionsParam(config, dataT, 'TError', variablesType)
  const hookSig = [...paramSig, mutationOptionsParam].join(', ')
  const bodyExpr = makeMutationHookBody(config, dataT, variablesType, factoryCall)
  const hookCode = `export function ${hookName}${mutationGenerics}(${hookSig}){return ${bodyExpr}}`
  return `${keyCode}\n\n${factoryCode}\n\n${hookCode}`
}

function makeSwrHeader(config: QueryHookConfig, client: string, importPath: string, deps: OpDeps) {
  const swrImport = deps.isQuery
    ? `import useSWR from 'swr'\nimport type { SWRConfiguration } from 'swr'\n`
    : ''
  const swrImmutableImport =
    deps.isQuery && config.immutableQueryFn
      ? `import ${config.immutableQueryFn} from 'swr/immutable'\n`
      : ''
  const swrInfiniteImport = deps.isInfinite
    ? `import useSWRInfinite from 'swr/infinite'\nimport type { SWRInfiniteConfiguration } from 'swr/infinite'\n`
    : ''
  const swrMutationImport = deps.isMutation
    ? `import useSWRMutation from 'swr/mutation'\nimport type { SWRMutationConfiguration } from 'swr/mutation'\n`
    : ''
  return `${swrImport}${swrImmutableImport}${swrInfiniteImport}${swrMutationImport}import { ${client} } from '${importPath}'\n\n`
}

function makeHeader(config: QueryHookConfig, client: string, importPath: string, deps: OpDeps) {
  if (config.isSWR) {
    return makeSwrHeader(config, client, importPath, deps)
  }
  const pkg = config.packageName
  const suspenseValue = config.suspenseQueryFn ? `, ${config.suspenseQueryFn}` : ''
  const suspenseType = config.suspenseQueryOptionsType ? `, ${config.suspenseQueryOptionsType}` : ''
  const suspenseInfiniteValue = config.suspenseInfiniteQueryFn
    ? `, ${config.suspenseInfiniteQueryFn}`
    : ''
  const suspenseInfiniteType = config.suspenseInfiniteOptionsType
    ? `, ${config.suspenseInfiniteOptionsType}`
    : ''
  const queryValueImport = deps.isQuery
    ? `import { ${config.queryFn}${suspenseValue}, queryOptions } from '${pkg}'\n`
    : ''
  const queryTypeImport = deps.isQuery
    ? `import type { ${config.queryOptionsType}${suspenseType} } from '${pkg}'\n`
    : ''
  // Infinite hooks that consume an `infiniteQueryOptions(...)` factory (see
  // makeTanstackInfiniteParts) also import the helper value. Every infinite path types its
  // extra options with the `*InfiniteQueryOptions` types over `InfiniteData`.
  const infiniteValueImport = deps.isInfinite
    ? config.hasInfiniteQueryOptionsHelper
      ? `import { ${config.infiniteQueryFn}${suspenseInfiniteValue}, infiniteQueryOptions } from '${pkg}'\n`
      : `import { ${config.infiniteQueryFn}${suspenseInfiniteValue} } from '${pkg}'\n`
    : ''
  const infiniteTypeImport = deps.isInfinite
    ? `import type { ${config.infiniteOptionsType}, InfiniteData${suspenseInfiniteType} } from '${pkg}'\n`
    : ''
  const mutationValueImport = deps.isMutation
    ? `import { ${config.mutationFn}, mutationOptions } from '${pkg}'\n`
    : ''
  const mutationTypeImport = deps.isMutation
    ? `import type { ${config.mutationOptionsType} } from '${pkg}'\n`
    : ''
  const sharedContextImport =
    (config.queryFnContext && deps.isQuery) || deps.isInfinite
      ? `import type { QueryFunctionContext } from '${pkg}'\n`
      : ''
  return `${queryValueImport}${queryTypeImport}${infiniteValueImport}${infiniteTypeImport}${mutationValueImport}${mutationTypeImport}${sharedContextImport}import { ${client} } from '${importPath}'\n\n`
}

export function makeQueryHooks(
  openAPI: OpenAPI,
  output: string,
  importPath: string,
  config: QueryHookConfig,
  client: string,
  basePath?: string,
  split = false,
) {
  return Effect.gen(function* () {
    const prefix = basePath && basePath !== '/' ? basePath : ''
    const ops: {
      funcName: string
      code: string
      prefix: string
      deps: OpDeps
      fetchType?: string
    }[] = []
    for (const [pathStr, pathItem] of pathEntries(openAPI)) {
      if (!pathItem) continue
      for (const method of HTTP_METHODS) {
        const rawOperation = pathItem[method]
        if (!rawOperation) continue
        // Resolve `$ref` parameters (SwaggerParser.bundle leaves internal refs
        // intact) so requiredOptions/hasKeyArgs can read `in`/`required` — a
        // `{ $ref }` param otherwise reads as no required query and the hook types
        // options as optional, breaking exactOptionalPropertyTypes (spotify).
        const operation = resolveOperation(rawOperation, openAPI.components)
        const funcName = toSafeIdentifier(
          resolveOperationId(operation, method, `${prefix}${pathStr}`),
        )
        const code = makeOperation(`${prefix}${pathStr}`, method, operation, client, config)
        const keyPrefix = resourcePrefix(`${prefix}${pathStr}`)
        const isQuery = method === 'get' || method === 'head'
        ops.push({
          funcName,
          code,
          prefix: keyPrefix,
          deps: {
            isQuery,
            isInfinite: isQuery && operation['x-pagination'] === true,
            isMutation: !isQuery,
          },
          fetchType: fetchTypeImport(`${prefix}${pathStr}`, operation),
        })
      }
    }
    if (ops.length === 0) return 'No operations found'

    if (split) {
      const prefixKeys = makePrefixKeyCodes(openAPI, prefix)
      const keysCode = prefixKeys.length > 0 ? `${prefixKeys.join('\n\n')}\n` : ''
      if (keysCode && ops.some((op) => op.funcName === 'keys')) {
        return yield* new GenerateError({
          message:
            "Operation file name 'keys.ts' collides with the aggregated cache-key file. Rename the operation (operationId) that resolves to 'keys'.",
        })
      }
      for (const op of ops) {
        const header = makeHeader(config, client, importPath, op.deps)
        const typeImport = op.fetchType
          ? `import type { ${op.fetchType} } from '../components/schemas'\n`
          : ''
        const file = path.join(output, `${op.funcName}.ts`)
        // Written one at a time on purpose: emit() creates the directory before writing, and the
        // failure reported is the first one.
        yield* emit(`${typeImport}${header}${op.code}\n`, output, file)
      }
      if (keysCode) {
        yield* emit(keysCode, output, path.join(output, 'keys.ts'))
      }
      const exportLines = [
        ...(keysCode ? [`export * from './keys'`] : []),
        ...ops.map((op) => `export * from './${op.funcName}'`),
      ]
      const barrel = `${exportLines.join('\n')}\n`
      const indexFile = path.join(output, 'index.ts')
      yield* emit(barrel, output, indexFile)
      return `Generated split ${config.label} code → ${output}/`
    }

    const aggregate = ops.reduce<OpDeps>(
      (acc, op) => ({
        isQuery: acc.isQuery || op.deps.isQuery,
        isInfinite: acc.isInfinite || op.deps.isInfinite,
        isMutation: acc.isMutation || op.deps.isMutation,
      }),
      { isQuery: false, isInfinite: false, isMutation: false },
    )
    const header = makeHeader(config, client, importPath, aggregate)
    const prefixKeys = makePrefixKeyCodes(openAPI, prefix)
    const body = `${[...prefixKeys, ...ops.map((op) => op.code)].join('\n\n')}\n`
    yield* emit(`${header}${body}`, path.dirname(output), output)
    return `Generated ${config.label} code written to ${output}`
  })
}
