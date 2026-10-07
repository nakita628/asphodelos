import { Elysia } from 'elysia'

import { AllofModel } from './__generated__/modules/allof/model.js'
import { BooleanModel } from './__generated__/modules/boolean/model.js'
import { ByteModel } from './__generated__/modules/byte/model.js'
import { DateModel } from './__generated__/modules/date/model.js'
import { DatetimeModel } from './__generated__/modules/datetime/model.js'
import { DoubleModel } from './__generated__/modules/double/model.js'
import { EmailModel } from './__generated__/modules/email/model.js'
import { ExclusiveModel } from './__generated__/modules/exclusive/model.js'
import { HostnameModel } from './__generated__/modules/hostname/model.js'
import { IenumModel } from './__generated__/modules/ienum/model.js'
import { Int32Model } from './__generated__/modules/int32/model.js'
import { Int64Model } from './__generated__/modules/int64/model.js'
import { IntegerModel } from './__generated__/modules/integer/model.js'
import { Ipv4Model } from './__generated__/modules/ipv4/model.js'
import { LabelModel } from './__generated__/modules/label/model.js'
import { LengthModel } from './__generated__/modules/length/model.js'
import { MatrixModel } from './__generated__/modules/matrix/model.js'
import { MultipleModel } from './__generated__/modules/multiple/model.js'
import { NamedModel } from './__generated__/modules/named/model.js'
import { NumberModel } from './__generated__/modules/number/model.js'
import { NumericsenumModel } from './__generated__/modules/numericsenum/model.js'
import { OneofModel } from './__generated__/modules/oneof/model.js'
import { OrgsModel } from './__generated__/modules/orgs/model.js'
import { OverrideModel } from './__generated__/modules/override/model.js'
import { ParamrefModel } from './__generated__/modules/paramref/model.js'
import { PasswordModel } from './__generated__/modules/password/model.js'
import { PatternModel } from './__generated__/modules/pattern/model.js'
import { RangeModel } from './__generated__/modules/range/model.js'
import { SchemarefModel } from './__generated__/modules/schemaref/model.js'
import { SconstModel } from './__generated__/modules/sconst/model.js'
import { SenumModel } from './__generated__/modules/senum/model.js'
import { SharedModel } from './__generated__/modules/shared/model.js'
import { SimplearrModel } from './__generated__/modules/simplearr/model.js'
import { StringModel } from './__generated__/modules/string/model.js'
import { TxemailModel } from './__generated__/modules/txemail/model.js'
import { TxupperModel } from './__generated__/modules/txupper/model.js'
import { UuidModel } from './__generated__/modules/uuid/model.js'

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
 * The parameter each validation issue names, or `''` when Elysia validates a coerced number on
 * its own and reports it without a path.
 */
