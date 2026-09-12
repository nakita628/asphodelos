import { collectSchemaRefs, sccSchemas } from '../../helper/schema.js'
import { readonly } from '../../helper/typebox.js'
import type { Schema } from '../../openapi/index.js'
import { pascalCase } from '../../utils/index.js'
import { typebox } from '../typebox/index.js'

function sub(code: string, from: string, to: string) {
  return code.replaceAll(new RegExp(`\\b${from}\\b`, 'gu'), to)
}

function findFree(base: string, i: number, used: ReadonlySet<string>): string {
  const candidate = `${base}${i}`
  return used.has(candidate) ? findFree(base, i + 1, used) : candidate
}

/**
 * OpenAPI schema keys are case-sensitive, but `pascalCase` upper-cases the first
 * letter, so `User` and `user` both emit `const UserSchema` / `type User`
 * (TS2451 / TS2300). Map each colliding key to a deterministic suffixed exported
 * name (`User`, `User2`, …) so every declaration is unique. The map is global
 * across SCC groups; TypeBox refs (`t.Ref('user')`, recursive `Self`) keep using
 * the original key, so only the exported binding names change.
 */
function resolveUniqueNames(keys: readonly string[]): ReadonlyMap<string, string> {
  return keys.reduce<{ readonly used: Set<string>; readonly map: Map<string, string> }>(
    (acc, key) => {
      const base = pascalCase(key)
      const unique = acc.used.has(base) ? findFree(base, 2, acc.used) : base
      acc.used.add(unique)
      acc.map.set(key, unique)
      return acc
    },
    { used: new Set(), map: new Map() },
  ).map
}

export function schemasCode(
  schemas: { readonly [k: string]: Schema } | undefined,
  readonlyMode?: boolean,
  exportTypes?: boolean,
  exported = true,
) {
  if (!schemas || Object.keys(schemas).length === 0) return ''
  const names = resolveUniqueNames(Object.keys(schemas))
  const groups = sccSchemas(Object.entries(schemas).map(([name, schema]) => ({ name, schema })))
  return groups
    .map((group) => emitGroup(group, readonlyMode, exportTypes, exported, names))
    .filter((s) => s.length > 0)
    .join('\n\n')
}

type Member = { readonly name: string; readonly schema: Schema }

function refsWithin(schema: Schema, memberNames: ReadonlySet<string>) {
  return new Set([...collectSchemaRefs(schema)].filter((r) => memberNames.has(r)))
}

// A mutually-recursive SCC is "star-shaped" when one hub member is referenced by every other
// member and each spoke references only the hub. Such a group collapses to a single
// `t.Recursive` root plus plain derived consts: `t.Recursive`'s `Self` defers the type
// expansion that makes `Static<typeof Module.Import>` blow past the instantiation depth limit
// (TS2589). Non-star SCCs (true N-way recursion, union/intersect cycles) stay on the
// `t.Module` path, where the depth limit is the input's problem, not ours to mis-collapse.
function findStar(
  group: readonly Member[],
  exportedName: (name: string) => string,
): { hub: Member; spokes: readonly Member[] } | null {
  // The collapse rewrites refs by `${pascalCase(name)}Schema`, which only matches the emitted
  // const when no name needed a uniqueness suffix — otherwise fall back to t.Module.
  if (group.some((g) => exportedName(g.name) !== pascalCase(g.name))) return null
  const memberNames = new Set(group.map((g) => g.name))
  const refs = new Map(group.map((g) => [g.name, refsWithin(g.schema, memberNames)] as const))
  const candidates = group.filter((hub) => {
    const spokes = group.filter((g) => g.name !== hub.name)
    const hubRefs = refs.get(hub.name) ?? new Set<string>()
    const spokesRefOnlyHub = spokes.every((s) => {
      const r = refs.get(s.name) ?? new Set<string>()
      return r.size === 1 && r.has(hub.name)
    })
    return spokesRefOnlyHub && spokes.every((s) => hubRefs.has(s.name))
  })
  if (candidates.length === 0) return null
  // Prefer the most-connected candidate (the natural centre); break ties deterministically.
  const hub = candidates.reduce((a, b) => {
    const ra = (refs.get(a.name) ?? new Set()).size
    const rb = (refs.get(b.name) ?? new Set()).size
    if (rb > ra) return b
    if (rb < ra) return a
    return b.name < a.name ? b : a
  })
  return { hub, spokes: group.filter((g) => g.name !== hub.name) }
}

