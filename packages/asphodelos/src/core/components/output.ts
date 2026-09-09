import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import {
  callbacksCode,
  examplesCode,
  headersCode,
  linksCode,
  mediaTypesCode,
  parametersCode,
  pathItemsCode,
  requestBodiesCode,
  responsesCode,
  schemasCode,
  securitySchemesCode,
} from '../../generator/components/index.js'
import { makeImports } from '../../helper/index.js'
import type { Components } from '../../openapi/index.js'

/**
 * Emits every component kind into a single file (`components.output` mode).
 * Cross-component references resolve within the same file — `makeImports`
 * skips them since they are locally-defined consts — so it only injects the
 * elysia / typebox runtime imports the combined body needs.
 */
export function components(section: Components | undefined, output: string, readonly?: boolean) {
  return Effect.gen(function* () {
    if (!section) return 'No components found'
    const blocks = [
      schemasCode(section.schemas, readonly),
      responsesCode(section.responses, readonly),
      parametersCode(section.parameters, readonly),
      examplesCode(section.examples),
      requestBodiesCode(section.requestBodies, readonly),
      headersCode(section.headers, readonly),
      securitySchemesCode(section.securitySchemes),
      linksCode(section.links),
      callbacksCode(section.callbacks),
      pathItemsCode(section.pathItems),
      mediaTypesCode(section.mediaTypes, readonly),
    ].filter((block) => block !== '')
    if (blocks.length === 0) return 'No components found'
    const abs = path.resolve(process.cwd(), output)
    const code = makeImports(blocks.join('\n\n'), abs, undefined, false)
    yield* emit(code, path.dirname(abs), abs)
    return `Generated components code written to ${output}`
  })
}
