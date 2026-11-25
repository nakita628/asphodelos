import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../emit/index.js'
import type { OpenAPI, Operation, Responses } from '../openapi/index.js'
import {
  capitalize,
  filterDefined,
  methodPath,
  pascalCase,
  resourcePrefix,
} from '../utils/index.js'
import { edenChain } from './eden.js'
import { HTTP_METHODS, makePrefixKeyCodes, resolveOperation } from './openapi.js'
import { responseInfo } from './schema.js'

/**
 * The trailing argument a library's hooks take after their options: a `QueryClient` (an accessor
 * of one in Solid and Svelte). The hooks forward it, so a caller can target a client other than
 * the provided one. SWR and Angular take none.
 */
type HookTail = {
  readonly name: string
  readonly query: string
  readonly infinite: string
  readonly mutation: string
  readonly imports: readonly string[]
}

export type QueryHookConfig = {
  readonly label: string
  readonly packageName: string
  readonly hookPrefix: string
  readonly queryFn: string
  readonly mutationFn: string
  readonly infiniteQueryFn: string
  readonly immutableQueryFn?: string
  readonly isSWR?: boolean
  /** Solid, Svelte and Angular take the options as a thunk, `() => options`. */
  readonly useThunk?: boolean
  /** Solid aliases every option type to `Accessor<...>`; the caller's slot is the unwrapped object. */
  readonly unwrapOptionsAccessor?: boolean
  /** Vue: a path parameter may be a ref, the option types are `MaybeRef` unions, and there is no options helper. */
  readonly isVueQuery?: boolean
  readonly suspenseQueryFn?: string
  readonly suspenseInfiniteQueryFn?: string
  readonly queryOptionsType?: string
  readonly suspenseQueryOptionsType?: string
  readonly mutationOptionsType?: string
  readonly infiniteOptionsType?: string
  readonly suspenseInfiniteOptionsType?: string
  readonly hookTail?: HookTail
}

// The hook supplies these itself, so the caller's slot leaves them out — the shape
// openapi-react-query uses. The libraries type `queryKey` as required, which otherwise forces the
// caller to pass a key the hook then overwrites, and leaves `select` unable to bind TData.
const QUERY_OMIT_KEYS = `'queryKey' | 'queryFn'`
// Infinite hooks also supply both page-param functions, from `pagination`.
const INFINITE_OMIT_KEYS = `'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'`
// Mutation hooks supply `mutationFn` — the operation contract that types `data` — so the slot
// leaves it out. `mutationKey` stays: mutations are not cached, so the key is metadata rather than
// identity (`useIsMutating` / `setMutationDefaults` go by it), and the hook honours the caller's
// key over the factory's, the way the SWR mutation hook honours `swrKey`.
const MUTATION_OMIT_KEYS = `'mutationFn'`

// Vue's option types are unions — `MaybeRef<{...}>` (`Ref | ComputedRef | object`), plus a getter
// for mutations — and a plain `Omit` over a union keeps only the keys every member shares: none.
// The hook spreads the value, which only works on the plain object anyway, so `Extract` keeps that
// member. For queries it is the only one with the required `queryKey`. Mutation options are all
// optional, so the probe is a weak type: a `Ref` (only `value`) and a getter (no properties) share
// nothing with it and drop out, while the plain object matches.
const VUE_QUERY_MEMBER = `{ queryKey: unknown }`
const VUE_MUTATION_MEMBER = `{ mutationFn?: unknown }`

/** The caller's options slot: the library type, unwrapped for Solid, narrowed for Vue, minus the keys the hook supplies. */
function slotType(config: QueryHookConfig, optionsType: string, keys: string, vueMember?: string) {
  const objectType = config.isVueQuery
    ? `Extract<${optionsType}, ${vueMember ?? VUE_QUERY_MEMBER}>`
    : config.unwrapOptionsAccessor
      ? `ReturnType<${optionsType}>`
      : optionsType
  return `Omit<${objectType}, ${keys}>`
}

function tailOf(config: QueryHookConfig, kind: 'query' | 'infinite' | 'mutation') {
  const tail = config.hookTail
  return tail
    ? { sig: `, ${tail.name}?: ${tail[kind]}`, arg: `, ${tail.name}` }
    : { sig: '', arg: '' }
}

/**
 * One operation as the hooks see it: how its path parameters are passed, what its request
 * options are, what it answers with, and how a request is written. The Eden client gives one
 * shape, a path Eden cannot type another (see {@link fetchTarget}); the hooks are written the
 * same way over either.
 */
type Target = {
  /** The path parameters, in order: `params`, `params2`, … with their types. */
  readonly params: readonly { readonly name: string; readonly type: string }[]
  /** The request options the operation takes: query, headers, fetch. */
  readonly optionsType: string
  /** Whether a required query or header makes the options mandatory. */
  readonly requiredOptions: boolean
  /** Whether the options take part in the cache key (the operation has query parameters). */
  readonly hasKeyArgs: boolean
  /** The members of the options that never belong in a cache key. */
  readonly keyDrops: readonly string[]
  readonly dataT: string
  readonly errorT: string
  /** For a mutation: the request body type, when the method carries one. */
  readonly bodyType?: string
  /** Whether the body is required in the mutation variables. */
  readonly bodyRequired: boolean
  /**
   * The statements of a `queryFn`, given the expressions for each path parameter and the options.
   * `signal` forwards the query function's abort signal to the request; SWR has none.
   */
  readonly queryBody: (
    paramExprs: readonly string[],
    optionsExpr: string,
    signal: boolean,
  ) => string
  /** The statements of a `mutationFn`, given the expressions for the path parameters, body and options. */
  readonly mutationBody: (
    paramExprs: readonly string[],
    bodyExpr: string,
    optionsExpr: string,
  ) => string
  /** The schema consts of the response components a `fetch` fallback types its data by, to import. */
  readonly fetchTypes?: readonly string[]
  /** Whether the requests are a `fetch` fallback's, whose URL starts at the client's origin. */
  readonly usesFetch: boolean
  /** Whether a `fetch` fallback builds a search string from the options' query. */
  readonly usesSearch: boolean
  /** Whether a `fetch` fallback rejects with a `FetchError`, whose type the hooks file declares. */
  readonly usesFetchError?: boolean
}

// Eden treaty projects a path onto a property/function tree, so a segment it cannot turn into a
// clean node breaks the whole chain: a partial param (`/{Sid}.json` — a `{param}` mixed with static
// text has no function node) and, transitively, every sibling under the same resource. A segment
// carrying a `.` or a partial param marks the path as untypeable through Eden, and the hooks fall
// back to a literal-path `fetch`.
function needsFetchHook(pathStr: string) {
  return pathStr
    .split('/')
    .filter(Boolean)
    .some((seg) => seg.includes('.') || (seg.includes('{') && !/^\{[^}]+\}$/u.test(seg)))
}

function pathParamNames(pathStr: string): readonly string[] {
  return [...pathStr.matchAll(/\{([^}]+)\}/gu)].map((m) => m[1] ?? '')
}

/** How a `fetch` fallback reads a successful response. */
type Read = 'json' | 'text' | 'bytes' | 'stream'

