import { spawnSync } from 'node:child_process'
import path from 'node:path'

/**
 * Regenerates `__generated__` before the suite runs.
 *
 * Preloaded rather than a `pretest` script so the guarantee holds however the suite is started —
 * `bun test`, a single file, an editor's runner. Generation is a few hundred milliseconds and the
 * alternative is a suite that quietly measures the last build instead of this one.
 */
const result = spawnSync('bun', ['run', path.resolve(import.meta.dir, 'generate.ts')], {
  stdio: 'inherit',
})
if (result.status !== 0) {
  throw new Error('asphodelos code generation failed — build the package first: bun run build')
}
