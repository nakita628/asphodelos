import crypto from 'node:crypto'
import path from 'node:path'

import { Effect, FileSystem, Result } from 'effect'

import type { Config } from '../config/index.js'
import { parseConfig } from '../config/index.js'
import { FormatOptions } from '../format/index.js'
import { fileSystemLayer } from '../fsp/index.js'
import { parseOpenAPI } from '../openapi/index.js'
import { cleanSplitOutputs, isUserCodeJob, jobTargets, makeJob } from '../shared/index.js'

type ViteDevServer = {
  watcher: {
    add: (paths: string | readonly string[]) => void
    on: (event: 'all', callback: (eventType: string, filePath: string) => void) => void
  }
  ws: { send: (payload: { type: string; [key: string]: unknown }) => void }
  pluginContainer: { resolveId: (moduleId: string) => Promise<{ id: string } | null> }
  moduleGraph: {
    invalidateModule: (module: { id?: string } | null) => void
    invalidateAll: () => void
    getModuleById: (moduleId: string) => { id?: string } | null
  }
  ssrLoadModule: (moduleId: string) => Promise<unknown>
}

type Job = ReturnType<typeof makeJob>[number]

/** The config file the plugin reads, from the directory Vite was started in. */
const CONFIG_FILE = 'asphodelos.config.ts'

/** Extensions a change has to carry to be worth regenerating for — the set `--watch` reacts to. */
const INPUT_EXTENSIONS = ['.yaml', '.json', '.tsp'] as const

/**
 * How long a burst of filesystem events is let settle before a pass runs.
 *
 * An editor emits several events per save, and a batch change (a `git checkout`) emits one per
 * file; a pass per event would race itself.
 */
const DEBOUNCE_MS = 200

/** A `(value) => void` that runs `callback` once the calls stop, with the last value passed. */
function debounce<T>(delayMilliseconds: number, callback: (value: T) => void) {
  const pending: { timer?: ReturnType<typeof setTimeout> } = {}
  return (value: T): void => {
    clearTimeout(pending.timer)
    pending.timer = setTimeout(() => {
      callback(value)
    }, delayMilliseconds)
  }
}

/** Runs a filesystem Effect at the plugin's boundary, where Vite hands over and waits on Promises. */
function runWithFileSystem<A, E>(effect: Effect.Effect<A, E, FileSystem.FileSystem>) {
  return Effect.runPromise(effect.pipe(Effect.provide(fileSystemLayer)))
}

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Loads and validates the config through Vite's own module loader.
 *
 * `ssrLoadModule` rather than the CLI's `readConfig`: Vite already transpiles TypeScript and
 * resolves the config's imports the way the rest of the project sees them, and invalidating the
 * module is how an edit is picked up. Every failure comes back as the sentence to print.
 */
function loadConfig(server: ViteDevServer, configPath: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    // Checked before loading so a missing file reads as "no config here" rather than as whatever
    // the module loader throws.
    const found = yield* fs.exists(configPath).pipe(Effect.orElseSucceed(() => false))
    if (!found) return yield* Effect.fail(`Config not found: ${configPath}`)
    const loaded = yield* Effect.tryPromise({
      try: async () => {
        const resolved = await server.pluginContainer.resolveId(configPath)
        if (resolved) {
          const moduleNode = server.moduleGraph.getModuleById(resolved.id)
          if (moduleNode) server.moduleGraph.invalidateModule(moduleNode)
        } else {
          server.moduleGraph.invalidateAll()
        }
        return server.ssrLoadModule(`${configPath}?t=${String(Date.now())}`)
      },
      catch: messageOf,
    })
    const defaultExport: unknown =
      typeof loaded === 'object' && loaded !== null ? Reflect.get(loaded, 'default') : undefined
    if (typeof defaultExport !== 'object' || defaultExport === null) {
      return yield* Effect.fail('Config must export default object')
    }
    return yield* parseConfig(defaultExport).pipe(Effect.mapError((error) => error.message))
  })
}

/**
 * `stat`, or `null` when the path cannot be read.
 *
 * Every filesystem question the plugin asks on its own account is advisory — whether to skip a
 * pass, whether to reload, what to clean up — never whether the output is valid. So a path it
 * cannot see reads as absent, and the dev server keeps running.
 */
function statOrNull(target: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    return yield* fs.stat(target).pipe(Effect.orElseSucceed(() => null))
  })
}

