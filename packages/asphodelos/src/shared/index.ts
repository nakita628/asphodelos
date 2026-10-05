import path, { posix } from 'node:path'

import SwaggerParser from '@apidevtools/swagger-parser'
import { Effect, FileSystem } from 'effect'

import { COMPONENT_KINDS, HOOK_KINDS } from '../config/index.js'
import type { Config } from '../config/index.js'
import {
  callbacks,
  client,
  components,
  eden,
  elysia,
  examples,
  headers,
  hooks,
  links,
  mediaTypes,
  mock,
  parameters,
  pathItems,
  requestBodies,
  responses,
  schemas,
  securitySchemes,
  types,
} from '../core/index.js'
import { GenerateError } from '../error/index.js'
import { readdir, unlink } from '../fsp/index.js'
import type { OpenAPI } from '../openapi/index.js'

/**
 * The specifier `from` imports the generated file `target` by.
 *
 * Through the alias when the config names one and `target` sits under the app entry's directory —
 * `@/` stands for that directory, so `src/client.ts` is `@/client` from anywhere — and relative to
 * `from` otherwise. The extension goes. A barrel is imported by its directory; any other file
 * keeps its `index`, so an entry is named rather than left to directory resolution.
 */
function importSpecifier(
  from: string,
  target: string,
  alias: { readonly prefix: string; readonly directory: string } | undefined,
  kind: 'file' | 'barrel' = 'file',
) {
  const module = posix
    .normalize(target)
    .replace(kind === 'barrel' ? /(?:\/index)?\.ts$/u : /\.ts$/u, '')
  if (alias !== undefined) {
    const inside = posix.relative(alias.directory, module)
    if (inside !== '' && !inside.startsWith('..')) return `${alias.prefix}/${inside}`
  }
  const relative = posix.relative(posix.dirname(posix.normalize(from)), module)
  return relative.startsWith('.') ? relative : `./${relative}`
}

/**
 * The directory of the nearest `package.json` at or above `dir`, or `undefined` when there is
 * none: the package a file belongs to, read from where it sits and nothing else.
 */
function packageRoot(dir: string): Effect.Effect<string | undefined, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const found = yield* fs
      .exists(path.join(dir, 'package.json'))
      .pipe(Effect.orElseSucceed(() => false))
    if (found) return dir
    const parent = path.dirname(dir)
    return parent === dir ? undefined : yield* packageRoot(parent)
  })
}

/**
 * The specifier `from` imports the generated file `target` by, package boundaries respected.
 *
 * Inside one package it is `local` — relative, or through the alias. Across packages it is the
 * name the target's package is imported by, `named`; a crossing with no name is refused with
 * `missing`, rather than written as a relative path into another package.
 */
function packageImport(
  from: string,
  target: string,
  local: string,
  named: string | undefined,
  missing: string,
) {
  return Effect.gen(function* () {
    const [fromRoot, targetRoot] = yield* Effect.all([
      packageRoot(path.dirname(path.resolve(process.cwd(), from))),
      packageRoot(path.dirname(path.resolve(process.cwd(), target))),
    ])
    if (fromRoot === targetRoot) return local
    if (named !== undefined) return named
    return yield* new GenerateError({ message: missing })
  })
}

/** An import specifier, worked out against the filesystem. */
type Import = Effect.Effect<string, GenerateError, FileSystem.FileSystem>

/** Where a component kind is written, and how it is imported when not relatively. */
type Target = {
  readonly output: string
  readonly split?: boolean
  readonly import?: string
  readonly package?: string
}

type Targets = { readonly [kind in (typeof COMPONENT_KINDS)[number]]?: Target }

/**
 * What a generated file at `from` sees of the other outputs: each component kind with its import
 * settled where it is not relative, and the single-file components likewise.
 */
type View = { readonly targets: Targets; readonly componentsImport?: string }

/** Runs `make` on what `input` works out against the filesystem. */
function resolved<T, A, E>(
  input: Effect.Effect<T, GenerateError, FileSystem.FileSystem>,
  make: (value: T) => Effect.Effect<A, E, FileSystem.FileSystem>,
) {
  return Effect.gen(function* () {
    const value = yield* input
    return yield* make(value)
  })
}

