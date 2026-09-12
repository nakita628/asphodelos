// Checks that the TypeSpec packages in bun.lock come from one TypeSpec release.
//
// TypeSpec publishes every @typespec/* package together (compiler, http, openapi and openapi3 on
// 1.x, rest and versioning on 0.x) and each declares the others as peers at its own release
// (@typespec/openapi3 1.16.0 wants @typespec/compiler ^1.16.0 and @typespec/versioning ^0.86.0).
// A half-bumped set installs with only a warning: bun keeps an auto-installed peer at its old
// version, and Renovate's security updates bypass the "typespec" group in renovate.json and bump
// only the advisory's package. This check is what makes such a change fail.

import process from 'node:process'

import lockfile from '../bun.lock'

const SCOPE = '@typespec/'

// `packages` has one key per install location — `@typespec/http`, or `parent/@typespec/http` for
// a second copy nested under the package that needs it — and the value is
// `[name@version, registry, metadata, integrity]`.
const resolved = new Map<
  string,
  { readonly version: string; readonly peers: Record<string, string> }[]
>()
for (const [spec, , metadata] of Object.values(lockfile.packages) as [
  string,
  string,
  { readonly peerDependencies?: Record<string, string> },
][]) {
  const at = spec.lastIndexOf('@')
  const name = spec.slice(0, at)
  if (name.startsWith(SCOPE)) {
    const copies = resolved.get(name) ?? []
    copies.push({ version: spec.slice(at + 1), peers: metadata.peerDependencies ?? {} })
    resolved.set(name, copies)
  }
}

const problems: string[] = []

for (const [name, copies] of resolved) {
  if (copies.length > 1) {
    problems.push(
      `${name} resolves to ${copies.length} copies: ${copies.map((copy) => copy.version).join(', ')}`,
    )
  }
}

// The 1.x packages carry the release's own version. The 0.x ones (rest, versioning, and
// asset-emitter, which is versioned on its own) are tied to it through the peer ranges below.
const stable = [...resolved].filter(([, copies]) =>
  copies.some((copy) => !copy.version.startsWith('0.')),
)
if (new Set(stable.flatMap(([, copies]) => copies.map((copy) => copy.version))).size > 1) {
  problems.push(
    `the 1.x packages resolve to more than one version: ${stable
      .map(([name, copies]) => `${name}@${copies.map((copy) => copy.version).join(',')}`)
      .join(' ')}`,
  )
}

for (const [name, copies] of resolved) {
  for (const copy of copies) {
    for (const [peer, range] of Object.entries(copy.peers)) {
      for (const installed of resolved.get(peer) ?? []) {
        if (!Bun.semver.satisfies(installed.version, range)) {
          problems.push(
            `${name}@${copy.version} wants ${peer}@${range}, bun.lock has ${installed.version}`,
          )
        }
      }
    }
  }
}

if (problems.length > 0) {
  console.error(`typespec: the @typespec/* packages in bun.lock are not one TypeSpec release`)
  for (const problem of problems) {
    console.error(`  ${problem}`)
  }
  console.error(
    `\nMove every @typespec/* range in packages/asphodelos/package.json to the same release, then` +
      `\nre-resolve the ones bun keeps at their old version:` +
      `\n  bun update ${[...resolved.keys()].toSorted().join(' ')}`,
  )
  process.exit(1)
}