function emitStar(
  star: { hub: Member; spokes: readonly Member[] },
  exportKw: string,
  readonlyMode: boolean | undefined,
  exportTypes: boolean | undefined,
) {
  const { hub, spokes } = star
  const hubRef = `${pascalCase(hub.name)}Schema`
  // Inline each spoke body (its hub ref becomes Self) into the hub body, then close the hub's
  // own remaining self references with Self.
  const hubBody = spokes.reduce(
    (acc, s) =>
      sub(acc, `${pascalCase(s.name)}Schema`, `(${sub(typebox(s.schema), hubRef, 'Self')})`),
    typebox(hub.schema),
  )
  const hubExpr = `t.Recursive((Self)=>${sub(hubBody, hubRef, 'Self')})`
  const decl = (name: string, expr: string) => {
    const ident = `${pascalCase(name)}Schema`
    const d = `${exportKw}const ${ident}=${readonly(expr, readonlyMode)}`
    return exportTypes ? `${d}\n\nexport type ${pascalCase(name)}=Static<typeof ${ident}>` : d
  }
  // Hub first — the spokes reference its const.
  return [decl(hub.name, hubExpr), ...spokes.map((s) => decl(s.name, typebox(s.schema)))].join(
    '\n\n',
  )
}

function emitGroup(
  group: readonly { name: string; schema: Schema }[],
  readonlyMode: boolean | undefined,
  exportTypes: boolean | undefined,
  exported: boolean,
  names: ReadonlyMap<string, string>,
) {
  const exportKw = exported ? 'export ' : ''
  const head = group[0]
  const exportedName = (name: string) => names.get(name) ?? pascalCase(name)
  if (group.length === 1 && head) {
    const { name, schema } = head
    const ident = `${exportedName(name)}Schema`
    const selfRef = `${pascalCase(name)}Schema`
    const refs = collectSchemaRefs(schema)
    const inner = typebox(schema)
    const expr = refs.has(name)
      ? `t.Recursive((Self)=>${inner.replaceAll(new RegExp(`\\b${selfRef}\\b`, 'gu'), 'Self')})`
      : inner
    const decl = `${exportKw}const ${ident}=${readonly(expr, readonlyMode)}`
    return exportTypes
      ? `${decl}\n\nexport type ${exportedName(name)}=Static<typeof ${ident}>`
      : decl
  }
  const star = findStar(group, exportedName)
  if (star) return emitStar(star, exportKw, readonlyMode, exportTypes)
  const memberNames = new Set(group.map((g) => g.name))
  const moduleEntries = group
    .map(({ name, schema }) => {
      const inner = typebox(schema)
      const rewritten = [...memberNames].reduce((acc, m) => {
        const ident = `${pascalCase(m)}Schema`
        return acc.replaceAll(new RegExp(`\\b${ident}\\b`, 'gu'), `t.Ref('${m}')`)
      }, inner)
      return `${name}:${rewritten}`
    })
    .join(',')
  const moduleId = head ? `${pascalCase(head.name)}Module` : 'Module'
  const decls = group
    .map(({ name }) => {
      const ident = `${exportedName(name)}Schema`
      const expr = `${moduleId}.Import('${name}')`
      const decl = `${exportKw}const ${ident}=${readonly(expr, readonlyMode)}`
      return exportTypes
        ? `${decl}\n\nexport type ${exportedName(name)}=Static<typeof ${ident}>`
        : decl
    })
    .join('\n\n')
  return `const ${moduleId}=t.Module({${moduleEntries}})\n\n${decls}`
}