// How a `fetch` fallback reads a response declared under this media type key. JSON is anything
// that says so (`application/json`, `+json`, `text/json`) and anything that does not say what it
// is: a range such as the `*/*` of a controller without `produces`, which was parsed as JSON
// before the hooks told media types apart. An event stream is not read at all: a single read does
// not fit it. Text is `text/*` in UTF-8, the one charset `res.text()` decodes: a `text/csv;
// charset=shift_jis` is handed over as the bytes it is.
function mediaRead(key: string): Read {
  const [head = '', ...parameters] = key.split(';').map((part) => part.trim().toLowerCase())
  if (head === 'text/event-stream') return 'stream'
  if (head.includes('json') || head.includes('*')) return 'json'
  const charset = parameters.find((parameter) => parameter.startsWith('charset='))?.slice(8)
  const utf8 = charset === undefined || /^["']?utf-?8["']?$/u.test(charset)
  return head.startsWith('text/') && utf8 ? 'text' : 'bytes'
}

// One response entry's data type and how it is read. A component `$ref` resolves to `Static` of
// its schema const, which the schemas module always exports — its type alias (`Account`) only
// with `exportTypes`; inline and empty responses degrade to a safe wide type. The const is named
// the way the schemas generator named it (`schemaNames`): keys that differ only in case (`User`,
// `user`) share a pascal-cased name, and all but the first are written under a suffixed one
// (`User2Schema`). An entry that declares only an event stream has no data: it is not supported.
function entryRead(
  response: Responses,
  schemaNames: ReadonlyMap<string, string> | undefined,
): { readonly dataT?: string; readonly importName?: string; readonly read: Read } {
  const info = responseInfo(response)
  if (info.ref) {
    const ident = schemaNames?.get(info.ref) ?? `${pascalCase(info.ref)}Schema`
    return { dataT: `Static<typeof ${ident}>`, importName: ident, read: 'json' }
  }
  if (!info.void) return { dataT: 'unknown', read: 'json' }
  // No JSON schema: the response is read as what it declares, and typed as what is read — text
  // for text alone, bytes once any other media type is among them (a `text/csv` beside an
  // `application/pdf` is bytes too: text read from bytes can be decoded, bytes read as text are
  // lost). With a JSON media type among them it is parsed as before. An event stream beside
  // another media type is left to the other one.
  const all = new Set(Object.keys(response.content ?? {}).map(mediaRead))
  if (all.size === 0) return { dataT: 'null', read: 'json' }
  const reads = new Set([...all].filter((read) => read !== 'stream'))
  if (reads.size === 0) return { read: 'stream' }
  if (reads.has('json')) return { dataT: 'unknown', read: 'json' }
  return reads.has('bytes')
    ? { dataT: 'ArrayBuffer', read: 'bytes' }
    : { dataT: 'string', read: 'text' }
}

// The data type for a fetch fallback comes from its successful responses — the Eden chain that
// normally yields it is untypeable here: every `2xx` entry (`200`, `2XX`), or `default` when there
// is none. The data is the union of what each entry resolves with. Where the entries are read the
// same way, the hook reads every response that way; where they differ (a `200` of `text/csv`
// beside a `202` of JSON), it reads each response by the entry of its status, the exact code
// before its range (`206` before `2XX`), and the widest way they are read where none matches.
function successType(
  operation: Operation,
  schemaNames: ReadonlyMap<string, string> | undefined,
): {
  readonly dataT: string
  readonly importNames: readonly string[]
  /** How the body is read; left out for JSON, which is what `readResponse` reads by default. */
  readonly reads?: Exclude<Read, 'json'> | { readonly [status: string]: Read }
} {
  const responses = Object.entries(operation.responses ?? {})
  const success = responses.filter(([status]) => status.startsWith('2'))
  // `default` stands for every status not listed, an error body more often than not: it is the
  // success only of an operation that declares nothing else.
  const declared =
    success.length > 0
      ? success
      : responses.length === 1
        ? responses.filter(([status]) => status === 'default')
        : []
  if (declared.length === 0) return { dataT: 'null', importNames: [] }
  const entries = declared.map(([status, response]) =>
    Object.assign(entryRead(response, schemaNames), { status: status.toUpperCase() }),
  )
  const types = [...new Set(entries.flatMap((entry) => (entry.dataT ? [entry.dataT] : [])))]
  const dataT = types.length === 0 || types.includes('unknown') ? 'unknown' : types.join(' | ')
  // A schema const is imported only when its type is spelled out: `unknown` takes in the rest.
  const importNames =
    dataT === 'unknown'
      ? []
      : [...new Set(entries.flatMap((entry) => (entry.importName ? [entry.importName] : [])))]
  const kinds = new Set(entries.map((entry) => entry.read))
  const [only] = kinds
  if (kinds.size === 1) {
    return only === undefined || only === 'json'
      ? { dataT, importNames }
      : { dataT, importNames, reads: only }
  }
  // Every entry is listed, JSON too, so an exact code is read by its own entry, not its range's. A
  // status the document does not list is read the widest way its entries with a body are: JSON
  // when one of them is, bytes when one of them is, text otherwise.
  const bodies = new Set(
    entries.filter((entry) => entry.dataT !== 'null').map((entry) => entry.read),
  )
  const fallback: Read = bodies.has('json') ? 'json' : bodies.has('bytes') ? 'bytes' : 'text'
  const byStatus = Object.fromEntries([
    ...entries.map((entry) => [entry.status, entry.read] as const),
    ...(fallback === 'json' ? [] : [['default', fallback] as const]),
  ])
  return { dataT, importNames, reads: byStatus }
}

function isBodyMethod(method: string) {
  return method === 'post' || method === 'put' || method === 'patch' || method === 'delete'
}

function edenTarget(
  fullPath: string,
  method: string,
  operation: Operation,
  client: string,
): Target {
  const { callExpr, methodHostTypeExpr, paramArgs } = edenChain(fullPath, client, method)
  const argsType = `Parameters<${methodHostTypeExpr}>`
  // Eden treaty types every method except get/head as `(body, options)`: the first argument is the
  // request body, the second the query/header options.
  const withBody = isBodyMethod(method)
  const optionsType = withBody ? `${argsType}[1]` : `${argsType}[0]`
  // Eden's `Awaited<ReturnType<M>>` is a discriminated union: the success branch is
  // `{ data: SuccessData; error: null }`, the error branch `{ data: null; error: Err }`. The success
  // branch is picked by `error: null` — `Exclude<data, null>` would drop a legitimately nullable
  // response — and the error by excluding the `null` that only the success branch carries.
  const response = `Awaited<ReturnType<${methodHostTypeExpr}>>`
  // A required query or header makes Eden's options argument required as well, so the hooks
  // cannot type it as optional without collapsing the required member.
  const requiredOptions = (operation.parameters ?? []).some(
    (p) => 'in' in p && (p.in === 'query' || p.in === 'header') && p.required === true,
  )
  const call = (exprs: readonly string[]) =>
    paramArgs.reduce(
      (acc, param, index) => acc.replace(`(${param.name})`, `(${exprs[index] ?? param.name})`),
      callExpr,
    )
  const access = requiredOptions ? '.' : '?.'
  return {
    params: paramArgs.map((p) => ({ name: p.name, type: p.typeExpr })),
    optionsType,
    requiredOptions,
    hasKeyArgs: (operation.parameters ?? []).some((p) => ('in' in p ? p.in === 'query' : true)),
    keyDrops: ['headers', 'fetch', 'throwHttpError'],
    dataT: `Extract<${response}, { error: null }>['data']`,
    errorT: `Exclude<${response}['error'], null>`,
    ...(withBody ? { bodyType: `${argsType}[0]` } : {}),
    // Eden types the body of a method without a schema as an optional `unknown`, so the variables
    // leave it optional too and a DELETE is triggered with `{}`.
    bodyRequired: operation.requestBody !== undefined,
    queryBody: (exprs, options, signal) =>
      `const{data,error}=await ${call(exprs)}(${signal ? `{...${options},fetch:{...${options}${access}fetch,signal}}` : options});if(error)throw error;return data`,
    mutationBody: (exprs, body, options) =>
      `const{data,error}=await ${call(exprs)}(${withBody ? `${body},${options}` : options});if(error)throw error;return data`,
    usesFetch: false,
    usesSearch: false,
  }
}

/** The origin the client module exports beside the client, which a `fetch` fallback's URL starts at. */
const ORIGIN = 'clientOrigin'

/** The JSON reviver a `fetch` fallback parses its response with, written into the hooks file. */
const REVIVER = 'reviveDate'

// Eden Treaty parses a JSON response with a reviver that turns a date string into a `Date`, and
// the schemas say `t.Date()` for a `format: date` / `date-time` string, so `Static` of a response
// component promises a `Date`. A fetch fallback parses the same way, with the patterns Eden tests
// a string by (ISO 8601, `Date.prototype.toString()` and a short `2026-01-02` / `01/02/2026`
// form), so both kinds of hook hand over the same value for the same schema. Eden does not export
// its reviver, so the hooks file carries its own. Like Eden's, it goes by the value and not by the
// schema: a plain string that looks like a date is revived too, and a date the patterns miss (no
// offset, a year outside 1900–2099) is not. What JSON cannot carry otherwise (`t.Uint8Array`,
// `t.File`, a `t.Transform`) stays as the wire sent it.
const REVIVER_CODE = String.raw`const ISO8601=/(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d+([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))|(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d([+-][0-2]\d:[0-5]\d|Z))/u

const FORMAL_DATE=/(?:Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s\d{2}\s\d{4}\s\d{2}:\d{2}:\d{2}\sGMT(?:\+|-)\d{4}\s\([^)]+\)/u

const SHORTENED_DATE=/^(?:(?:(?:(?:0?[1-9]|[12][0-9]|3[01])[/\s-](?:0?[1-9]|1[0-2])[/\s-](?:19|20)\d{2})|(?:(?:19|20)\d{2}[/\s-](?:0?[1-9]|1[0-2])[/\s-](?:0?[1-9]|[12][0-9]|3[01]))))(?:\s(?:1[012]|0?[1-9]):[0-5][0-9](?::[0-5][0-9])?(?:\s[AP]M)?)?$/u

function ${REVIVER}(_key:string,value:unknown){if(typeof value!=='string')return value;const text=value.replace(/"/gu,'');if(!ISO8601.test(text)&&!FORMAL_DATE.test(text)&&!SHORTENED_DATE.test(text))return value;const date=new Date(text);return Number.isNaN(date.getTime())?value:date}`

/** What reads a `fetch` fallback's response, written into the hooks file beside the reviver. */
const READER = 'readResponse'

// `res.json()` types as `unknown`, which the annotated return type rejects; `JSON.parse` of the
// text is `any`, which it takes without a cast — and it takes the reviver, which `json()` does not.
// A response without content (a `204`, an empty `200`) has no JSON to parse and is typed `null`,
// so it resolves with `null`: TanStack Query does not take `undefined` as a query's data, and
// every library and hook kind resolves the same. A response the document declares as text or as
// another media type is not JSON — a path with a `.txt` or `.pdf` segment is the kind that falls back — and is
// read as declared (`as`): its text as it is, or its bytes, empty or not, so it is what the
// hook's `string` or `ArrayBuffer` says. Where the statuses are declared as different media types,
// `as` maps a status (`206`) or its range (`2XX`) to its read, and any other status to `default`,
// or JSON. An event stream is not supported: the hook rejects with an `Error` that says so, without reading
// the stream to its end. A failed response, and a successful one whose body is not the JSON it
// should be (a proxy's HTML page), rejects with a `FetchError`: an `Error` carrying the `status`
// and the body as `value`, parsed as JSON with its dates revived when it is JSON and the text
// otherwise. These are the two members of Eden's error, the error is never falsy, and it has one
// shape whatever the body is.
const READER_CODE = `async function ${READER}(res:Response,as:Read|{readonly[status:string]:Read}='json'){const read=typeof as==='string'?as:(as[res.status]??as[\`\${String(res.status)[0]}XX\`]??as.default??'json');if(res.ok&&read==='stream'){await res.body?.cancel().catch(()=>{});throw Object.assign(new Error('A text/event-stream response is not supported by a fetch hook'),{status:res.status,value:undefined})}if(res.ok&&read==='bytes')return res.arrayBuffer();const text=await res.text();const fail=(value:unknown,note=''):FetchError=>Object.assign(new Error(\`\${res.status} \${res.statusText}\`.trim()+note),{status:res.status,value});if(res.ok){if(read==='text')return text;if(text.trim()==='')return null;try{return JSON.parse(text,${REVIVER})}catch{throw fail(text,': the body is not JSON')}}let value:unknown;try{value=JSON.parse(text,${REVIVER})}catch{value=text}throw fail(value)}`

/** How the reader reads a successful response, declared beside it. */
const READ_TYPE_CODE = `type Read='json'|'text'|'bytes'|'stream'`

/** What a `fetch` fallback rejects with: Eden's error, as an `Error`. */
const ERROR_TYPE_CODE = `export type FetchError=Error&{readonly status:number;readonly value:unknown}`

/** What turns anything a `fetch` fallback throws into a `FetchError`. */
const TO_FETCH_ERROR = 'toFetchError'

// A `FetchError` from the reader is kept. An abort is the library's own cancellation and is kept as
// it is. Anything else (a network `TypeError`, a body that cannot be written) becomes a `FetchError`
// with `status` 0 and the error as `value`, so every rejection has the shape the hooks' `TError`
// says.
const TO_FETCH_ERROR_CODE = `function ${TO_FETCH_ERROR}(error:unknown):unknown{if(error instanceof Error&&'status' in error&&'value' in error)return error;if(error instanceof Error&&error.name==='AbortError')return error;return Object.assign(new Error(error instanceof Error?error.message:String(error)),{status:0,value:error})}`

// Whatever fails before the response is read (the network, a body `JSON.stringify` cannot write)
// rejects with a `FetchError` too, its `status` 0 and the error as `value`.
function guard(body: string) {
  return `try{${body}}catch(error){throw ${TO_FETCH_ERROR}(error)}`
}

/** What builds a `fetch` fallback's search string from the options' query. */
const SEARCH = 'toSearch'

// The search string is built the way Eden Treaty builds its own: a `Date` goes out as its ISO
// string, which is what a `format: date-time` parameter reads (`String(date)` is the
// `Tue Nov 24 2026 …` form), an object as its JSON, an array repeats its key, and `null` and
// `undefined` — as a value or as an item — are left out.
const SEARCH_CODE = `function ${SEARCH}(query:Record<string,unknown>|undefined){const search=new URLSearchParams();for(const[key,value]of Object.entries(query??{})){for(const item of Array.isArray(value)?value:[value]){if(item===undefined||item===null)continue;search.append(key,item instanceof Date?item.toISOString():typeof item==='object'?JSON.stringify(item):String(item))}}return search}`

// A literal-path `fetch` for an operation Eden cannot type: path parameters are strings in a URL,
// the query is spread into the search string, and the body is JSON. The URL starts at the
// client's origin, so the request goes where the client's do. The path parameters are named the
// way the Eden hooks name theirs, `params`, `params2`, …, so a parameter the document calls
// `search`, `res` or `clientOrigin` cannot hide what the body reads by that name.
function fetchTarget(
  fullPath: string,
  method: string,
  operation: Operation,
  schemaNames: ReadonlyMap<string, string> | undefined,
): Target {
  const names = pathParamNames(fullPath)
  const params = names.map((_, index) => (index === 0 ? 'params' : `params${index + 1}`))
  const hasQuery = (operation.parameters ?? []).some((p) => 'in' in p && p.in === 'query')
  const optionsType = hasQuery
    ? '{ headers?: Record<string, string>; query?: Record<string, unknown> }'
    : '{ headers?: Record<string, string> }'
  const withBody = isBodyMethod(method)
  // A `HEAD` answers with headers alone: whatever its `2xx` declares, the body is empty.
  const { dataT, importNames, reads } =
    method === 'head'
      ? { dataT: 'null', importNames: [], reads: undefined }
      : successType(operation, schemaNames)
  const as =
    reads === undefined
      ? ''
      : typeof reads === 'string'
        ? `,'${reads}'`
        : `,${JSON.stringify(reads)}`
  // Awaited, so a body that fails while it is read stays inside the guard's `try`.
  const read = `return await ${READER}(res${as})`
  // An operation that answers with nothing but an event stream cannot be read: the hook rejects
  // without opening the stream, so a library's retries do not open it again and again.
  const streamOnly = reads === 'stream'
  const unsupported = `throw Object.assign(new Error('A text/event-stream response is not supported by a fetch hook'),{status:0,value:undefined})`
  const url = (exprs: readonly string[]) => {
    const inner = fullPath.replaceAll(/\{([^}]+)\}/gu, (_, n: string) => {
      const index = names.indexOf(n)
      return `\${encodeURIComponent(${exprs[index] ?? params[index]})}`
    })
    // A path key that carries its own query string (`/jobs/{id}?beta=true`) is followed by `&`.
    const separator = inner.includes('?') ? '&' : '?'
    return hasQuery
      ? `\`\${${ORIGIN}}${inner}\${search.size ? \`${separator}\${search}\` : ''}\``
      : `\`\${${ORIGIN}}${inner}\``
  }
  const search = (options: string) => (hasQuery ? `const search=${SEARCH}(${options}?.query);` : '')
  return {
    params: params.map((name) => ({ name, type: 'string' })),
    optionsType,
    requiredOptions: false,
    hasKeyArgs: hasQuery,
    keyDrops: ['headers'],
    dataT,
    errorT: 'FetchError',
    ...(withBody ? { bodyType: 'unknown' } : {}),
    bodyRequired: false,
    queryBody: (exprs, options, signal) =>
      streamOnly
        ? unsupported
        : guard(
            `${search(options)}const res=await fetch(${url(exprs)},{${method === 'head' ? "method:'HEAD'," : ''}headers:${options}?.headers${signal ? ',signal' : ''}});${read}`,
          ),
    mutationBody: (exprs, body, options) =>
      streamOnly
        ? unsupported
        : guard(
            `${search(options)}const res=await fetch(${url(exprs)},{method:'${method.toUpperCase()}',headers:{'content-type':'application/json',...${options}?.headers},body:${body}===undefined?undefined:JSON.stringify(${body})});${read}`,
          ),
    fetchTypes: importNames,
    // A hook that sends no request needs neither the client's origin nor the helpers.
    usesFetch: !streamOnly,
    usesSearch: hasQuery && !streamOnly,
    usesFetchError: true,
  }
}

