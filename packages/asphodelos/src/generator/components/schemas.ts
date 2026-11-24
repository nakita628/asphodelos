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
 * name (`User`, `User2`, …) so every declaration is unique.
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

/**
 * The schema const the schemas generator writes for each `components.schemas` key, so a generator
 * that names a component from outside (a hook typing its data by one) names the const that was
 * actually written. The names are resolved over the whole document, whether the output is one
 * file or split: a split output writes the same consts, one file per group.
 */
export function schemaConstNames(
  schemas: { readonly [k: string]: Schema } | undefined,
): ReadonlyMap<string, string> {
  if (!schemas) return new Map()
  return new Map(
    [...resolveUniqueNames(Object.keys(schemas))].map(
      ([key, unique]) => [key, `${unique}Schema`] as const,
    ),
  )
}

// What a schema carries as data rather than as schemas: a `$ref` member in there is a value.
const DATA_KEYS = new Set(['example', 'examples', 'default', 'enum', 'const'])

// The members of a schema that map a name to a schema: their keys are names, whatever they spell —
// a property called `default` or `$ref` is a schema like any other.
const NAMED_KEYS = new Set([
  'properties',
  'patternProperties',
  'dependentSchemas',
  '$defs',
  'definitions',
])

// The key a `$ref` names in `components.schemas`. A `$ref` that does not decode names none.
function refKey($ref: string) {
  const m = /^#\/components\/schemas\/([^/]+)$/u.exec($ref)
  if (!m?.[1]) return undefined
  try {
    return decodeURIComponent(m[1])
  } catch {
    return undefined
  }
}

function renameRefs<T>(value: T, renamed: ReadonlyMap<string, string>, named?: boolean): T
function renameRefs(value: unknown, renamed: ReadonlyMap<string, string>, named = false): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => renameRefs(item, renamed))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, member]: readonly [string, unknown]) => {
      if (named) return [key, renameRefs(member, renamed)]
      if (DATA_KEYS.has(key)) return [key, member]
      if (key !== '$ref' || typeof member !== 'string') {
        return [key, renameRefs(member, renamed, NAMED_KEYS.has(key))]
      }
      const to = renamed.get(refKey(member) ?? '')
      return [key, to ? `#/components/schemas/${to}` : member]
    }),
  )
}

/**
 * `schemas` with every key that needs a suffix to stay unique (`user` beside `User`) renamed to
 * its unique name (`User2`), and every `$ref` to it pointed at the new key. Everything that names
 * a schema by its key — the const and the type, a `$ref` rendered as a const, a sibling file's
 * import, the file a split output writes it to — then names the one that was written for it. The
 * names are those of {@link schemaConstNames}, so the rename has to be made over the whole
 * document, before it is split into files. A document without colliding keys is returned as it is.
 */
export function uniqueSchemas(schemas: { readonly [k: string]: Schema }): {
  readonly [k: string]: Schema
} {
  const renamed = new Map(
    [...resolveUniqueNames(Object.keys(schemas))].filter(
      ([key, unique]) => pascalCase(key) !== unique,
    ),
  )
  if (renamed.size === 0) return schemas
  return Object.fromEntries(
    Object.entries(schemas).map(([key, schema]) => [
      renamed.get(key) ?? key,
      renameRefs(schema, renamed),
    ]),
  )
}

export function schemasCode(
  schemas: { readonly [k: string]: Schema } | undefined,
  readonlyMode?: boolean,
  exportTypes?: boolean,
  exported = true,
) {
  if (!schemas || Object.keys(schemas).length === 0) return ''
  const unique = uniqueSchemas(schemas)
  const groups = sccSchemas(Object.entries(unique).map(([name, schema]) => ({ name, schema })))
  return groups
    .map((group) => emitGroup(group, readonlyMode, exportTypes, exported))
    .filter((s) => s.length > 0)
    .join('\n\n')
}

type Member = { readonly name: string; readonly schema: Schema }

function refsWithin(schema: Schema, memberNames: ReadonlySet<string>) {
  return new Set([...collectSchemaRefs(schema)].filter((ref) => memberNames.has(ref)))
}

// A mutually-recursive SCC is "star-shaped" when one hub member is referenced by every other
// member and each spoke references only the hub. Such a group collapses to a single
// `t.Recursive` root plus plain derived consts: `t.Recursive`'s `Self` defers the type
// expansion that makes `Static<typeof Module.Import>` blow past the instantiation depth limit
// (TS2589). Non-star SCCs (true N-way recursion, union/intersect cycles) stay on the
// `t.Module` path, where the depth limit is the input's problem, not ours to mis-collapse.
function findStar(group: readonly Member[]): { hub: Member; spokes: readonly Member[] } | null {
  const memberNames = new Set(group.map((member) => member.name))
  const refs = new Map(
    group.map((member) => [member.name, refsWithin(member.schema, memberNames)] as const),
  )
  const candidates = group.filter((hub) => {
    const spokes = group.filter((member) => member.name !== hub.name)
    const hubRefs = refs.get(hub.name) ?? new Set<string>()
    const spokesRefOnlyHub = spokes.every((s) => {
      const spokeRefs = refs.get(s.name) ?? new Set<string>()
      return spokeRefs.size === 1 && spokeRefs.has(hub.name)
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
  return { hub, spokes: group.filter((member) => member.name !== hub.name) }
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
    const declaration = `${exportKw}const ${ident}=${readonly(expr, readonlyMode)}`
    return exportTypes
      ? `${declaration}\n\nexport type ${pascalCase(name)}=Static<typeof ${ident}>`
      : declaration
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
) {
  const exportKw = exported ? 'export ' : ''
  const head = group[0]
  if (group.length === 1 && head) {
    const { name, schema } = head
    const ident = `${pascalCase(name)}Schema`
    const refs = collectSchemaRefs(schema)
    const inner = typebox(schema)
    const expr = refs.has(name)
      ? `t.Recursive((Self)=>${inner.replaceAll(new RegExp(`\\b${ident}\\b`, 'gu'), 'Self')})`
      : inner
    const decl = `${exportKw}const ${ident}=${readonly(expr, readonlyMode)}`
    return exportTypes ? `${decl}\n\nexport type ${pascalCase(name)}=Static<typeof ${ident}>` : decl
  }
  const star = findStar(group)
  if (star) return emitStar(star, exportKw, readonlyMode, exportTypes)
  const memberNames = new Set(group.map((member) => member.name))
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
      const ident = `${pascalCase(name)}Schema`
      const expr = `${moduleId}.Import('${name}')`
      const decl = `${exportKw}const ${ident}=${readonly(expr, readonlyMode)}`
      return exportTypes
        ? `${decl}\n\nexport type ${pascalCase(name)}=Static<typeof ${ident}>`
        : decl
    })
    .join('\n\n')
  return `const ${moduleId}=t.Module({${moduleEntries}})\n\n${decls}`
}
