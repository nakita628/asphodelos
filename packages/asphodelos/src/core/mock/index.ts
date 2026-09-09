import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import type { MockOptions } from '../../generator/mock/index.js'
import { makeMock } from '../../generator/mock/index.js'
import type { OpenAPI } from '../../openapi/index.js'

// Mock servers are fully generated (handlers are faker stubs with no user logic),
// so the file is overwritten rather than merged.
export function mock(openAPI: OpenAPI, output: string, options: MockOptions = {}) {
  return Effect.gen(function* () {
    const code = makeMock(openAPI, options)
    yield* emit(code, path.dirname(output), output)
    return `Generated mock server written to ${output}`
  })
}
