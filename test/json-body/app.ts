import { Elysia } from 'elysia'

import { NumbersModel } from './__generated__/modules/numbers/model.js'
import { TypesModel } from './__generated__/modules/types/model.js'

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
 * Describes every validated field, by name. An array is described element by element, and an
 * object as its JSON text, so a test can tell `[1, 2]` from `['1', '2']`. A key the schema left
 * out stays out: an absent optional field is absent here too.
 */
function echoFields(fields: Record<string, unknown>) {
  const described: Record<string, Echo | Echo[]> = {}
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue
    described[name] = Array.isArray(value) ? value.map(echoValue) : echoValue(value)
  }
  return described
}

/** The field each validation issue names, as a path (`ids/1` for an element). */
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
 * Every handler answers the body its schema validated and nothing else, so the value a test sees
 * has passed the generated schema — not the raw request. The schemas are the generated models,
 * mounted exactly as the generated controllers mount them.
 */
export const jsonBodyApp = new Elysia()
  // A rejected request names the field that failed, so a test can tell which one did.
  .onError(({ code, error, status }) => {
    if (code !== 'VALIDATION') return undefined
    return status(422, { issues: issuesOf(error) })
  })
  .post('/numbers', ({ body }) => echoFields(body), { body: NumbersModel.numbersBody })
  .post('/types', ({ body }) => echoFields(body), { body: TypesModel.typesBody })
