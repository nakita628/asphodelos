import * as NodeFileSystem from '@effect/platform-node/NodeFileSystem'
import { Effect, FileSystem } from 'effect'
import type { PlatformError } from 'effect'

/**
 * Node's `FileSystem` implementation.
 *
 * Every function below reads the service out of the environment, so a program that uses them
 * provides this once at its boundary — the CLI folds it in through `NodeServices.layer`, the Vite
 * plugin provides it directly.
 */
export const fileSystemLayer = NodeFileSystem.layer

/** Whether a platform failure is "the path is not there", the one case worth absorbing. */
function isNotFound(e: PlatformError.PlatformError) {
  return e.reason._tag === 'NotFound'
}

/** Removes a file. A path that is already gone is not an error. */
export function unlink(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.remove(path, { force: true })
  })
}

/** Creates `dir` and every missing parent. */
export function mkdir(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    yield* fs.makeDirectory(dir, { recursive: true })
  })
}

/** Lists `dir`. A directory that does not exist reads as empty. */
export function readdir(dir: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readDirectory(dir)
  }).pipe(Effect.catchIf(isNotFound, () => Effect.succeed<readonly string[]>([])))
}

/** Reads `path` as UTF-8, answering `null` when there is nothing there yet. */
export function readFile(path: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.readFileString(path)
  }).pipe(Effect.catchIf(isNotFound, () => Effect.succeed<string | null>(null)))
}

/**
 * Writes `data` to `path`, skipping the write when the bytes already match.
 *
 * That skip is contract, not optimization: the Vite plugin watches its own output, so rewriting
 * an unchanged file would feed a change event straight back into the generator.
 */
export function writeFile(path: string, data: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const existing = yield* fs.readFileString(path).pipe(Effect.orElseSucceed(() => null))
    if (existing === data) return
    yield* fs.writeFileString(path, data)
  })
}