/** The `client` job's run: the client, importing the app entry from where `appImport` answers. */
function clientRun(
  output: string,
  appImport: Import,
  options: Omit<Parameters<typeof client>[1], 'appImport'>,
) {
  return Effect.gen(function* () {
    const specifier = yield* appImport
    return yield* client(output, { ...options, appImport: specifier })
  })
}

/** The `eden` job's run: the wrappers, importing the client from where `importPath` answers. */
function edenRun(
  openAPI: OpenAPI,
  output: string,
  importPath: Import,
  edenConfig: NonNullable<Config['eden']>,
  prefix: string | undefined,
) {
  return Effect.gen(function* () {
    const specifier = yield* importPath
    return yield* eden(openAPI, output, specifier, edenConfig.client ?? 'client', prefix)
  })
}

/**
 * A hooks job's run: one library's hooks, importing the client from where `importPath` answers
 * and the schemas from where `view` says.
 */
function hooksRun(
  openAPI: OpenAPI,
  output: string,
  importPath: Import,
  library: (typeof HOOK_KINDS)[number],
  view: Effect.Effect<View, never, FileSystem.FileSystem>,
  componentsOutput: string | undefined,
  options: Omit<Parameters<typeof hooks>[4], 'schemas'>,
) {
  return Effect.gen(function* () {
    const [specifier, seen] = yield* Effect.all([importPath, view])
    // Where the schemas end up: the single components file, or the schemas target — the same
    // answer the app generator gives, from where the hooks are written.
    const schemasTarget =
      componentsOutput === undefined
        ? seen.targets.schemas
        : { output: componentsOutput, import: seen.componentsImport }
    return yield* hooks(openAPI, output, specifier, library, { ...options, schemas: schemasTarget })
  })
}

type Alias = { readonly prefix: string; readonly directory: string } | undefined

/**
 * How the file at `from` imports the component kind `target`: as the config says; by the package
 * name across a package boundary; through the alias under the app entry's directory; and
 * relatively otherwise — which the generators work out themselves, so it is left unsaid here. A
 * kind in another package that names no package is imported relatively as well: which kinds a
 * file imports depends on the document, so a name cannot be demanded ahead of it.
 */
function settleTarget(from: string, target: Target, pathAlias: Alias) {
  return Effect.gen(function* () {
    if (target.import !== undefined) return target
    const [fromRoot, targetRoot] = yield* Effect.all([
      packageRoot(path.dirname(path.resolve(process.cwd(), from))),
      packageRoot(path.dirname(path.resolve(process.cwd(), target.output))),
    ])
    if (fromRoot !== targetRoot) {
      return target.package === undefined ? target : { ...target, import: target.package }
    }
    if (pathAlias === undefined) return target
    const specifier = importSpecifier(from, target.output, pathAlias, 'barrel')
    return specifier.startsWith('.') ? target : { ...target, import: specifier }
  })
}

/** What the file at `from` sees of every component kind, and of the single components file. */
function viewFrom(
  from: string,
  options: {
    readonly targetOf: (kind: (typeof COMPONENT_KINDS)[number]) => Target
    readonly single: Target | undefined
    readonly pathAlias: Alias
  },
): Effect.Effect<View, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const settled = yield* Effect.all(
      COMPONENT_KINDS.map((kind) =>
        settleTarget(from, options.targetOf(kind), options.pathAlias).pipe(
          Effect.map((target) => [kind, target] as const),
        ),
      ),
      { concurrency: 'unbounded' },
    )
    const single =
      options.single === undefined
        ? undefined
        : yield* settleTarget(from, options.single, options.pathAlias)
    return { targets: Object.fromEntries(settled), componentsImport: single?.import }
  })
}