/** The names of one query operation's hooks and helpers. */
type Names = {
  readonly hook: string
  readonly suspense: string
  readonly immutable: string
  readonly infinite: string
  readonly suspenseInfinite: string
  readonly key: string
  readonly options: string
  readonly infiniteKey: string
  readonly infiniteOptions: string
}

// GET is the resource's default read, so its names carry only the path (`useUsers`,
// `getUsersQueryKey`). HEAD keeps its method (`useHeadUsers`) so it can sit next to the GET on the
// same path, the way the mutation names do (`usePostUsers`). SWR names keep the method throughout
// (`useGetUsers`, `getGetUsersKey`).
function queryNames(config: QueryHookConfig, method: string, pathStr: string): Names {
  const name = capitalize(methodPath(method === 'get' ? '' : method, pathStr))
  const full = capitalize(methodPath(method, pathStr))
  if (config.isSWR) {
    return {
      hook: `${config.hookPrefix}${full}`,
      suspense: '',
      immutable: `${config.hookPrefix}Immutable${full}`,
      infinite: `${config.hookPrefix}Infinite${full}`,
      suspenseInfinite: '',
      key: `get${full}Key`,
      options: '',
      infiniteKey: `get${full}InfiniteKey`,
      infiniteOptions: '',
    }
  }
  return {
    hook: `${config.hookPrefix}${name}`,
    suspense: `${config.hookPrefix}Suspense${name}`,
    immutable: '',
    infinite: `${config.hookPrefix}Infinite${name}`,
    suspenseInfinite: `${config.hookPrefix}SuspenseInfinite${name}`,
    key: `get${name}QueryKey`,
    options: `get${name}QueryOptions`,
    infiniteKey: `get${name}InfiniteQueryKey`,
    infiniteOptions: `get${name}InfiniteQueryOptions`,
  }
}