/** Directory entries with each one's kind; `readDirectory` answers with names only. */
function readEntries(directory: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const names = yield* fs
      .readDirectory(directory)
      .pipe(Effect.orElseSucceed((): readonly string[] => []))
    const paths = names.map((name) => path.join(directory, name))
    const infos = yield* Effect.all(paths.map(statOrNull), { concurrency: 'unbounded' })
    return names.map((name, index) => ({
      name,
      path: paths[index] ?? path.join(directory, name),
      type: infos[index]?.type,
    }))
  })
}

/** Neither installed packages nor dot-directories (`.git`, caches) hold the project's documents. */
function isSkippedDirectory(name: string) {
  return name === 'node_modules' || name.startsWith('.')
}

function isInputFile(filePath: string) {
  return INPUT_EXTENSIONS.some((extension) => filePath.endsWith(extension))
}

/**
 * Whether a change under `directory` is one to the documents the config reads.
 *
 * `path.relative` rather than `startsWith`: `/api` is a string prefix of `/api-old/spec.yaml`
 * without being its directory.
 */
function isWatchedInput(directory: string, filePath: string) {
  const relative = path.relative(directory, filePath)
  return (
    relative !== '' &&
    !relative.startsWith('..') &&
    !path.isAbsolute(relative) &&
    isInputFile(relative) &&
    !relative.split(path.sep).slice(0, -1).some(isSkippedDirectory)
  )
}

/** Every file under `target` (itself, when it is one), skipping what {@link isSkippedDirectory} does. */
function listFiles(target: string): Effect.Effect<readonly string[], never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const info = yield* statOrNull(target)
    if (info?.type === 'File') return [target]
    if (info?.type !== 'Directory') return []
    const entries = yield* readEntries(target)
    const nested = yield* Effect.all(
      entries
        .filter((entry) => entry.type === 'File' || !isSkippedDirectory(entry.name))
        .map((entry) => listFiles(entry.path)),
      { concurrency: 'unbounded' },
    )
    return nested.flat()
  })
}

/**
 * A digest of every document under the input directory, or `null` when the set cannot be read
 * reliably — which callers treat as "changed" and regenerate.
 *
 * The whole directory rather than the file `input` names: a TypeSpec entry imports its siblings
 * and a `$ref` can point at one, so the named file is rarely the only one that matters.
 */
function hashInputs(directory: string) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const files = (yield* listFiles(directory)).filter(isInputFile).toSorted()
    if (files.length === 0) return null
    const contents = yield* Effect.all(
      files.map((file) => fs.readFileString(file).pipe(Effect.orElseSucceed(() => null))),
      { concurrency: 'unbounded' },
    )
    if (contents.includes(null)) return null
    const hash = crypto.createHash('sha256')
    for (const [index, file] of files.entries()) {
      hash.update(file)
      hash.update('\0')
      hash.update(contents[index] ?? '')
      hash.update('\0')
    }
    return hash.digest('hex')
  })
}

/**
 * The content digest of every file under `targets`, keyed by path.
 *
 * Content rather than mtime: the split clean deletes files the same pass writes back byte for
 * byte, and a rewrite with nothing new in it is no reason to reload the browser. It also does not
 * depend on how finely the filesystem records time.
 */
function snapshotOutputs(targets: readonly string[]) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const listed = yield* Effect.all(targets.map(listFiles), { concurrency: 'unbounded' })
    const files = [...new Set(listed.flat())]
    const digests = yield* Effect.all(
      files.map((file) =>
        fs.readFileString(file).pipe(
          Effect.map((content) => crypto.createHash('sha256').update(content).digest('hex')),
          Effect.orElseSucceed(() => null),
        ),
      ),
      { concurrency: 'unbounded' },
    )
    return new Map(files.map((file, index) => [file, digests[index] ?? null]))
  })
}

function isSameSnapshot(
  before: ReadonlyMap<string, string | null>,
  after: ReadonlyMap<string, string | null>,
) {
  return (
    before.size === after.size &&
    [...before].every(([file, digest]) => after.has(file) && after.get(file) === digest)
  )
}

/** Whether every output the last successful pass wrote is still on disk. */
function hasAllOutputs(jobs: readonly Job[]) {
  return Effect.gen(function* () {
    const infos = yield* Effect.all(
      jobs.map((job) => statOrNull(path.resolve(process.cwd(), job.output))),
      { concurrency: 'unbounded' },
    )
    return infos.every((info) => info !== null)
  })
}