export function makeJob(openAPI: OpenAPI, config: Config) {
  const { client: clientConfig, eden: edenConfig } = config
  const appOutput = config.output ?? 'src/index.ts'
  const baseDir = posix.normalize(posix.dirname(appOutput))
  // The alias names the app entry's directory; a trailing slash is the way it is usually
  // written (`@/`) and not part of the prefix a specifier is built from.
  const pathAlias =
    config.pathAlias === undefined
      ? undefined
      : { prefix: config.pathAlias.replace(/\/+$/u, ''), directory: baseDir }
  // The address the app entry listens on: what the client is created with when the config names
  // no base URL, and what an environment variable left unset falls back to.
  const localhost = `http://localhost:${config.port ?? '3000'}`
  // A client that is not an `index.ts` is re-exported by the `index.ts` beside it, and imported
  // through it — unless that file is what another generator writes.
  const clientBarrel = (() => {
    if (clientConfig === undefined || posix.basename(clientConfig.output) === 'index.ts') {
      return undefined
    }
    const barrel = posix.join(posix.dirname(clientConfig.output), 'index.ts')
    const written = [
      appOutput,
      config.components?.output,
      ...COMPONENT_KINDS.map((kind) => config.components?.[kind]?.output),
      edenConfig?.output,
      config.types?.output,
      config.mock?.output,
      ...HOOK_KINDS.map((kind) => config[kind]?.output),
    ]
    return written.some((file) => file !== undefined && posix.normalize(file) === barrel)
      ? undefined
      : barrel
  })()
  // The module a generated file imports the client from: the one it names, or the file the
  // top-level `client` generates, reached from where the generated file is written. A file beside
  // the client imports the client itself: the barrel is for the others, and may come to re-export
  // the file that would import it. A file in another package imports the client by the name of
  // its package. `parseConfig` requires an import or a client, so a file with neither is a wiring
  // error, not a config error.
  const clientImport = (field: string, output: string, named: string | undefined): Import => {
    if (named !== undefined) return Effect.succeed(named)
    if (clientConfig === undefined) {
      return Effect.fail(
        new GenerateError({
          message: `${field}.import is required unless a top-level client is generated`,
        }),
      )
    }
    const isBeside = posix.dirname(posix.normalize(output)) === posix.dirname(clientConfig.output)
    return packageImport(
      output,
      clientConfig.output,
      isBeside || clientBarrel === undefined
        ? importSpecifier(output, clientConfig.output, pathAlias)
        : importSpecifier(output, clientBarrel, pathAlias, 'barrel'),
      clientConfig.package,
      `${field}.output is in another package than the client: name the package the client is published as, client.package, for the file to import it by.`,
    )
  }
  // `output` (single-file mode) and the per-type targets are mutually exclusive
  // (enforced in parseConfig); split them so the per-type map keeps the shape the
  // component generators expect.
  const {
    output: componentsOutput,
    package: componentsPackage,
    ...componentTargets
  } = config.components ?? {}
  // Every kind has a place, the one the config names or `components/<kind>.ts` beside the app
  // entry, so an import of a kind the config says nothing about is worked out the same way.
  const targetOf = (kind: (typeof COMPONENT_KINDS)[number]): Target =>
    componentTargets[kind] ?? { output: `${baseDir}/components/${kind}.ts` }
  const view = (from: string) =>
    viewFrom(from, {
      targetOf,
      single:
        componentsOutput === undefined
          ? undefined
          : { output: componentsOutput, package: componentsPackage },
      pathAlias,
    })
  const componentJobs = componentsOutput
    ? [
        {
          name: 'components',
          output: componentsOutput,
          split: false,
          run: (output: string) => components(openAPI.components, output, config.readonly),
        },
      ]
    : perTypeComponentJobs(openAPI, componentTargets, baseDir, config.readonly, view)
  return [
    {
      name: 'elysia',
      output: appOutput,
      split: false,
      run: (output: string) =>
        resolved(view(`${baseDir}/modules/_/index.ts`), (seen) =>
          elysia(openAPI, {
            output,
            prefix: config.prefix,
            port: config.port,
            integration: config.integration === true,
            readonly: config.readonly === true,
            pathAlias: pathAlias?.prefix,
            components: seen.targets,
            componentsOutput,
            componentsImport: seen.componentsImport,
          }),
        ),
    },
    ...componentJobs,
    clientConfig
      ? {
          name: 'client',
          output: clientConfig.output,
          split: false,
          run: (output: string) =>
            clientRun(
              output,
              clientConfig.import === undefined
                ? packageImport(
                    output,
                    appOutput,
                    importSpecifier(output, appOutput, pathAlias),
                    undefined,
                    'client.output is in another package than the app entry: name the module that exports the app, client.import, for the client to import it by.',
                  )
                : Effect.succeed(clientConfig.import),
              {
                baseUrl: clientConfig.baseUrl ?? localhost,
                fallback: localhost,
                sameOrigin: clientConfig.sameOrigin === true,
                barrel: clientBarrel,
              },
            ),
        }
      : undefined,
    edenConfig
      ? {
          name: 'eden',
          output: edenConfig.output,
          split: false,
          run: (output: string) =>
            edenRun(
              openAPI,
              output,
              clientImport('eden', output, edenConfig.import),
              edenConfig,
              config.prefix,
            ),
        }
      : undefined,
    config.types
      ? {
          name: 'types',
          output: config.types.output,
          split: false,
          run: (output: string) => types(openAPI, output, config.prefix),
        }
      : undefined,
    config.mock
      ? {
          name: 'mock',
          output: config.mock.output,
          split: false,
          // `prefix` and `port` come from the root config — they describe the server the mock
          // stands in for, not the mock itself — and the rest from the `mock` block.
          run: (output: string) =>
            mock(openAPI, output, {
              ...config.mock,
              prefix: config.prefix,
              port: config.port,
            }),
        }
      : undefined,
    ...HOOK_KINDS.map((library) => {
      const cfg = config[library]
      return cfg
        ? {
            name: library,
            output: cfg.output,
            split: false,
            run: (output: string) =>
              hooksRun(
                openAPI,
                output,
                clientImport(library, output, cfg.import),
                library,
                view(output),
                componentsOutput,
                { client: cfg.client ?? 'client', basePath: config.prefix },
              ),
          }
        : undefined
    }),
  ].filter((job) => job !== undefined)
}