/**
 * How the path parameters are spelled: plain values, thunks (the hooks of Solid, Svelte and
 * Angular), or refs (Vue). The key getters and factories take plain values — refs in Vue, so a
 * key can follow one — and the hooks pass theirs on to them.
 */
type Spelling = {
  /** The parameter list for the path parameters. */
  readonly paramSig: (target: Target) => readonly string[]
  /** The expressions that read each path parameter's value inside a body. */
  readonly paramRead: (target: Target) => readonly string[]
  /** The expressions a hook passes its path parameters on with, to a key getter or factory. */
  readonly paramPass: (target: Target) => readonly string[]
}

const PLAIN: Spelling = {
  paramSig: (target) => target.params.map((p) => `${p.name}: ${p.type}`),
  paramRead: (target) => target.params.map((p) => p.name),
  paramPass: (target) => target.params.map((p) => p.name),
}
const THUNK: Spelling = {
  paramSig: (target) => target.params.map((p) => `${p.name}: () => ${p.type}`),
  paramRead: (target) => target.params.map((p) => `${p.name}()`),
  paramPass: (target) => target.params.map((p) => `${p.name}()`),
}
const REF: Spelling = {
  paramSig: (target) => target.params.map((p) => `${p.name}: MaybeRefOrGetter<${p.type}>`),
  paramRead: (target) => target.params.map((p) => `toValue(${p.name})`),
  paramPass: (target) => target.params.map((p) => p.name),
}

