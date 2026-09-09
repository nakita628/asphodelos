import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import { GenerateError } from '../../error/index.js'
import { readFile } from '../../fsp/index.js'
import { appFile } from '../../generator/app/index.js'
import { controllerFile } from '../../generator/controller/index.js'
import { modelFile } from '../../generator/model/index.js'
import { serviceFile } from '../../generator/service/index.js'
import {
  makeModuleSpec,
  moduleComponentRefs,
  moduleInlineSchemas,
  operationsByResource,
} from '../../helper/index.js'
import { mergeSource } from '../../merge/index.js'
import type { OpenAPI } from '../../openapi/index.js'

/** Keeps whatever the user already wrote in `output` when regenerating over it. */
function merged(code: string, output: string) {
  return Effect.gen(function* () {
    const existing = yield* readFile(output)
    return existing === null ? code : mergeSource(existing, code)
  })
}

export function elysia(
  api: OpenAPI,
  options: {
    output?: string
    prefix?: string
    port?: string
    integration?: boolean
    readonly?: boolean
    pathAlias?: string
    components?: {
      readonly [k: string]: {
        readonly output: string
        readonly split?: boolean
        readonly import?: string
      }
    }
    componentsOutput?: string
  } = {},
) {
  return Effect.gen(function* () {
    const byResource = operationsByResource(api)
    const resources = [...byResource.keys()]
    if (resources.length === 0) {
      return yield* new GenerateError({ message: 'no operations found in OpenAPI document' })
    }

    const components = api.components ?? {}
    const componentSchemas = components.schemas ?? {}
    const componentNames = new Set(Object.keys(componentSchemas))

    const appOutput = options.output ?? 'src/index.ts'
    const appAbs = path.resolve(process.cwd(), appOutput)
    const baseDir = path.dirname(appAbs)
    const modulesDir = path.join(baseDir, 'modules')
    const schemasImportFromModule = (() => {
      const fromFile = path.join(modulesDir, '_', 'index.ts')
      if (options.componentsOutput) {
        const target = path.resolve(process.cwd(), options.componentsOutput)
        return makeModuleSpec(fromFile, { output: target, split: false })
      }
      const cfg = options.components?.schemas
      if (cfg?.import) return cfg.import
      if (cfg?.output) {
        const target = path.resolve(process.cwd(), cfg.output)
        return makeModuleSpec(fromFile, { output: target, split: cfg.split })
      }
      return options.pathAlias ? `${options.pathAlias}/schemas` : '../../components/schemas'
    })()

    function writeResource(resource: string) {
      return Effect.gen(function* () {
        const items = byResource.get(resource) ?? []
        const routes = items.map((i) => i.route)
        const inline = items.flatMap((i) => i.inlineSchemas)
        const inlineSchemas = moduleInlineSchemas(inline)
        const refs = [
          ...moduleComponentRefs(routes, inline, componentNames, componentSchemas),
        ].toSorted()
        const dir = path.join(modulesDir, resource)
        const servicePath = path.join(dir, 'service.ts')
        const controllerPath = path.join(dir, 'index.ts')
        const [serviceCode, controllerCode] = yield* Effect.all(
          [
            merged(serviceFile(resource), servicePath),
            merged(
              controllerFile(resource, routes, refs, componentNames, schemasImportFromModule),
              controllerPath,
            ),
          ],
          { concurrency: 'unbounded' },
        )
        const model = modelFile(
          resource,
          inlineSchemas,
          componentNames,
          schemasImportFromModule,
          options.readonly,
        )
        return [
          emit(model, dir, path.join(dir, 'model.ts')),
          emit(serviceCode, dir, servicePath),
          emit(controllerCode, dir, controllerPath),
        ]
      })
    }

    const appCode = yield* merged(
      appFile(resources, {
        prefix: options.prefix,
        integration: options.integration,
        port: options.port,
      }),
      appAbs,
    )
    const moduleWrites = yield* Effect.all(resources.map(writeResource), {
      concurrency: 'unbounded',
    })
    yield* Effect.all([emit(appCode, baseDir, appAbs), ...moduleWrites.flat()], {
      concurrency: 'unbounded',
    })

    return `Generated ${resources.length} module(s) (${resources.join(', ')}) → ${path.posix.dirname(appOutput)}/`
  })
}