function perTypeComponentJobs(
  openAPI: OpenAPI,
  componentTargets: Omit<NonNullable<Config['components']>, 'output' | 'package'>,
  baseDir: string,
  readonly: boolean | undefined,
  view: (from: string) => Effect.Effect<View, never, FileSystem.FileSystem>,
) {
  // Each section the document has is written, to the target the config names or to
  // `components/<section>.ts` beside the app entry; the kinds keep their declaration order.
  const target = (kind: (typeof COMPONENT_KINDS)[number]) => ({
    name: kind,
    output: componentTargets[kind]?.output ?? `${baseDir}/components/${kind}.ts`,
    split: componentTargets[kind]?.split ?? false,
  })
  // What a kind's files see of the other kinds, from where they are written: the barrel's
  // directory for a split kind, the file otherwise.
  const seenFrom = (kind: (typeof COMPONENT_KINDS)[number]) => {
    const { output, split } = target(kind)
    return view(split ? `${output}/index.ts` : output)
  }
  return [
    openAPI.components?.schemas
      ? {
          ...target('schemas'),
          run: (output: string) =>
            resolved(seenFrom('schemas'), ({ targets }) =>
              schemas(
                openAPI.components?.schemas,
                output,
                componentTargets.schemas?.split ?? false,
                componentTargets.schemas?.exportTypes ?? false,
                targets,
                readonly,
              ),
            ),
        }
      : undefined,
    openAPI.components?.responses
      ? {
          ...target('responses'),
          run: (output: string) =>
            resolved(seenFrom('responses'), ({ targets }) =>
              responses(
                openAPI.components?.responses,
                output,
                componentTargets.responses?.split ?? false,
                componentTargets.responses?.exportTypes ?? false,
                targets,
                readonly,
              ),
            ),
        }
      : undefined,
    openAPI.components?.parameters
      ? {
          ...target('parameters'),
          run: (output: string) =>
            resolved(seenFrom('parameters'), ({ targets }) =>
              parameters(
                openAPI.components?.parameters,
                output,
                componentTargets.parameters?.split ?? false,
                componentTargets.parameters?.exportTypes ?? false,
                targets,
                readonly,
              ),
            ),
        }
      : undefined,
    openAPI.components?.examples
      ? {
          ...target('examples'),
          run: (output: string) =>
            resolved(seenFrom('examples'), ({ targets }) =>
              examples(
                openAPI.components?.examples,
                output,
                componentTargets.examples?.split ?? false,
                targets,
              ),
            ),
        }
      : undefined,
    openAPI.components?.requestBodies
      ? {
          ...target('requestBodies'),
          run: (output: string) =>
            resolved(seenFrom('requestBodies'), ({ targets }) =>
              requestBodies(
                openAPI.components?.requestBodies,
                output,
                componentTargets.requestBodies?.split ?? false,
                componentTargets.requestBodies?.exportTypes ?? false,
                targets,
                readonly,
              ),
            ),
        }
      : undefined,
    openAPI.components?.headers
      ? {
          ...target('headers'),
          run: (output: string) =>
            resolved(seenFrom('headers'), ({ targets }) =>
              headers(
                openAPI.components?.headers,
                output,
                componentTargets.headers?.split ?? false,
                componentTargets.headers?.exportTypes ?? false,
                targets,
                readonly,
              ),
            ),
        }
      : undefined,
    openAPI.components?.securitySchemes
      ? {
          ...target('securitySchemes'),
          run: (output: string) =>
            resolved(seenFrom('securitySchemes'), ({ targets }) =>
              securitySchemes(
                openAPI.components?.securitySchemes,
                output,
                componentTargets.securitySchemes?.split ?? false,
                targets,
              ),
            ),
        }
      : undefined,
    openAPI.components?.links
      ? {
          ...target('links'),
          run: (output: string) =>
            resolved(seenFrom('links'), ({ targets }) =>
              links(
                openAPI.components?.links,
                output,
                componentTargets.links?.split ?? false,
                targets,
              ),
            ),
        }
      : undefined,
    openAPI.components?.callbacks
      ? {
          ...target('callbacks'),
          run: (output: string) =>
            resolved(seenFrom('callbacks'), ({ targets }) =>
              callbacks(
                openAPI.components?.callbacks,
                output,
                componentTargets.callbacks?.split ?? false,
                targets,
              ),
            ),
        }
      : undefined,
    openAPI.components?.pathItems
      ? {
          ...target('pathItems'),
          run: (output: string) =>
            resolved(seenFrom('pathItems'), ({ targets }) =>
              pathItems(
                openAPI.components?.pathItems,
                output,
                componentTargets.pathItems?.split ?? false,
                targets,
              ),
            ),
        }
      : undefined,
    openAPI.components?.mediaTypes
      ? {
          ...target('mediaTypes'),
          run: (output: string) =>
            resolved(seenFrom('mediaTypes'), ({ targets }) =>
              mediaTypes(
                openAPI.components?.mediaTypes,
                output,
                componentTargets.mediaTypes?.split ?? false,
                componentTargets.mediaTypes?.exportTypes ?? false,
                targets,
                readonly,
              ),
            ),
        }
      : undefined,
  ]
}