/** How the key getters and factories of a library spell the path parameters. */
function baseSpelling(config: QueryHookConfig): Spelling {
  return config.isVueQuery ? REF : PLAIN
}

/** How the hooks of a library spell the path parameters. */
function hookSpelling(config: QueryHookConfig): Spelling {
  if (config.useThunk) return THUNK
  return baseSpelling(config)
}

/**
 * The cache key getter of a query: `['<prefix>', '<path>', ...params, keyArgs?]`, where `keyArgs`
 * is the options without the members that never identify a resource (headers, fetch). The
 * structured key lets a caller invalidate by prefix, by endpoint or by one request. An infinite
 * query puts `'infinite'` after the path, so its prefix matches infinite lists only.
 *
 * @see https://tanstack.com/query/latest/docs/framework/react/guides/query-keys
 */
function keyGetterCode(
  name: string,
  target: Target,
  spelling: Spelling,
  prefix: string,
  fullPath: string,
  marker?: string,
) {
  const sig = [
    ...spelling.paramSig(target),
    ...(target.hasKeyArgs
      ? [`options${target.requiredOptions ? '' : '?'}: ${target.optionsType}`]
      : []),
  ]
  const drops = target.keyDrops.map((key, index) => `${key}:_${String.fromCodePoint(97 + index)}`)
  const keyArgs = target.hasKeyArgs ? `const{${drops.join(',')},...keyArgs}=options??{};` : ''
  const tuple = [
    `'${prefix}'`,
    `'${fullPath}'`,
    ...(marker ? [`'${marker}'`] : []),
    ...spelling.paramRead(target),
    ...(target.hasKeyArgs ? ['keyArgs'] : []),
  ].join(', ')
  return `export function ${name}(${sig.join(', ')}){${keyArgs}return[${tuple}]as const}`
}

function keyCall(name: string, target: Target, spelling: Spelling, optionsExpr: string) {
  const args = [...spelling.paramPass(target), ...(target.hasKeyArgs ? [optionsExpr] : [])]
  return `${name}(${args.join(', ')})`
}

// Vue hooks take a path parameter as `MaybeRefOrGetter`, so the key has to follow it: a plain
// getter call unwraps once at setup and freezes the key, and a changed `Ref` would never refetch.
// `computed` keeps it live — Vue Query unwraps `MaybeRefDeep` keys itself. The key getters stay
// plain arrays, which is what invalidation and cache lookups want.
function vueKey(target: Target, call: string) {
  return target.params.length > 0 ? `computed(()=>${call})` : call
}

/**
 * The hook's `options` parameter: the caller's slot beside the request options, optional unless
 * the request options are required. Thunk libraries take the whole object as `() => {...}`.
 */
function hookOptions(
  config: QueryHookConfig,
  target: Target,
  slotName: 'query' | 'mutation',
  slot: string,
  withClientOptions = true,
) {
  const required = target.requiredOptions && withClientOptions
  const members = [
    `${slotName}?: ${slot}`,
    ...(withClientOptions
      ? [`options${target.requiredOptions ? '' : '?'}: ${target.optionsType}`]
      : []),
  ]
  const type = `{ ${members.join('; ')} }`
  return {
    sig: `options${required ? '' : '?'}: ${config.useThunk ? `() => ${type}` : type}`,
    // How the body reads its options: a thunk is called, a plain object is used as it is.
    read: config.useThunk
      ? required
        ? 'options()'
        : 'options?.()??{}'
      : required
        ? 'options'
        : 'options??{}',
  }
}

/**
 * A GET: key getter, `queryOptions` factory, hook and suspense hook.
 *
 * The request is written once, in the factory, and the hooks spread it with the caller's
 * options: `{ ...getXQueryOptions<TData, TError>(params, clientOptions), ...query }`. The factory
 * carries the hooks' `<TData, TError>` so that spread type-checks — `queryOptions()` bakes both
 * into its result. Vue is the exception: its `MaybeRef` option types do not take the branded
 * factory, so its factory is a plain object and its hooks write the key and the request inline.
 */
function queryCode(
  config: QueryHookConfig,
  names: Names,
  target: Target,
  prefix: string,
  fullPath: string,
) {
  const base = baseSpelling(config)
  const hooks = hookSpelling(config)
  const keyCode = keyGetterCode(names.key, target, base, prefix, fullPath)
  const keyType = `ReturnType<typeof ${names.key}>`
  const reads = base.paramRead(target)
  const factorySig = [
    ...base.paramSig(target),
    `options${target.requiredOptions ? '' : '?'}: ${target.optionsType}`,
  ].join(', ')
  const generics = `<TData = ${target.dataT}, TError = ${target.errorT}>`
  const tail = tailOf(config, 'query')
  if (config.isVueQuery) {
    const factory = `export function ${names.options}(${factorySig}){return{queryKey:${vueKey(target, keyCall(names.key, target, base, 'options'))},queryFn:async({signal}:QueryFunctionContext)=>{${target.queryBody(reads, 'options', true)}}}}`
    const slot = slotType(
      config,
      `${config.queryOptionsType}<${target.dataT}, TError, TData, ${target.dataT}, ${keyType}>`,
      QUERY_OMIT_KEYS,
    )
    const options = hookOptions(config, target, 'query', slot)
    const hook = `export function ${names.hook}${generics}(${[...base.paramSig(target), options.sig].join(', ')}${tail.sig}){const{query:queryOptions,options:clientOptions}=${options.read};return ${config.queryFn}({...queryOptions,queryKey:${vueKey(target, keyCall(names.key, target, base, 'clientOptions'))},queryFn:async({signal})=>{${target.queryBody(reads, 'clientOptions', true)}}}${tail.arg})}`
    return [keyCode, factory, hook]
  }
  const factory = `export function ${names.options}${generics}(${factorySig}){return queryOptions<${target.dataT},TError,TData,${keyType}>({queryKey:${keyCall(names.key, target, base, 'options')},queryFn:async({signal})=>{${target.queryBody(reads, 'options', true)}}})}`
  const factoryCall = `${names.options}<TData,TError>(${[...hooks.paramPass(target), 'clientOptions'].join(', ')})`
  const hookOf = (hookName: string, queryFn: string, optionsType: string) => {
    const slot = slotType(
      config,
      `${optionsType}<${target.dataT}, TError, TData, ${keyType}>`,
      QUERY_OMIT_KEYS,
    )
    const options = hookOptions(config, target, 'query', slot)
    const sig = [...hooks.paramSig(target), options.sig].join(', ')
    if (config.useThunk) {
      return `export function ${hookName}${generics}(${sig}${tail.sig}){return ${queryFn}(()=>{const{query,options:clientOptions}=${options.read};return{...${factoryCall},...query}}${tail.arg})}`
    }
    return `export function ${hookName}${generics}(${sig}${tail.sig}){const{query:queryOptions,options:clientOptions}=${options.read};return ${queryFn}({...${factoryCall},...queryOptions}${tail.arg})}`
  }
  const parts = [
    keyCode,
    factory,
    hookOf(names.hook, config.queryFn, config.queryOptionsType ?? ''),
  ]
  if (config.suspenseQueryFn && config.suspenseQueryOptionsType) {
    parts.push(hookOf(names.suspense, config.suspenseQueryFn, config.suspenseQueryOptionsType))
  }
  return parts
}

