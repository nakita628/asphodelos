import { Elysia } from 'elysia'

import { DefaultsModel } from './__generated__/modules/defaults/model.js'
import { InheritedModel } from './__generated__/modules/inherited/model.js'
import { LimitationsModel } from './__generated__/modules/limitations/model.js'
import { LimitsModel } from './__generated__/modules/limits/model.js'
import { LiteralsModel } from './__generated__/modules/literals/model.js'
import { OptionalModel } from './__generated__/modules/optional/model.js'
import { ParamsModel } from './__generated__/modules/params/model.js'
import { RefsModel } from './__generated__/modules/refs/model.js'
import { RequiredModel } from './__generated__/modules/required/model.js'

type Echo = { valueType: string; valueText: string }

/**
 * Describes one value: the runtime type it arrived as, and the value as text.
 *
 * A `Date` is named as such — `format: date` and `format: date-time` are read into one by the
 * generated `t.Date()` — and written as ISO text, which keeps the instant exact.
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
 * Describes every validated parameter, by name. An array is described element by element, so a
 * test can tell `[1, 2]` from `['1', '2']` and from `'1,2'`. A key the schema left out stays out:
 * an absent optional parameter is absent here too.
 */
function echoFields(fields: object) {
  const described: Record<string, Echo | Echo[]> = {}
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue
    described[name] = Array.isArray(value) ? value.map(echoValue) : echoValue(value)
  }
  return described
}

/**
 * The parameter each validation issue names, or `''` when Elysia validates a coerced number on
 * its own and reports it without a path. An array that could not be read as one fails in
 * Elysia's decode step, which carries a single issue at the array's path.
 */
function issuesOf(error: unknown) {
  const issues: unknown =
    typeof error === 'object' && error !== null && 'all' in error ? error.all : undefined
  if (Array.isArray(issues)) {
    // Elysia reports a missing required field once per branch of the schema it tried, so the
    // names are deduplicated: which parameters failed is the question, not how many times.
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
 * Every handler answers the query its schema validated and nothing else, so the value a test sees
 * has passed the generated schema — not the raw request. The schemas are the generated models,
 * mounted exactly as the generated controllers mount them.
 */
export const queryParamsApp = new Elysia()
  // A rejected request names the parameter that failed, so a test can tell which one did.
  .onError(({ code, error, status }) => {
    if (code !== 'VALIDATION') return undefined
    return status(422, { issues: issuesOf(error) })
  })
  .get('/params', ({ query }) => echoFields(query), { query: ParamsModel.queryParamsQuery })
  .get('/literals', ({ query }) => echoFields(query), {
    query: LiteralsModel.queryLiteralsQuery,
  })
  .get('/optional', ({ query }) => echoFields(query), {
    query: OptionalModel.queryOptionalQuery,
  })
  .get('/defaults', ({ query }) => echoFields(query), {
    query: DefaultsModel.queryDefaultsQuery,
  })
  .get('/required', ({ query }) => echoFields(query), {
    query: RequiredModel.queryRequiredQuery,
  })
  .get('/limits', ({ query }) => echoFields(query), { query: LimitsModel.queryLimitsQuery })
  .get('/refs', ({ query }) => echoFields(query), { query: RefsModel.queryRefsQuery })
  .get('/inherited', ({ query }) => echoFields(query), {
    query: InheritedModel.queryInheritedQuery,
  })
  .get('/limitations', ({ query }) => echoFields(query), {
    query: LimitationsModel.queryLimitationsQuery,
  })