/** The part of a job the functions below read: its name, where it writes, and in which mode. */
type JobTarget = { readonly name: string; readonly output: string; readonly split: boolean }

/**
 * Whether a job merges into what is already at its output rather than overwrite it.
 *
 * `elysia` reads the app entry and the modules back and keeps whatever the user wrote there
 * (`mergeSource`), so what it writes holds the user's code as much as the generator's. Nothing
 * that deletes — the split clean below, the Vite plugin's stale-output cleanup — may touch it.
 */
export function isUserCodeJob(job: { readonly name: string }) {
  return job.name === 'elysia'
}

/**
 * Every absolute path a job writes under.
 *
 * The output itself, and for `elysia` the `modules/` directory it fills beside the app entry —
 * one file per resource, which a caller that watches for changed output has to see as well.
 */
export function jobTargets(job: JobTarget): readonly string[] {
  const output = path.resolve(process.cwd(), job.output)
  return job.name === 'elysia' ? [output, path.join(path.dirname(output), 'modules')] : [output]
}

/**
 * Whether `filePath` sits under `directory`, at any depth.
 *
 * Asked of the path segments rather than the string: `/app/spec-old/a.yaml` starts with
 * `/app/spec` and is not inside it.
 */
export function isInsideDirectory(directory: string, filePath: string) {
  const relative = path.relative(directory, filePath)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function cleanSplitDirectory(directory: string, keep: ReadonlySet<string>) {
  return Effect.gen(function* () {
    const names = yield* readdir(directory)
    const stale = names
      .filter((name) => name.endsWith('.ts'))
      .map((name) => path.join(directory, name))
      .filter((file) => !keep.has(file))
    yield* Effect.all(stale.map(unlink), { concurrency: 'unbounded' })
    return stale
  })
}

/**
 * Empties every split output directory before the generators refill them, answering with what
 * was removed.
 *
 * A split generator writes one file per entry plus a barrel beside them, and knows only what it
 * writes — so an entry that leaves the document leaves its file behind, orphaned and still
 * importing names the document no longer defines. A split directory is therefore the generator's,
 * not a place to keep anything by hand.
 *
 * Only the direct `.ts` children are removed, never a subdirectory, and never a file another job
 * writes on its own: a single-file output that lives inside a split directory is left where it is
 * rather than deleted and rewritten. A split job that merges into the user's code is never
 * cleaned at all.
 *
 * This runs before any job writes, never per job as it goes: two jobs can be aimed at one
 * directory, and a clean that lands after a sibling has filled it would take the fresh files with
 * it.
 */
export function cleanSplitOutputs(jobs: readonly JobTarget[]) {
  return Effect.gen(function* () {
    const keep = new Set(
      jobs.filter((job) => !job.split).map((job) => path.resolve(process.cwd(), job.output)),
    )
    const directories = new Set(
      jobs
        .filter((job) => job.split && !isUserCodeJob(job))
        .map((job) => path.resolve(process.cwd(), job.output)),
    )
    const removed = yield* Effect.all(
      [...directories].map((directory) => cleanSplitDirectory(directory, keep)),
      { concurrency: 'unbounded' },
    )
    return removed.flat()
  })
}

const TYPESPEC_IMPORT = /^\s*import\s+"(?<specifier>\.{1,2}\/[^"]*)"/gmu

