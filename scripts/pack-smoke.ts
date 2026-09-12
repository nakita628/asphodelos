// Installs the packed npm tarball into an empty project with npm and uses it the way a user does.
//
// Everything else in `bun run check` runs inside the Bun workspace, where bun.lock pins every
// transitive version and the workspace link resolves `asphodelos` to the source. None of that
// exists for someone who runs `npm install asphodelos`, and that is where the package can break
// without any other check noticing: npm once resolved `@effect/platform-node-shared` to a newer
// rc than `effect`, installed two copies of `effect`, and the CLI died with "Service not found".
//
// The steps, each failing the run with a message that names what broke:
// 1. `npm pack` the package (its prepack copies README.md and LICENSE in) and check the tarball
//    carries the files a consumer needs;
// 2. `npm install` it into a fresh directory, with TypeScript and Vite as a user would have them;
// 3. require exactly one installed version of `effect`;
// 4. typecheck imports of both entry points under NodeNext and bundler resolution;
// 5. run the CLI: `--version`, a one-shot generation, and a config-file run;
// 6. start a Vite dev server with the plugin and wait for it to generate.
//
// Needs network access for npm, and a built `dist` (`bun run test:pack` builds first).

import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'

const packageDir = join(import.meta.dirname, '..', 'packages', 'asphodelos')
const work = mkdtempSync(join(tmpdir(), 'asphodelos-pack-smoke-'))

function run(command: string, args: readonly string[], cwd: string) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

/** Runs one check, and turns its failure into an error that names the step and what it printed. */
function step(name: string, action: () => void) {
  try {
    action()
    console.log(`✅ ${name}`)
  } catch (error) {
    const output =
      typeof error === 'object' && error !== null && 'stderr' in error && 'stdout' in error
        ? `${String(error.stdout)}${String(error.stderr)}`
        : String(error)
    throw new Error(`${name} failed\n${output}`, { cause: error })
  }
}

function packedFiles(json: string) {
  const parsed: unknown = JSON.parse(json)
  const first: unknown = Array.isArray(parsed) ? parsed[0] : undefined
  const files: unknown =
    typeof first === 'object' && first !== null && 'files' in first ? first.files : undefined
  return Array.isArray(files)
    ? files.flatMap((file: unknown) =>
        typeof file === 'object' && file !== null && 'path' in file ? [String(file.path)] : [],
      )
    : []
}

function effectVersions(json: string): ReadonlySet<string> {
  const versions = new Set<string>()
  function walk(node: unknown) {
    if (typeof node !== 'object' || node === null || !('dependencies' in node)) return
    const { dependencies } = node
    if (typeof dependencies !== 'object' || dependencies === null) return
    for (const [name, child] of Object.entries(dependencies)) {
      if (
        name === 'effect' &&
        typeof child === 'object' &&
        child !== null &&
        'version' in child &&
        typeof child.version === 'string'
      ) {
        versions.add(child.version)
      }
      walk(child)
    }
  }
  walk(JSON.parse(json))
  return versions
}

const REQUIRED_FILES = [
  'README.md',
  'LICENSE',
  'package.json',
  'dist/cli.mjs',
  'dist/index.mjs',
  'dist/index.d.mts',
  'dist/vite-plugin/index.mjs',
  'dist/vite-plugin/index.d.mts',
]

const DOCUMENT = `openapi: 3.1.0
info: { title: Smoke, version: 1.0.0 }
paths:
  /ping:
    get:
      operationId: ping
      responses: { '200': { description: OK } }
`