/** The `.ts` files one stale output leaves to remove: itself, or a split directory's children. */
function removeStaleOutput(output: string, keep: ReadonlySet<string>) {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const info = yield* statOrNull(output)
    const files =
      info?.type === 'Directory'
        ? (yield* readEntries(output))
            .filter((entry) => entry.type === 'File' && entry.name.endsWith('.ts'))
            .map((entry) => entry.path)
        : info?.type === 'File' && output.endsWith('.ts')
          ? [output]
          : []
    // A file directly inside a directory the current pass writes — a split output, `modules/` —
    // is one that pass may just have written, e.g. the barrel of a single-file output turned split.
    const removable = files.filter((file) => !keep.has(file) && !keep.has(path.dirname(file)))
    const removed = yield* Effect.all(
      removable.map((file) =>
        fs.remove(file, { force: true }).pipe(
          Effect.as([file]),
          Effect.orElseSucceed((): readonly string[] => []),
        ),
      ),
      { concurrency: 'unbounded' },
    )
    return removed.flat()
  })
}

/**
 * Removes what the previous pass generated and this one no longer does, answering with what went.
 *
 * A config edit that repoints or drops an output, or a document that no longer has a section,
 * would otherwise leave the old file behind, still importing names that are gone. Deliberately
 * narrower than a recursive delete, because a path the config used to name may be shared with the
 * user:
 *
 * - outputs that merge into the user's code (`elysia`, `test`) are never removed;
 * - a stale file is removed only when it is a `.ts` file;
 * - a stale split directory loses only its direct `.ts` children, never a subdirectory, and the
 *   directory itself stays;
 * - nothing the current pass writes is touched, nor anything directly inside a directory it
 *   writes into.
 */
function removeStaleOutputs(previous: readonly Job[], current: readonly Job[]) {
  return Effect.gen(function* () {
    const keep = new Set(current.flatMap(jobTargets))
    const stale = new Set(
      previous
        .filter((job) => !isUserCodeJob(job))
        .map((job) => path.resolve(process.cwd(), job.output))
        .filter((output) => !keep.has(output)),
    )
    const removed = yield* Effect.all(
      [...stale].map((output) => removeStaleOutput(output, keep)),
      { concurrency: 'unbounded' },
    )
    return removed.flat()
  })
}

/**
 * One generation pass: parse the document, clean the split outputs, run every job and say whether
 * anything the browser loads changed.
 *
 * `Effect.result` per job is what keeps a failure from cancelling its siblings — a dev server
 * keeps running either way — so the logs that come back are one line per job. `jobs` is absent
 * when the document did not parse, and then nothing was written.
 */
function generate(config: Config) {
  return Effect.gen(function* () {
    const parsed = yield* Effect.result(parseOpenAPI(config.input))
    if (Result.isFailure(parsed)) {
      return {
        logs: [`❌ parseOpenAPI: ${parsed.failure.message}`],
        changed: false,
        jobs: undefined,
      }
    }
    const jobs = makeJob(parsed.success, config)
    const targets = jobs.flatMap(jobTargets)
    const before = yield* snapshotOutputs(targets)
    // The same clean the CLI runs, so one config cannot leave two different directories behind
    // depending on which entry point produced it.
    const cleaned = yield* Effect.result(cleanSplitOutputs(jobs))
    const cleanLogs = Result.isFailure(cleaned) ? [`❌ clean: ${cleaned.failure.message}`] : []
    const jobLogs = yield* Effect.all(
      jobs.map((job) =>
        Effect.result(job.run(job.output)).pipe(
          Effect.map((result) =>
            Result.isSuccess(result)
              ? `✅ ${job.name}${job.split ? ' (split)' : ''} -> ${job.output}`
              : `❌ ${job.name}: ${result.failure.message}`,
          ),
        ),
      ),
      { concurrency: 'unbounded' },
    ).pipe(Effect.provideService(FormatOptions, config.format ?? {}))
    const after = yield* snapshotOutputs(targets)
    return {
      logs: [...cleanLogs, ...jobLogs],
      changed: !isSameSnapshot(before, after),
      jobs,
    }
  })
}

/**
 * The Vite plugin: regenerates on every change to `asphodelos.config.ts` or to the documents it
 * names, and reloads the browser when the output actually changed.
 *
 * Every pass — the first one, a config edit, a document edit — goes through one queue, so no two
 * passes ever interleave their cleanup with each other's writes.
 */
