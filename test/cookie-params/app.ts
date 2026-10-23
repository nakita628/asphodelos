import { Elysia } from 'elysia'

import { CookiesModel } from './__generated__/modules/cookies/model.js'
import { DefaultsModel } from './__generated__/modules/defaults/model.js'
import { OptionalModel } from './__generated__/modules/optional/model.js'
import { RequiredModel } from './__generated__/modules/required/model.js'

type Echo = { valueType: string; valueText: string }

/**
 * Describes one value: the runtime type it arrived as, and the value as text. A `Date` is named
 * as such and written as ISO text, which keeps the instant exact.
 */
function echoValue(value: unknown): Echo {
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  ) {
    return { valueType: typeof value, valueText: String(value) }
  }
  if (value instanceof Date) return { valueType: 'Date', valueText: value.toISOString() }
  return {
    valueType: value === null ? 'null' : typeof value,
    valueText: JSON.stringify(value) ?? 'undefined',
  }
}

/**
 * Describes every cookie in the jar, by name, through the `value` Elysia's cookie jar holds for
 * it. An array is described element by element and an object key by key. A cookie that was not
 * sent and has no default is absent here too.
 */
function echoCookies(jar: Record<string, { readonly value: unknown }>) {
  const described: Record<string, Echo | Echo[] | Record<string, Echo>> = {}
  for (const [name, cookie] of Object.entries(jar)) {
    const value = cookie.value
    if (value === undefined) continue
    if (Array.isArray(value)) {
      described[name] = value.map(echoValue)
    } else if (typeof value === 'object' && value !== null && !(value instanceof Date)) {
      described[name] = Object.fromEntries(
        Object.entries(value).map(([key, item]) => [key, echoValue(item)]),
      )
    } else {
      described[name] = echoValue(value)
    }
  }
  return described
}

/**
 * The cookie each validation issue names, or `''` when Elysia validates a coerced number on its
 * own and reports it without a path.
 */
function issuesOf(error: unknown) {
  const issues: unknown =
    typeof error === 'object' && error !== null && 'all' in error ? error.all : undefined
  if (Array.isArray(issues)) {
    return [
      ...new Set(
        issues.map((issue: unknown) =>
          typeof issue === 'object' && issue !== null && 'path' in issue
            ? String(issue.path).replace(/^\//u, '')
            : '',
        ),
      ),
    ]
  }
  const inner: unknown =
    typeof error === 'object' && error !== null && 'error' in error ? error.error : undefined
  return [
    typeof inner === 'object' && inner !== null && 'path' in inner
      ? String(inner.path).replace(/^\//u, '')
      : '',
  ]
}

/**
 * Every handler answers the cookies its schema validated, so the value a test sees has passed
 * the generated schema — not the raw `Cookie` header. The schemas are the generated models,
 * mounted exactly as the generated controllers mount them.
 */
export const cookieParamsApp = new Elysia()
  // A rejected request names the cookie that failed, so a test can tell which one did.
  .onError(({ code, error, status }) => {
    if (code !== 'VALIDATION') return undefined
    return status(422, { issues: issuesOf(error) })
  })
  .get('/cookies', ({ cookie }) => echoCookies(cookie), {
    cookie: CookiesModel.cookieParamsCookie,
  })
  .get('/optional', ({ cookie }) => echoCookies(cookie), {
    cookie: OptionalModel.cookieOptionalCookie,
  })
  .get('/defaults', ({ cookie }) => echoCookies(cookie), {
    cookie: DefaultsModel.cookieDefaultsCookie,
  })
  .get('/required', ({ cookie }) => echoCookies(cookie), {
    cookie: RequiredModel.cookieRequiredCookie,
  })