function issuesOf(error: unknown) {
  const issues: unknown =
    typeof error === 'object' && error !== null && 'all' in error ? error.all : undefined
  return Array.isArray(issues)
    ? [
        ...new Set(
          issues.map((issue: unknown) =>
            typeof issue === 'object' && issue !== null && 'path' in issue
              ? String(issue.path).replace(/^\//u, '')
              : '',
          ),
        ),
      ]
    : ['']
}

/**
 * One handler per generated route, each answering the parameter its schema validated, so the
 * value a test sees has passed the generated schema and nothing else. The schemas are the
 * generated models, mounted on the paths the generated controllers mount them on.
 */
export const pathParamsApp = new Elysia()
  // A rejected request names the parameter that failed, so a test can tell which one did.
  .onError(({ code, error, status }) => {
    if (code !== 'VALIDATION') return undefined
    return status(422, { issues: issuesOf(error) })
  })
  .get('/integer/:value', ({ params }) => echoValue(params.value), {
    params: IntegerModel.integerParamParams,
  })
  .get('/int32/:value', ({ params }) => echoValue(params.value), {
    params: Int32Model.int32ParamParams,
  })
  .get('/int64/:value', ({ params }) => echoValue(params.value), {
    params: Int64Model.int64ParamParams,
  })
  .get('/number/:value', ({ params }) => echoValue(params.value), {
    params: NumberModel.numberParamParams,
  })
  .get('/double/:value', ({ params }) => echoValue(params.value), {
    params: DoubleModel.doubleParamParams,
  })
  .get('/boolean/:value', ({ params }) => echoValue(params.value), {
    params: BooleanModel.booleanParamParams,
  })
  .get('/string/:value', ({ params }) => echoValue(params.value), {
    params: StringModel.stringParamParams,
  })
  .get('/email/:value', ({ params }) => echoValue(params.value), {
    params: EmailModel.emailParamParams,
  })
  .get('/uuid/:value', ({ params }) => echoValue(params.value), {
    params: UuidModel.uuidParamParams,
  })
  .get('/hostname/:value', ({ params }) => echoValue(params.value), {
    params: HostnameModel.hostnameParamParams,
  })
  .get('/ipv4/:value', ({ params }) => echoValue(params.value), {
    params: Ipv4Model.ipv4ParamParams,
  })
  .get('/date/:value', ({ params }) => echoValue(params.value), {
    params: DateModel.dateParamParams,
  })
  .get('/datetime/:value', ({ params }) => echoValue(params.value), {
    params: DatetimeModel.datetimeParamParams,
  })
  .get('/byte/:value', ({ params }) => echoValue(params.value), {
    params: ByteModel.byteParamParams,
  })
  .get('/password/:value', ({ params }) => echoValue(params.value), {
    params: PasswordModel.passwordParamParams,
  })
  .get('/senum/:value', ({ params }) => echoValue(params.value), {
    params: SenumModel.senumParamParams,
  })
  .get('/sconst/:value', ({ params }) => echoValue(params.value), {
    params: SconstModel.sconstParamParams,
  })
  .get('/numericsenum/:value', ({ params }) => echoValue(params.value), {
    params: NumericsenumModel.numericsenumParamParams,
  })
  .get('/range/:value', ({ params }) => echoValue(params.value), {
    params: RangeModel.rangeParamParams,
  })
  .get('/exclusive/:value', ({ params }) => echoValue(params.value), {
    params: ExclusiveModel.exclusiveParamParams,
  })
  .get('/multiple/:value', ({ params }) => echoValue(params.value), {
    params: MultipleModel.multipleParamParams,
  })
  .get('/length/:value', ({ params }) => echoValue(params.value), {
    params: LengthModel.lengthParamParams,
  })
  .get('/pattern/:value', ({ params }) => echoValue(params.value), {
    params: PatternModel.patternParamParams,
  })
  .get(
    '/orgs/:orgId/repos/:repoId/issues/:issueId',
    ({ params }) => ({
      orgId: echoValue(params.orgId),
      repoId: echoValue(params.repoId),
      issueId: echoValue(params.issueId),
    }),
    { params: OrgsModel.multiParamParams },
  )
  .get(
    '/named/:user-id/:post_id',
    ({ params }) => ({
      'user-id': echoValue(params['user-id']),
      post_id: echoValue(params.post_id),
    }),
    { params: NamedModel.namedParamParams },
  )
  .get('/paramref/:id', ({ params }) => echoValue(params.id), {
    params: ParamrefModel.paramrefParamParams,
  })
  .get('/schemaref/:value', ({ params }) => echoValue(params.value), {
    params: SchemarefModel.schemarefParamParams,
  })
  .get('/shared/:id', ({ params }) => echoValue(params.id), {
    params: SharedModel.sharedGetParamParams,
  })
  .delete('/shared/:id', ({ params }) => echoValue(params.id), {
    params: SharedModel.sharedDeleteParamParams,
  })
  .get('/override/:id', ({ params }) => echoValue(params.id), {
    params: OverrideModel.overrideParamParams,
  })
  .get('/txupper/:value', ({ params }) => echoValue(params.value), {
    params: TxupperModel.txupperParamParams,
  })
  .get('/txemail/:value', ({ params }) => echoValue(params.value), {
    params: TxemailModel.txemailParamParams,
  })
  .get('/allof/:value', ({ params }) => echoValue(params.value), {
    params: AllofModel.allofParamParams,
  })
  .get('/oneof/:value', ({ params }) => echoValue(params.value), {
    params: OneofModel.oneofParamParams,
  })
  .get('/label/:value', ({ params }) => echoValue(params.value), {
    params: LabelModel.labelParamParams,
  })
  .get('/matrix/:value', ({ params }) => echoValue(params.value), {
    params: MatrixModel.matrixParamParams,
  })
  .get('/simplearr/:value', ({ params }) => echoValue(params.value), {
    params: SimplearrModel.simplearrParamParams,
  })
  .get('/ienum/:value', ({ params }) => echoValue(params.value), {
    params: IenumModel.ienumParamParams,
  })