/**
 * A paginated GET (`x-pagination: true`): infinite key getter, `infiniteQueryOptions` factory,
 * infinite hook and suspense infinite hook.
 *
 * `pagination` carries the three page-param concerns TanStack v5 requires that the flag cannot
 * supply: where paging starts, how to read the next page param from a page, and how a page param
 * maps onto the request options (`getRequestArgs`). The factory carries the hooks' generics and
 * the hooks spread it. Vue Query's helper types `initialPageParam` as `MaybeRefDeep<TPageParam>`,
 * which a generic parameter never satisfies, so Vue gets a plain factory and inline hooks, with the
 * page-param functions traveling in the caller's `query` slot.
 */
function infiniteCode(
  config: QueryHookConfig,
  names: Names,
  target: Target,
  prefix: string,
  fullPath: string,
) {
  const base = baseSpelling(config)
  const hooks = hookSpelling(config)
  const keyCode = keyGetterCode(names.infiniteKey, target, base, prefix, fullPath, 'infinite')
  const keyType = `ReturnType<typeof ${names.infiniteKey}>`
  const reads = base.paramRead(target)
  const optionsSig = `options${target.requiredOptions ? '' : '?'}: ${target.optionsType}`
  const tail = tailOf(config, 'infinite')
  const requestArgs = `getRequestArgs: (options: ${target.optionsType}, pageParam: unknown) => ${target.optionsType}`
  // `TPageParam` comes first so the `TData` default can name it: `data.pageParams` is then typed
  // by `initialPageParam` rather than `unknown`. A direct call still infers it from `pagination`.
  const generics = `<TPageParam = unknown, TData = InfiniteData<${target.dataT}, TPageParam>, TError = ${target.errorT}>`
  const pageBody = (options: string) =>
    `const page=pagination.getRequestArgs(${options},pageParam);${target.queryBody(reads, 'page', true)}`
  if (config.isVueQuery) {
    const factorySig = [...base.paramSig(target), `pagination: { ${requestArgs} }`, optionsSig]
    const factory = `export function ${names.infiniteOptions}<TPageParam = unknown>(${factorySig.join(', ')}){return{queryKey:${vueKey(target, keyCall(names.infiniteKey, target, base, 'options'))},queryFn:async({pageParam,signal}:QueryFunctionContext<${keyType},TPageParam>)=>{${pageBody('options')}}}}`
    // The page-param functions have no other way in, so the `query` slot is required here.
    const slot = slotType(
      config,
      `${config.infiniteOptionsType}<${target.dataT}, TError, TData, ${keyType}, TPageParam>`,
      QUERY_OMIT_KEYS,
    )
    const sig = [
      ...base.paramSig(target),
      `pagination: { ${requestArgs} }`,
      `options: { query: ${slot}; ${optionsSig} }`,
    ].join(', ')
    const hook = `export function ${names.infinite}${generics}(${sig}${tail.sig}){const{query:queryOptions,options:clientOptions}=options;return ${config.infiniteQueryFn}({...queryOptions,queryKey:${vueKey(target, keyCall(names.infiniteKey, target, base, 'clientOptions'))},queryFn:async({pageParam,signal}:QueryFunctionContext<${keyType},TPageParam>)=>{${pageBody('clientOptions')}}}${tail.arg})}`
    return [keyCode, factory, hook]
  }
  const pagination = `pagination: { initialPageParam: TPageParam; getNextPageParam: (lastPage: ${target.dataT}, allPages: ${target.dataT}[], lastPageParam: TPageParam, allPageParams: TPageParam[]) => TPageParam | undefined | null; ${requestArgs} }`
  const factorySig = [...base.paramSig(target), pagination, optionsSig].join(', ')
  const factory = `export function ${names.infiniteOptions}${generics}(${factorySig}){return infiniteQueryOptions<${target.dataT},TError,TData,${keyType},TPageParam>({queryKey:${keyCall(names.infiniteKey, target, base, 'options')},queryFn:async({pageParam,signal}:QueryFunctionContext<${keyType},TPageParam>)=>{${pageBody('options')}},initialPageParam:pagination.initialPageParam,getNextPageParam:pagination.getNextPageParam})}`
  const factoryCall = `${names.infiniteOptions}<TPageParam,TData,TError>(${[...hooks.paramPass(target), 'pagination', 'clientOptions'].join(', ')})`
  const hookOf = (hookName: string, queryFn: string, optionsType: string) => {
    const slot = slotType(
      config,
      `${optionsType}<${target.dataT}, TError, TData, ${keyType}, TPageParam>`,
      INFINITE_OMIT_KEYS,
    )
    const options = hookOptions(config, target, 'query', slot)
    const sig = [...hooks.paramSig(target), pagination, options.sig].join(', ')
    if (config.useThunk) {
      return `export function ${hookName}${generics}(${sig}${tail.sig}){return ${queryFn}(()=>{const{query,options:clientOptions}=${options.read};return{...${factoryCall},...query}}${tail.arg})}`
    }
    return `export function ${hookName}${generics}(${sig}${tail.sig}){const{query:queryOptions,options:clientOptions}=${options.read};return ${queryFn}({...${factoryCall},...queryOptions}${tail.arg})}`
  }
  const parts = [
    keyCode,
    factory,
    hookOf(names.infinite, config.infiniteQueryFn, config.infiniteOptionsType ?? ''),
  ]
  if (config.suspenseInfiniteQueryFn && config.suspenseInfiniteOptionsType) {
    parts.push(
      hookOf(
        names.suspenseInfinite,
        config.suspenseInfiniteQueryFn,
        config.suspenseInfiniteOptionsType,
      ),
    )
  }
  return parts
}

/** The variables a mutation takes: the body, when the method carries one, beside the request options. */
function variablesType(target: Target) {
  const options = `options${target.requiredOptions ? '' : '?'}: ${target.optionsType}`
  return target.bodyType
    ? `{ body${target.bodyRequired ? '' : '?'}: ${target.bodyType}; ${options} }`
    : `{ ${options} }`
}

/**
 * A mutation: key getter, `mutationOptions` factory and hook.
 *
 * The variables are `{ body, options }` for a method that carries a body and `{ options }` for the
 * rest, so the request is spelled out at the call to `mutate`. The hook spreads the caller's
 * options first and the factory after it, so the operation contract wins — `Omit` only rejects a
 * fresh object literal — and then restores the caller's `mutationKey`.
 */
