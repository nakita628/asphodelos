import path from 'node:path'

import { Effect } from 'effect'

import { emit } from '../../emit/index.js'
import { GenerateError } from '../../error/index.js'
import { readFile } from '../../fsp/index.js'
import { makeColocatedTestEntries, makeTestFile } from '../../generator/test/index.js'
import { mergeSource } from '../../merge/index.js'
import type { OpenAPI } from '../../openapi/index.js'

/** Writes `code`, keeping whatever the user already wrote in `output`. */
function writeMerged(code: string, output: string) {
  return Effect.gen(function* () {
    const existing = yield* readFile(output)
    const merged = existing === null ? code : mergeSource(existing, code)
    yield* emit(merged, path.dirname(output), output)
  })
}

export function test(
  openAPI: OpenAPI,
  output: string | undefined,
  options: {
    readonly appOutput?: string
    readonly split?: boolean
    readonly pathAlias?: string
    readonly prefix?: string
  } = {},
) {
  return Effect.gen(function* () {
    const { appOutput = 'src/index.ts', split = false, pathAlias, prefix } = options
    const appOutputAbs = path.resolve(process.cwd(), appOutput)
    const appBase = path.basename(appOutput).replace(/\.ts$/, '')
    // Specifier the generated test uses to import the assembled `app`. pathAlias
    // rewrites it to '<alias>/<entry>'; otherwise it is the relative path from the
    // test file's directory to the app entry (e.g. './index', '../..', '../../index').
    const appImportFor = (fromFileAbs: string) => {
      if (pathAlias) return `${pathAlias.replace(/\/$/, '')}/${appBase}`
      const rel = path
        .relative(path.dirname(fromFileAbs), appOutputAbs)
        .replaceAll('\\', '/')
        .replace(/\.ts$/, '')
      return rel.startsWith('.') ? rel : `./${rel}`
    }

    // Split: one test co-located in each module dir (modules/<resource>/index.test.ts),
    // each importing the shared app and asserting only its own resource's routes.
    if (split) {
      const modulesDir = path.join(path.dirname(appOutputAbs), 'modules')
      const appImport = appImportFor(path.join(modulesDir, 'resource', 'index.test.ts'))
      const entries = makeColocatedTestEntries(openAPI, appImport, prefix)
      yield* Effect.all(
        entries.map((entry) =>
          writeMerged(entry.code, path.join(modulesDir, entry.name, 'index.test.ts')),
        ),
        { concurrency: 'unbounded' },
      )
      return `Generated ${entries.length} co-located test file(s) under ${path.posix.dirname(appOutput)}/modules/`
    }

    // Single file: one test importing the whole app.
    if (output === undefined) {
      return yield* new GenerateError({ message: 'test.output is required when split is false' })
    }
    const appImport = appImportFor(path.resolve(process.cwd(), output))
    const testCode = makeTestFile(openAPI, appImport, prefix)
    yield* writeMerged(testCode, output)
    return `Generated test file written to ${output}`
  })
}
