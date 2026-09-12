// Runs rhysd/actionlint over .github/workflows, the same way locally and in CI.
//
// actionlint is a Go binary with no maintained npm distribution, so this fetches the pinned
// release for the current platform once, verifies it against the checksums published with
// that release, caches it under node_modules/.cache and executes it with the arguments this
// script was given. Bump VERSION and CHECKSUMS together from
// https://github.com/rhysd/actionlint/releases — a release's `*_checksums.txt` holds them.

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const VERSION = '1.7.12'

const CHECKSUMS: Readonly<Record<string, string>> = {
  'darwin-arm64': 'aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f',
  'darwin-x64': '5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644',
  'linux-arm64': '325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6',
  'linux-x64': '8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8',
  'win32-arm64': 'cadcf7ea4efe3a68728893813643cebe1185e5b1d4be5b96245f65c9a4d5ea41',
  'win32-x64': '6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9',
}

// Release assets are named after Go's GOOS / GOARCH, not Node's process.platform / arch.
const ASSET_OS: Readonly<Record<string, string>> = {
  darwin: 'darwin',
  linux: 'linux',
  win32: 'windows',
}
const ASSET_ARCH: Readonly<Record<string, string>> = { arm64: 'arm64', x64: 'amd64' }

const target = `${process.platform}-${process.arch}`
const checksum = CHECKSUMS[target]
if (checksum === undefined) {
  console.error(`actionlint: no pinned release for ${target}; see scripts/actionlint.ts`)
  process.exit(1)
}

const windows = process.platform === 'win32'
const asset = `actionlint_${VERSION}_${ASSET_OS[process.platform]}_${ASSET_ARCH[process.arch]}.${windows ? 'zip' : 'tar.gz'}`
const cacheDir = join(import.meta.dirname, '..', 'node_modules', '.cache', 'actionlint', VERSION)
const binary = join(cacheDir, windows ? 'actionlint.exe' : 'actionlint')

if (!existsSync(binary)) {
  const url = `https://github.com/rhysd/actionlint/releases/download/v${VERSION}/${asset}`
  const response = await fetch(url)
  if (!response.ok) {
    console.error(`actionlint: download failed: ${response.status} ${response.statusText} ${url}`)
    process.exit(1)
  }
  const archive = Buffer.from(await response.arrayBuffer())
  const actual = createHash('sha256').update(archive).digest('hex')
  if (actual !== checksum) {
    console.error(
      `actionlint: checksum mismatch for ${asset}\n  expected ${checksum}\n  actual   ${actual}`,
    )
    process.exit(1)
  }
  rmSync(cacheDir, { recursive: true, force: true })
  mkdirSync(cacheDir, { recursive: true })
  const archivePath = join(cacheDir, asset)
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