function mutationCode(
  config: QueryHookConfig,
  method: string,
  pathStr: string,
  target: Target,
  prefix: string,
  fullPath: string,
) {
  const base = baseSpelling(config)
  const hooks = hookSpelling(config)
  const name = capitalize(methodPath(method, pathStr))
  const hookName = `${config.hookPrefix}${name}`
  const keyName = `get${name}MutationKey`
  const factoryName = `get${name}MutationOptions`
  const keyCode = `export function ${keyName}(){return['${prefix}', '${fullPath}', '${method.toUpperCase()}']as const}`
  const variables = variablesType(target)
  const destructure = target.bodyType ? '{body,options}' : '{options}'
  const bodyExpr = target.bodyType ? 'body' : 'undefined'
  const generics = `<TError = ${target.errorT}, TOnMutateResult = unknown>`
  const factory = `export function ${factoryName}${generics}(${base.paramSig(target).join(', ')}){return mutationOptions<${target.dataT},TError,${variables},TOnMutateResult>({mutationKey:${keyName}(),mutationFn:async(${destructure})=>{${target.mutationBody(base.paramRead(target), bodyExpr, 'options')}}})}`
  const factoryCall = `${factoryName}<TError,TOnMutateResult>(${hooks.paramPass(target).join(', ')})`
  const slot = slotType(
    config,
    `${config.mutationOptionsType}<${target.dataT}, TError, ${variables}, TOnMutateResult>`,
    MUTATION_OMIT_KEYS,
    VUE_MUTATION_MEMBER,
  )
  const options = hookOptions(config, target, 'mutation', slot, false)
  const tail = tailOf(config, 'mutation')
  const sig = [...hooks.paramSig(target), options.sig].join(', ')
  const merge = `{...mutation,...mutationDefaults,mutationKey:mutation?.mutationKey??mutationDefaults.mutationKey}`
  if (config.useThunk) {
    return [
      keyCode,
      factory,
      `export function ${hookName}${generics}(${sig}${tail.sig}){return ${config.mutationFn}(()=>{const{mutation}=${options.read};const mutationDefaults=${factoryCall};return ${merge}}${tail.arg})}`,
    ]
  }
  return [
    keyCode,
    factory,
    `export function ${hookName}${generics}(${sig}${tail.sig}){const{mutation}=${options.read};const mutationDefaults=${factoryCall};return ${config.mutationFn}(${merge}${tail.arg})}`,
  ]
}

/**
 * SWR: `useSWR` and `useSWRImmutable` hooks for a GET, and `useSWRInfinite` for a paginated one.
 * A hook takes `{ swr, options }`: `swr` is the SWR configuration plus `swrKey`, which replaces
 * the generated key, and `enabled`, which turns the key into `null` — how SWR is told not to
 * fetch. The hook answers with the key it used beside SWR's own result.
 */
function swrQueryCode(
  config: QueryHookConfig,
  names: Names,
  target: Target,
  prefix: string,
  fullPath: string,
  paginated: boolean,
) {
  const keyCode = keyGetterCode(names.key, target, PLAIN, prefix, fullPath)
  const params = PLAIN.paramSig(target)
  const reads = PLAIN.paramRead(target)
  const mark = target.requiredOptions ? '' : '?'
  const swrOptions = `SWRConfiguration<${target.dataT}, TError> & { swrKey?: Key; enabled?: boolean }`
  const sig = [
    ...params,
    `options${mark}: { swr?: ${swrOptions}; options${mark}: ${target.optionsType} }`,
  ]
  const read = mark === '' ? 'options' : 'options??{}'
  const hookOf = (hookName: string, swrFn: string) =>
    `export function ${hookName}<TError = ${target.errorT}>(${sig.join(', ')}){const{swr:swrOptions,options:clientOptions}=${read};const{swrKey:customKey,enabled,...restSwrOptions}=swrOptions??{};const swrKey=enabled!==false?(customKey===undefined?${keyCall(names.key, target, PLAIN, 'clientOptions')}:customKey):null;return{swrKey,...${swrFn}<${target.dataT},TError>(swrKey,async()=>{${target.queryBody(reads, 'clientOptions', false)}},restSwrOptions)}}`
  const parts = [keyCode, hookOf(names.hook, config.queryFn)]
  if (config.immutableQueryFn) parts.push(hookOf(names.immutable, config.immutableQueryFn))
  if (!paginated) return parts
  const infiniteKeyCode = keyGetterCode(
    names.infiniteKey,
    target,
    PLAIN,
    prefix,
    fullPath,
    'infinite',
  )
  const loaderKey = `readonly [...ReturnType<typeof ${names.infiniteKey}>, number]`
  const infiniteSwr = `SWRInfiniteConfiguration<${target.dataT}, TError> & { swrKey?: (index: number, previousPageData: ${target.dataT} | null) => ${loaderKey} | null; enabled?: boolean }`
  const infiniteSig = [
    ...params,
    `options: { swr?: ${infiniteSwr}; options${mark}: ${target.optionsType}; pagination: { getRequestArgs: (options: ${target.optionsType}, index: number) => ${target.optionsType} } }`,
  ]
  // The page index comes after the prefix, the path, 'infinite', the params and the key args.
  const leading = 3 + target.params.length + (target.hasKeyArgs ? 1 : 0)
  const infinite = `export function ${names.infinite}<TError = ${target.errorT}>(${infiniteSig.join(', ')}){const{swr:swrOptions,options:clientOptions,pagination}=options;const{swrKey:customKeyLoader,enabled,...restSwrOptions}=swrOptions??{};const keyLoader=enabled!==false?(customKeyLoader??((index:number)=>[...${keyCall(names.infiniteKey, target, PLAIN, 'clientOptions')},index]as const)):()=>null;return useSWRInfinite(keyLoader,async([${','.repeat(leading)}index]:${loaderKey})=>{const page=pagination.getRequestArgs(clientOptions,index);${target.queryBody(reads, 'page', false)}},restSwrOptions)}`
  parts.push(infiniteKeyCode, infinite)
  return parts
}

/** SWR: a `useSWRMutation` hook, taking `{ mutation }` with `swrKey` replacing the generated key. */
function swrMutationCode(
  config: QueryHookConfig,
  method: string,
  pathStr: string,
  target: Target,
  prefix: string,
  fullPath: string,
) {
  const name = capitalize(methodPath(method, pathStr))
  const hookName = `${config.hookPrefix}${name}`
  const keyName = `get${name}Key`
  const keyCode = `export function ${keyName}(){return['${prefix}', '${fullPath}', '${method.toUpperCase()}']as const}`
  const variables = variablesType(target)
  const mutationOptions = `SWRMutationConfiguration<${target.dataT}, TError, Key, ${variables}> & { swrKey?: Key; throwOnError?: boolean }`
  const sig = [...PLAIN.paramSig(target), `options?: { mutation?: ${mutationOptions} }`]
  const bodyExpr = target.bodyType ? 'arg.body' : 'undefined'
  const hook = `export function ${hookName}<TError = ${target.errorT}>(${sig.join(', ')}){const{mutation:mutationOptions}=options??{};const{swrKey:customKey,...restMutationOptions}=mutationOptions??{};const swrKey=customKey??${keyName}();return{swrKey,...useSWRMutation<${target.dataT},TError,Key,${variables}>(swrKey,async(_key:Key,{arg}:{arg:${variables}})=>{${target.mutationBody(PLAIN.paramRead(target), bodyExpr, 'arg.options')}},restMutationOptions)}}`
  return [keyCode, hook]
}

