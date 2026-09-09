import path from 'node:path'

import { Effect } from 'effect'

import type { Config } from '../config/index.js'
import { parseConfig } from '../config/index.js'
import { FormatOptions } from '../format/index.js'
import { fileSystemLayer } from '../fsp/index.js'
import { parseOpenAPI } from '../openapi/index.js'
import { makeJob } from '../shared/index.js'

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

function debounce(delayMilliseconds: number, callback: () => void): () => void {
  const timerStorage = new WeakMap<() => void, ReturnType<typeof setTimeout>>()
  const wrappedFunction = (): void => {
    const previousTimer = timerStorage.get(wrappedFunction)
    if (previousTimer !== undefined) clearTimeout(previousTimer)
    timerStorage.set(wrappedFunction, setTimeout(callback, delayMilliseconds))
  }
  return wrappedFunction
}

async function readConfigurationWithHotReload(server: ViteDevServer) {
  const absoluteConfigPath = path.resolve(process.cwd(), 'asphodelos.config.ts')
  try {
    const resolved = await server.pluginContainer.resolveId(absoluteConfigPath)
    const moduleId = resolved?.id
    if (moduleId) {
      const moduleNode = server.moduleGraph.getModuleById(moduleId)
      if (moduleNode) server.moduleGraph.invalidateModule(moduleNode)
    } else {
      server.moduleGraph.invalidateAll()
    }
    const loadedModule = await server.ssrLoadModule(`${absoluteConfigPath}?t=${String(Date.now())}`)
    const defaultExport: unknown =
      typeof loadedModule === 'object' && loadedModule !== null
        ? Reflect.get(loadedModule, 'default')
        : undefined
    if (!(typeof defaultExport === 'object' && defaultExport !== null)) {
      return { ok: false, error: 'Config must export default object' } as const
    }
    // The plugin's boundary: Vite's hooks are Promises and callbacks, so the Effect is run
    // here and plain values are handed back.
    const parsed = await Effect.runPromise(Effect.result(parseConfig(defaultExport)))
    return parsed._tag === 'Success'
      ? ({ ok: true, value: parsed.success } as const)
      : ({ ok: false, error: parsed.failure.message } as const)
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) } as const
  }
}

/**
 * Runs every job the config asks for and reports one log line each.
 *
 * `Effect.result` per job rather than one failing `Effect.all`: a broken section should be
 * reported and the rest still written, because the dev server keeps running either way.
 */
function runAllGenerationTasks(config: Config) {
  return Effect.gen(function* () {
    const openAPI = yield* parseOpenAPI(config.input).pipe(
      Effect.mapError((error) => `❌ parseOpenAPI: ${error.message}`),
    )
    return yield* Effect.all(
      makeJob(openAPI, config).map((job) =>
        Effect.result(job.run(job.output)).pipe(
          Effect.map((result) =>
            result._tag === 'Success'
              ? `✅ ${job.name} -> ${job.output}`
              : `❌ ${job.name}: ${result.failure.message}`,
          ),
        ),
      ),
      { concurrency: 'unbounded' },
    )
  }).pipe(
    Effect.provideService(FormatOptions, config.format ?? {}),
    Effect.catch((message: string) => Effect.succeed([message])),
  )
}

export function asphodelosVite(): any {
  const pluginState: { current: Config | null; inputDirectory: string | null } = {
    current: null,
    inputDirectory: null,
  }
  const absoluteConfigFilePath = path.resolve(process.cwd(), 'asphodelos.config.ts')

  const runGeneration = async () => {
    if (!pluginState.current) return
    console.log('🌸 asphodelos')
    const logs = await Effect.runPromise(
      runAllGenerationTasks(pluginState.current).pipe(Effect.provide(fileSystemLayer)),
    )
    for (const logMessage of logs) {
      console.log(logMessage)
    }
  }

  const runGenerationAndReload = async (server?: ViteDevServer) => {
    await runGeneration()
    if (server) server.ws.send({ type: 'full-reload' })
  }

  const handleConfigurationChange = async (server: ViteDevServer) => {
    const nextConfiguration = await readConfigurationWithHotReload(server)
    if (!nextConfiguration.ok) {
      console.error(`❌ config: ${nextConfiguration.error}`)
      return
    }
    pluginState.current = nextConfiguration.value
    const absoluteInputPath = path.resolve(process.cwd(), pluginState.current.input)
    const inputDirectory = path.dirname(absoluteInputPath)
    server.watcher.add([
      absoluteInputPath,
      path.join(inputDirectory, '**/*.yaml'),
      path.join(inputDirectory, '**/*.json'),
      path.join(inputDirectory, '**/*.tsp'),
    ])
    pluginState.inputDirectory = inputDirectory
    await runGenerationAndReload(server)
  }

  return {
    name: 'asphodelos',
    handleHotUpdate(context: { file: string; server: ViteDevServer }) {
      const absoluteFilePath = path.resolve(context.file)
      if (absoluteFilePath === absoluteConfigFilePath) {
        handleConfigurationChange(context.server).catch((error: unknown) => {
          console.error('❌ hot-update error:', error)
        })
        // An empty module list tells Vite the config reload already handled the update.
        return []
      }
      // `undefined` leaves Vite's default HMR handling in place.
      return undefined
    },
    configureServer(server: ViteDevServer) {
      ;(async () => {
        const initialConfiguration = await readConfigurationWithHotReload(server)
        if (!initialConfiguration.ok) {
          console.error(`❌ config: ${initialConfiguration.error}`)
          return
        }
        pluginState.current = initialConfiguration.value
        const absoluteInputPath = path.resolve(process.cwd(), pluginState.current.input)
        const inputDirectory = path.dirname(absoluteInputPath)
        server.watcher.add([
          absoluteInputPath,
          path.join(inputDirectory, '**/*.yaml'),
          path.join(inputDirectory, '**/*.json'),
          path.join(inputDirectory, '**/*.tsp'),
        ])
        pluginState.inputDirectory = inputDirectory
        server.watcher.add(absoluteConfigFilePath)

        const debouncedRunGeneration = debounce(200, () => {
          void runGenerationAndReload(server)
        })

        const handleWatcherEvent = async (filePath: string) => {
          const absoluteChangedPath = path.resolve(filePath)
          if (absoluteChangedPath === absoluteConfigFilePath) {
            await handleConfigurationChange(server)
            return
          }
          if (
            pluginState.inputDirectory &&
            absoluteChangedPath.startsWith(pluginState.inputDirectory) &&
            (absoluteChangedPath.endsWith('.yaml') ||
              absoluteChangedPath.endsWith('.json') ||
              absoluteChangedPath.endsWith('.tsp'))
          ) {
            debouncedRunGeneration()
          }
        }

        // chokidar's listener is synchronous, so the promise is deliberately not awaited here;
        // a rejection is reported rather than left floating.
        server.watcher.on('all', (_eventType, filePath) => {
          handleWatcherEvent(filePath).catch((error: unknown) => {
            console.error('❌ watch error:', error)
          })
        })
        await runGenerationAndReload(server)
      })().catch((error: unknown) => {
        console.error('❌ watch error:', error)
      })
    },
  }
}