try {
  const tarball = { path: '' }

  step('npm pack carries README, LICENSE, the entry points and their types', () => {
    const json = run('npm', ['pack', '--json', '--pack-destination', work], packageDir)
    const files = packedFiles(json.slice(json.indexOf('[')))
    const missing = REQUIRED_FILES.filter((file) => !files.includes(file))
    if (missing.length > 0) throw new Error(`missing from the tarball: ${missing.join(', ')}`)
    const version: unknown = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
    const name =
      typeof version === 'object' && version !== null && 'version' in version
        ? `asphodelos-${String(version.version)}.tgz`
        : ''
    tarball.path = join(work, name)
    if (!existsSync(tarball.path)) throw new Error(`no tarball at ${tarball.path}`)
  })

  const project = join(work, 'project')
  step('npm install into an empty project', () => {
    mkdirSync(join(project, 'src'), { recursive: true })
    writeFileSync(
      join(project, 'package.json'),
      JSON.stringify({ name: 'smoke', private: true, type: 'module' }),
    )
    run(
      'npm',
      ['install', '--no-audit', '--no-fund', tarball.path, 'typescript@5', 'vite@8'],
      project,
    )
  })

  step('exactly one copy of effect is installed', () => {
    const versions = effectVersions(run('npm', ['ls', 'effect', '--all', '--json'], project))
    if (versions.size !== 1) {
      throw new Error(
        `effect resolved to ${[...versions].join(', ') || 'nothing'}: pin every @effect/* package the chain pulls in to the same version`,
      )
    }
  })

  step('the published types work under NodeNext and bundler resolution', () => {
    writeFileSync(
      join(project, 'check.ts'),
      `import { defineConfig } from 'asphodelos'
import { asphodelosVite } from 'asphodelos/vite-plugin'

export const config = defineConfig({ input: 'openapi.yaml', output: 'src/index.ts' })
// @ts-expect-error the input extension is part of the type
export const wrong = defineConfig({ input: 'openapi.txt' })
export const plugin: unknown = asphodelosVite()
`,
    )
    const tsc = join(project, 'node_modules', '.bin', 'tsc')
    const common = ['--strict', '--noEmit', '--target', 'ES2022', 'check.ts']
    run(tsc, ['--module', 'NodeNext', '--moduleResolution', 'NodeNext', ...common], project)
    run(tsc, ['--module', 'preserve', '--moduleResolution', 'bundler', ...common], project)
  })

  const cli = join(project, 'node_modules', '.bin', 'asphodelos')
  step('the CLI runs a one-shot generation and a config file', () => {
    writeFileSync(join(project, 'openapi.yaml'), DOCUMENT)
    if (!/^asphodelos v\d/u.test(run(cli, ['--version'], project))) {
      throw new Error('--version did not print a version')
    }
    run(cli, ['openapi.yaml', '-o', 'one-shot/index.ts'], project)
    if (!existsSync(join(project, 'one-shot/modules/ping/index.ts'))) {
      throw new Error('one-shot generation wrote nothing')
    }
    writeFileSync(
      join(project, 'asphodelos.config.ts'),
      `import { defineConfig } from 'asphodelos'

export default defineConfig({
  input: 'openapi.yaml',
  output: 'src/index.ts',
  swr: { output: 'src/hooks.ts', import: './client' },
})
`,
    )
    run(cli, [], project)
    if (!existsSync(join(project, 'src/hooks.ts'))) throw new Error('the config run wrote nothing')
  })

  step('the Vite plugin generates in a dev server', () => {
    rmSync(join(project, 'src'), { recursive: true, force: true })
    writeFileSync(
      join(project, 'vite-smoke.mjs'),
      `import { existsSync } from 'node:fs'
import { createServer } from 'vite'
import { asphodelosVite } from 'asphodelos/vite-plugin'

const server = await createServer({
  configFile: false,
  logLevel: 'silent',
  server: { middlewareMode: true, ws: false },
  plugins: [asphodelosVite()],
})
const deadline = Date.now() + 60_000
while (!existsSync('src/hooks.ts') && Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 100))
}
await server.close()
if (!existsSync('src/index.ts') || !existsSync('src/hooks.ts')) process.exit(1)
`,
    )
    run('node', ['vite-smoke.mjs'], project)
  })
} catch (error) {
  console.error(`pack-smoke: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
} finally {
  rmSync(work, { recursive: true, force: true })
}