export function asphodelosVite(): any {
  const configPath = path.resolve(process.cwd(), CONFIG_FILE)
  const state: {
    /** The config the last successful load produced; `null` until one has. */
    config: Config | null
    /** The directory the config's documents live in, which is what the watcher filters on. */
    inputDirectory: string | null
    /** The document digest the last pass generated from. */
    inputHash: string | null
    /** The jobs the last pass that got as far as writing ran. */
    jobs: readonly Job[] | null
    queue: Promise<void>
  } = {
    config: null,
    inputDirectory: null,
    inputHash: null,
    jobs: null,
    queue: Promise.resolve(),
  }

  const enqueue = (task: () => Promise<void>) => {
    const previous = state.queue
    const queued = (async () => {
      await previous
      try {
        await task()
      } catch (error) {
        console.error('❌ asphodelos:', error)
      }
    })()
    state.queue = queued
    return queued
  }

  const runPass = async (server: ViteDevServer) => {
    const { config } = state
    if (!config) return
    console.log('🌸 asphodelos')
    const { logs, changed, jobs } = await runWithFileSystem(generate(config))
    for (const line of logs) console.log(line)
    if (!jobs) return
    const removed =
      state.jobs === null ? [] : await runWithFileSystem(removeStaleOutputs(state.jobs, jobs))
    for (const removedPath of removed) console.log(`🧹 removed ${removedPath}`)
    state.jobs = jobs
    if (changed || removed.length > 0) server.ws.send({ type: 'full-reload' })
  }

  /**
   * (Re)reads the config and regenerates from it, whatever the documents look like — the config
   * decides what is generated, so an edit to it is never skipped.
   *
   * A config that does not load leaves the previous one in effect, and the next save retries.
   */
  const applyConfig = async (server: ViteDevServer) => {
    const loaded = await runWithFileSystem(Effect.result(loadConfig(server, configPath)))
    if (Result.isFailure(loaded)) {
      console.error(`❌ config: ${loaded.failure}`)
      return
    }
    state.config = loaded.success
    const inputPath = path.resolve(process.cwd(), loaded.success.input)
    const inputDirectory = path.dirname(inputPath)
    server.watcher.add([
      inputPath,
      ...INPUT_EXTENSIONS.map((extension) => path.join(inputDirectory, `**/*${extension}`)),
    ])
    state.inputDirectory = inputDirectory
    state.inputHash = await runWithFileSystem(hashInputs(inputDirectory))
    await runPass(server)
  }

  /**
   * Regenerates after a document change, unless the documents read exactly as they did at the
   * last pass. Skipping also requires every output to still exist, so deleting a generated file
   * and touching the input brings it back.
   */
  const applyInputChange = async (server: ViteDevServer) => {
    const { inputDirectory, jobs } = state
    if (inputDirectory === null) return
    const [inputHash, outputsExist] = await runWithFileSystem(
      Effect.all([hashInputs(inputDirectory), hasAllOutputs(jobs ?? [])]),
    )
    if (inputHash !== null && inputHash === state.inputHash && jobs !== null && outputsExist) {
      console.log('⏭️ asphodelos: input unchanged - skipped regeneration')
      return
    }
    state.inputHash = inputHash
    await runPass(server)
  }

  // Vite calls `handleHotUpdate` for the config module and the raw watcher reports the file too,
  // so one save arrives twice; the debounce is also what folds those into a single pass.
  const queueConfigChange = debounce(DEBOUNCE_MS, (server: ViteDevServer) => {
    void enqueue(() => applyConfig(server))
  })
  const queueInputChange = debounce(DEBOUNCE_MS, (server: ViteDevServer) => {
    void enqueue(() => applyInputChange(server))
  })

  return {
    name: 'asphodelos',
    // Generation follows edits; `vite build` has nothing to watch.
    apply: 'serve',
    configureServer(server: ViteDevServer) {
      // Watched before the first read, so a config that does not load yet is picked up by the
      // save that fixes it rather than by a restart.
      server.watcher.add(configPath)
      server.watcher.on('all', (_eventType, filePath) => {
        const changedPath = path.resolve(filePath)
        if (changedPath === configPath) {
          queueConfigChange(server)
          return
        }
        if (state.inputDirectory !== null && isWatchedInput(state.inputDirectory, changedPath)) {
          queueInputChange(server)
        }
      })
      void enqueue(() => applyConfig(server))
    },
    handleHotUpdate(context: { file: string; server: ViteDevServer }) {
      if (path.resolve(context.file) !== configPath) return undefined
      queueConfigChange(context.server)
      // An empty module list tells Vite the update is handled and there is nothing to hot-swap.
      return []
    },
  }
}