/**
 * The `.tsp` files reachable from `file` through relative imports, `file` included.
 *
 * Read off the source text rather than asked of the compiler: a compile is the expensive part of
 * a pass, and the only thing wanted here is which files an edit could come from. An import of a
 * directory is its `main.tsp`, as it is to the compiler. A file that cannot be read is still
 * named — it is where the fix will be written.
 */
function typeSpecSources(
  file: string,
  seen: ReadonlySet<string>,
): Effect.Effect<ReadonlySet<string>, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    if (seen.has(file)) return seen
    const fs = yield* FileSystem.FileSystem
    const info = yield* fs.stat(file).pipe(Effect.orElseSucceed(() => null))
    if (info?.type === 'Directory') return yield* typeSpecSources(path.join(file, 'main.tsp'), seen)
    const source = file.endsWith('.tsp')
      ? yield* fs.readFileString(file).pipe(Effect.orElseSucceed(() => ''))
      : ''
    const imports = [...source.matchAll(TYPESPEC_IMPORT)]
      .map((match) => match.groups?.specifier)
      .filter((specifier) => specifier !== undefined)
      .map((specifier) => path.resolve(path.dirname(file), specifier))
    return yield* Effect.reduce(
      imports,
      (): ReadonlySet<string> => new Set([...seen, file]),
      (found, imported) => typeSpecSources(imported, found),
    )
  })
}

/**
 * The files the document at `input` reads from that sit outside its own directory.
 *
 * For a watcher, and only for a watcher. A `$ref` or a TypeSpec `import` can reach a file
 * anywhere on disk, so watching the directory `input` sits in misses some of the edits that
 * change the output; these are the files it misses.
 *
 * Nothing here feeds generation. `parseOpenAPI` still reads the document with `bundle`, which is
 * what folds a split document into one; this asks `resolve`, which stops after reading the files
 * `bundle` would go on to fold. The two read the same files, so the list is the one `bundle`
 * works from, without paying for a document nobody uses — and an edit to one of them reruns the
 * pass, where `bundle` picks the new contents up.
 *
 * Nothing under `node_modules` is named: a library the document imports is not something the
 * user edits. Fails when the document cannot be read, so the caller can keep the list it already
 * has rather than trust a partial one.
 */
export function outsideSources(input: string) {
  return Effect.gen(function* () {
    const files = input.endsWith('.tsp')
      ? [...(yield* typeSpecSources(path.resolve(input), new Set()))]
      : yield* Effect.tryPromise({
          try: async () => {
            const references = await SwaggerParser.resolve(input)
            return references.paths('file')
          },
          catch: (error) =>
            new GenerateError({ message: error instanceof Error ? error.message : String(error) }),
        })
    const inputDirectory = path.dirname(path.resolve(input))
    return [...new Set(files.map((file) => path.resolve(file)))]
      .filter(
        (file) =>
          file !== path.resolve(input) &&
          !isInsideDirectory(inputDirectory, file) &&
          !file.split(path.sep).includes('node_modules'),
      )
      .toSorted()
  })
}
