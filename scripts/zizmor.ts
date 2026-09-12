// Runs zizmorcore/zizmor, the security audit for GitHub Actions workflows, the same way locally and
// in CI.
//
// zizmor is a Rust binary with no npm distribution, so this fetches the pinned release for the
// current platform once, verifies it against the sha256 digest GitHub records for the release
// asset, caches it under node_modules/.cache and executes it with the arguments this script was
// given. Bump VERSION and ASSETS together: each digest is the asset's `digest` field in
// https://api.github.com/repos/zizmorcore/zizmor/releases/tags/v<VERSION>.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const VERSION = '1.30.1'

// Release assets are named after Rust target triples, not Node's process.platform / arch.
const ASSETS: Readonly<Record<string, { readonly name: string; readonly sha256: string }>> = {
  'darwin-arm64': {
    name: 'zizmor-aarch64-apple-darwin.tar.gz',
    sha256: 'e28d22b087f9ebb8d99da6e740d348c930f559961c7c3f12badda54f882195a2',
  },
  'darwin-x64': {
    name: 'zizmor-x86_64-apple-darwin.tar.gz',
    sha256: '10e6b18b11ea07e515a16f0f0518c7b07527bc9977c1fd5698181ce7f3554202',
  },
  'linux-arm64': {
    name: 'zizmor-aarch64-unknown-linux-gnu.tar.gz',
    sha256: '7ff1dce33bdd18fd2a4affe63bdd47efcccca97b2cec1c1863ec26e9e2647540',
  },
  'linux-x64': {
    name: 'zizmor-x86_64-unknown-linux-gnu.tar.gz',
    sha256: 'e65324f4430c2717591937edcec90ccbefaf14c174f8ec9415e03ca875b46e1a',
  },
  'win32-x64': {
    name: 'zizmor-x86_64-pc-windows-msvc.zip',
    sha256: 'b183b1e996eddfab9659f1e9b46e059f1ef1cf984a1f14e5da09f7876a4b3a1c',
  },
}

const target = `${process.platform}-${process.arch}`
const asset = ASSETS[target]
if (asset === undefined) {
  console.error(`zizmor: no pinned release for ${target}; see scripts/zizmor.ts`)
  process.exit(1)
}

const cacheDir = join(import.meta.dirname, '..', 'node_modules', '.cache', 'zizmor', VERSION)
const binary = join(cacheDir, process.platform === 'win32' ? 'zizmor.exe' : 'zizmor')

if (!existsSync(binary)) {
  const url = `https://github.com/zizmorcore/zizmor/releases/download/v${VERSION}/${asset.name}`
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`zizmor: download failed: ${response.status} ${response.statusText} ${url}`)
    process.exit(1)
  }
  const archive = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== asset.sha256) {
    console.error(
      `zizmor: checksum mismatch for ${asset.name}\n  expected ${asset.sha256}\n  actual   ${actual}`,
    )
    process.exit(1)
  }
  rmSync(cacheDir, { recursive: true, force: true })
  mkdirSync(cacheDir, { recursive: true })
  const archivePath = join(cacheDir, asset.name)
  writeFileSync(archivePath, archive)
  // bsdtar (macOS, Windows 10+) and GNU tar both extract .tar.gz; bsdtar also reads .zip.
  execFileSync('tar', ['-xf', archivePath, '-C', cacheDir], { stdio: 'inherit' })
  rmSync(archivePath)
  chmodSync(binary, 0o755)
}

try {
  execFileSync(binary, process.argv.slice(2), { stdio: 'inherit' })
} catch (error) {
  process.exit(
    typeof error === 'object' &&
      error !== null &&
      'status' in error &&
      typeof error.status === 'number'
      ? error.status
      : 1,
  )
}
