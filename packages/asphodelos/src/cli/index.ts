import { resolve } from 'node:path'

import { Effect, FileSystem } from 'effect'

import { readConfig } from '../config/index.js'
import { elysia } from '../core/index.js'
import { GenerateError } from '../error/index.js'
import { FormatOptions } from '../format/index.js'
import { parseOpenAPI } from '../openapi/index.js'
import { makeJob } from '../shared/index.js'

const HELP_TEXT = `Usage: asphodelos <input.{yaml,json,tsp}> [-o <output.ts>]

Options:
  -h, --help                  display help

Configuration:
  asphodelos.config.ts        { input, output?, prefix?, port?, format?, integration?, readonly?, components? }`

function isYamlOrJsonOrTsp(i: string): i is `${string}.yaml` | `${string}.json` | `${string}.tsp` {
  return i.endsWith('.yaml') || i.endsWith('.json') || i.endsWith('.tsp')
}

function isTs(o: string): o is `${string}.ts` {
  return o.endsWith('.ts')
}

/** Reads `<input> -o <output>` out of argv, or answers with the help text to print instead. */
export function parseCli(args: readonly string[]) {
  return Effect.gen(function* () {
    const input = args[0]
    const oIdx = args.indexOf('-o')
    const output = oIdx === -1 ? undefined : args[oIdx + 1]
    if (!(input && output && isYamlOrJsonOrTsp(input) && isTs(output))) {
      return yield* new GenerateError({ message: HELP_TEXT })
    }
    return { input, output }
  })
}

/**
 * The whole command: a config file when there is one, otherwise the two arguments.
 *
 * Returns the log the CLI prints; every failure travels in the error channel with a message the
 * bin renders as-is.
 */
export function asphodelos(argv: readonly string[]) {
  return Effect.gen(function* () {
    if (argv.length === 1 && (argv[0] === '--help' || argv[0] === '-h')) return HELP_TEXT

    const fs = yield* FileSystem.FileSystem
    const abs = resolve(process.cwd(), 'asphodelos.config.ts')
    const hasConfig = yield* fs
      .exists(abs)
      .pipe(Effect.catchTag('PlatformError', () => Effect.succeed(false)))

    if (!hasConfig) {
      const { input, output } = yield* parseCli(argv)
      const openAPI = yield* parseOpenAPI(input)
      return yield* elysia(openAPI, { output })
    }

    const config = yield* readConfig()
    const openAPI = yield* parseOpenAPI(config.input)
    const logs = yield* Effect.all(
      makeJob(openAPI, config).map((job) => job.run(job.output)),
      { concurrency: 'unbounded' },
    ).pipe(Effect.provideService(FormatOptions, config.format ?? {}))
    return logs.filter((line) => line !== '').join('\n')
  })
}