/** Every hook and helper of one operation, in the order they are written. */
function operationCode(
  config: QueryHookConfig,
  pathStr: string,
  fullPath: string,
  method: (typeof HTTP_METHODS)[number],
  operation: Operation,
  client: string,
  schemaNames: ReadonlyMap<string, string> | undefined,
) {
  const target = needsFetchHook(fullPath)
    ? fetchTarget(fullPath, method, operation, schemaNames)
    : edenTarget(fullPath, method, operation, client)
  const prefix = resourcePrefix(fullPath)
  const isQuery = method === 'get' || method === 'head'
  const paginated = isQuery && operation['x-pagination'] === true
  const names = queryNames(config, method, pathStr)
  const code = config.isSWR
    ? isQuery
      ? swrQueryCode(config, names, target, prefix, fullPath, paginated)
      : swrMutationCode(config, method, pathStr, target, prefix, fullPath)
    : isQuery
      ? [
          ...queryCode(config, names, target, prefix, fullPath),
          ...(paginated ? infiniteCode(config, names, target, prefix, fullPath) : []),
        ]
      : mutationCode(config, method, pathStr, target, prefix, fullPath)
  return {
    code: code.join('\n\n'),
    fetchTypes: target.fetchTypes,
    usesFetch: target.usesFetch,
    usesSearch: target.usesSearch,
    usesFetchError: target.usesFetchError === true,
  }
}

/**
 * The imports of a hooks file, read off the code it holds: a value and a type import from the
 * library, Vue's helpers when a ref is read, the response components the fetch fallbacks type
 * their data by, and the client, with its origin when a fetch fallback builds a URL from it. A
 * name is imported only when the file uses it, so a document with no mutation imports nothing a
 * mutation would.
 */
function headerCode(
  config: QueryHookConfig,
  client: string,
  importPath: string,
  body: string,
  fetchTypes: readonly string[],
  schemasImport: string,
  usesFetch: boolean,
) {
  // A value is used where it is called or given type arguments; the hooks' local variables
  // (`queryOptions`, `mutationOptions`) are not that.
  const calls = (name: string) => new RegExp(`\\b${name}\\s*[<(]`, 'u').test(body)
  const names = (name: string) => new RegExp(`\\b${name}\\b`, 'u').test(body)
  const lines: string[] = []
  if (config.isSWR) {
    if (calls('useSWR')) lines.push("import useSWR from 'swr'")
    if (calls('useSWRImmutable')) lines.push("import useSWRImmutable from 'swr/immutable'")
    const swrTypes = ['Key', 'SWRConfiguration'].filter(names)
    if (swrTypes.length > 0) lines.push(`import type { ${swrTypes.join(', ')} } from 'swr'`)
    if (calls('useSWRInfinite')) {
      lines.push(
        "import useSWRInfinite from 'swr/infinite'",
        "import type { SWRInfiniteConfiguration } from 'swr/infinite'",
      )
    }
    if (calls('useSWRMutation')) {
      lines.push(
        "import useSWRMutation from 'swr/mutation'",
        "import type { SWRMutationConfiguration } from 'swr/mutation'",
      )
    }
  } else {
    const values = [
      ...new Set(
        filterDefined([
          config.queryFn,
          config.suspenseQueryFn,
          config.infiniteQueryFn,
          config.suspenseInfiniteQueryFn,
          config.mutationFn,
          'queryOptions',
          'infiniteQueryOptions',
          'mutationOptions',
        ]),
      ),
    ].filter(calls)
    const types = [
      ...new Set(
        filterDefined([
          config.queryOptionsType,
          'QueryFunctionContext',
          config.suspenseQueryOptionsType,
          config.infiniteOptionsType,
          config.suspenseInfiniteOptionsType,
          'InfiniteData',
          config.mutationOptionsType,
          ...(config.hookTail?.imports ?? []),
        ]),
      ),
    ].filter(names)
    if (values.length > 0) {
      lines.push(`import { ${values.join(', ')} } from '${config.packageName}'`)
    }
    if (types.length > 0) {
      lines.push(`import type { ${types.join(', ')} } from '${config.packageName}'`)
    }
    const vue = ['computed', 'toValue'].filter(calls)
    if (vue.length > 0) lines.push(`import { ${vue.join(', ')} } from 'vue'`)
    if (names('MaybeRefOrGetter')) lines.push("import type { MaybeRefOrGetter } from 'vue'")
  }
  if (fetchTypes.length > 0) {
    lines.push(
      "import type { Static } from 'elysia'",
      `import type { ${fetchTypes.join(', ')} } from '${schemasImport}'`,
    )
  }
  const clientImports = usesFetch ? [client, ORIGIN] : [client]
  lines.push(`import { ${clientImports.join(', ')} } from '${importPath}'`)
  return `${lines.join('\n')}\n\n`
}

export function makeQueryHooks(
  openAPI: OpenAPI,
  output: string,
  importPath: string,
  config: QueryHookConfig,
  client: string,
  basePath?: string,
  schemasImport = './components/schemas',
  schemaNames?: ReadonlyMap<string, string>,
) {
  return Effect.gen(function* () {
    const prefix = basePath && basePath !== '/' ? basePath : ''
    const operations = Object.entries(openAPI.paths ?? {}).flatMap(([pathStr, pathItem]) =>
      pathItem
        ? HTTP_METHODS.flatMap((method) => {
            const rawOperation = pathItem[method]
            if (!rawOperation) return []
            // `$ref` parameters are resolved so `in` / `required` can be read: a `{ $ref }` param
            // otherwise reads as no required query and the hook types options as optional.
            const operation = resolveOperation(rawOperation, openAPI.components)
            return [
              operationCode(
                config,
                pathStr,
                `${prefix}${pathStr}`,
                method,
                operation,
                client,
                schemaNames,
              ),
            ]
          })
        : [],
    )
    if (operations.length === 0) return 'No operations found'
    const usesFetch = operations.some((op) => op.usesFetch)
    const body = `${[
      ...(operations.some((op) => op.usesFetchError) ? [ERROR_TYPE_CODE] : []),
      ...(usesFetch ? [REVIVER_CODE, READ_TYPE_CODE, READER_CODE, TO_FETCH_ERROR_CODE] : []),
      ...(operations.some((op) => op.usesSearch) ? [SEARCH_CODE] : []),
      ...makePrefixKeyCodes(openAPI, prefix),
      ...operations.map((op) => op.code),
    ].join('\n\n')}\n`
    // A fetch hook types its data by the component the response names, which lives in the
    // generated schemas module rather than behind the Eden client.
    const fetchTypes = [...new Set(operations.flatMap((op) => op.fetchTypes ?? []))].toSorted()
    const header = headerCode(
      config,
      client,
      importPath,
      body,
      fetchTypes,
      schemasImport,
      usesFetch,
    )
    yield* emit(`${header}${body}`, path.dirname(output), output)
    return `Generated ${config.label} code written to ${output}`
  })
}
