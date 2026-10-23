import { Elysia } from 'elysia'

import { ItemSchema } from './__generated__/components/schemas.js'
import { ComponentModel } from './__generated__/modules/component/model.js'
import { MultipartModel } from './__generated__/modules/multipart/model.js'
import { UrlencodedModel } from './__generated__/modules/urlencoded/model.js'

type Echo = { valueType: string; valueText: string }

/**
 * Describes one value: the runtime type it arrived as, and the value as text. A `Date` is named
 * as such and written as ISO text, and a `File` by its name.
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
  if (value instanceof File) return { valueType: 'File', valueText: value.name }
  return {
    valueType: value === null ? 'null' : typeof value,
    valueText: JSON.stringify(value) ?? 'undefined',
  }
}

/**
 * Describes every validated field, by name. An array is described element by element, so a test
 * can tell `[1, 2]` from `['1', '2']` and from `'1,2'`. A key the schema left out stays out: an
 * absent optional field is absent here too.
 */
function echoFields(fields: Record<string, unknown>) {
  const described: Record<string, Echo | Echo[]> = {}
  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue
    described[name] = Array.isArray(value) ? value.map(echoValue) : echoValue(value)
  }
  return described
}

/**
 * The field each validation issue names, or `''` where Elysia validates a coerced number on its
 * own, or fails to decode a multipart field, and reports it without a path.
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
 * Every handler answers the body its schema validated and nothing else, so the value a test sees
 * has passed the generated schema — not the raw request. The schemas are the generated models and,
 * for the JSON body, the generated component, mounted exactly as the generated controllers mount
 * them: a form body of a component gets a model of its own, read from text.
 */
export const formBodyApp = new Elysia()
  // A rejected request names the field that failed, so a test can tell which one did.
  .onError(({ code, error, status }) => {
    if (code !== 'VALIDATION') return undefined
    return status(422, { issues: issuesOf(error) })
  })
  .post('/urlencoded', ({ body }) => echoFields(body), { body: UrlencodedModel.urlencodedBody })
  .post('/multipart', ({ body }) => echoFields(body), { body: MultipartModel.multipartBody })
  .post('/component', ({ body }) => echoFields(body), { body: ComponentModel.componentBody })
  .post('/json', ({ body }) => echoFields(body), { body: ItemSchema })
