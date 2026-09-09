import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import { GenerateError } from '../../error/index.js'
import { requestBodiesCode } from '../../generator/components/index.js'
import { makeImports, makeBarrel } from '../../helper/index.js'
import type { Components } from '../../openapi/index.js'
import { uncapitalize } from '../../utils/index.js'

export function requestBodies(
  section: Components['requestBodies'],
  output: string,
  split: boolean,
  exportTypes: boolean,
  components?: {
    readonly [k: string]: {
      readonly output: string
      readonly split?: boolean
      readonly import?: string
    }
  },
  readonly?: boolean,
) {
  return Effect.gen(function* () {
    if (!section) return yield* new GenerateError({ message: 'No requestBodies found' })
    const entries = Object.entries(section)
    if (entries.length === 0) return 'No requestBodies found'
    if (split) {
      const outDir = path.join(path.dirname(output), path.basename(output, '.ts'))
      yield* Effect.all(
        [
          ...entries.map(([name, value]) => {
            const code = requestBodiesCode({ [name]: value }, readonly, exportTypes)
            const filePath = path.join(outDir, `${uncapitalize(name)}.ts`)
            return emit(
              makeImports(code, filePath, components, split),
              path.dirname(filePath),
              filePath,
            )
          }),
          emit(makeBarrel(section), outDir, path.join(outDir, 'index.ts')),
        ],
        { concurrency: 'unbounded' },
      )
      return `Generated requestBodies code written to ${outDir}/*.ts (index.ts included)`
    }
    const definitions = requestBodiesCode(section, readonly, exportTypes)
    yield* emit(makeImports(definitions, output, components, split), path.dirname(output), output)
    return `Generated requestBodies code written to ${output}`
  })
}
