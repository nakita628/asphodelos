import { collectSchemaRefs, sccSchemas } from '../../helper/schema.js'
import { readonly } from '../../helper/typebox.js'
import type { OpenAPI, Schema } from '../../openapi/index.js'
import { pascalCase } from '../../utils/index.js'
import { typebox } from '../typebox/index.js'

// A string literal of the rendered code (`"…"`, `'…'`, `` `…` ``), escapes included.
const STRING_LITERAL = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/su

// Where the dependent schemas a `.Decode(…)` closure checks against (`const depSubs={…}`, written
// by `transformWrap`) open and close in the code between the string literals. The closure runs
// when a value is decoded, after every const of the module exists, so a const named there
// (`{"k":BSchema}`) is left as it is: a `t.Ref` or `Self` there is checked outside the module or
// the recursion, where it resolves to nothing. Only that literal is kept, bounded by counting its
// braces, so nothing else in a closure is left out of the rewrite, and a literal left open at the
// end is dropped. Like the split on string literals, the count reads the code as text: a raw
// `x-transform` with a lone brace or quote in a regex literal can still throw it off.
const DEPENDENT = 'const depSubs={'

function closures(parts: readonly string[]): readonly (readonly [number, number])[] {
  const marks: (readonly [number, number])[] = []
  const state = { depth: 0 }
  for (const [index, part] of parts.entries()) {
    if (index % 2 === 1) continue
    for (let at = 0; at < part.length; at += 1) {
      if (state.depth === 0) {
        if (!part.startsWith(DEPENDENT, at)) continue
        marks.push([index, at + DEPENDENT.length])
        state.depth = 1
        at += DEPENDENT.length - 1
        continue
      }
      if (part[at] === '{') state.depth += 1
      if (part[at] === '}') state.depth -= 1
      if (state.depth === 0) marks.push([index, at])
    }
  }
  return marks.length % 2 === 0 ? marks : marks.slice(0, -1)
}

// Every reference to the identifier `from` in `code` replaced with `to`; the text of a string
// literal, a longer identifier that contains `from`, and a closure's dependent schemas are left
// as they are.
function sub(code: string, from: string, to: string) {
  const escaped = from.replaceAll(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  const ident = new RegExp(`(?<![\\w$])${escaped}(?![\\w$])`, 'gu')
  // Split with a capture, the literals sit at the odd indexes, the code between them at the even.
  const parts = code.split(STRING_LITERAL)
  // The closures' bounds alternate open, close: a part is cut at each, and only the pieces
  // outside a closure are rewritten.
  const marks = code.includes(DEPENDENT) ? closures(parts) : []
  return parts
    .map((part, i) => {
      if (i % 2 === 1) return part
      const cuts = marks.filter(([at]) => at === i).map(([, offset]) => offset)
      const before = marks.filter(([at]) => at < i).length
      const pieces = [0, ...cuts, part.length].slice(0, -1).map((start, k) => ({
        text: part.slice(start, [...cuts, part.length][k]),
        inside: (before + k) % 2 === 1,
      }))
      return pieces
        .map((piece) => (piece.inside ? piece.text : piece.text.replaceAll(ident, () => to)))
        .join('')
    })
    .join('')
}

// A `t.Module` entry's key: bare when it is an identifier, quoted otherwise (`"x.y"`), and
// computed for `__proto__`, which as a plain key sets the literal's prototype instead.
function moduleKey(name: string) {
  if (name === '__proto__') return '["__proto__"]'
  return /^[A-Za-z_$][\w$]*$/u.test(name) ? name : JSON.stringify(name)
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
  // Every key's own name is reserved before any suffix is chosen, so a key that already is the
  // suffixed name of another (`User2` beside `User`, `user`) keeps it.
  const reserved = new Set(keys.map(pascalCase))
  return keys.reduce<{ readonly used: Set<string>; readonly map: Map<string, string> }>(
    (acc, key) => {
      const base = pascalCase(key)
      const unique = acc.used.has(base)
        ? findFree(base, 2, new Set([...acc.used, ...reserved]))
        : base
      acc.used.add(unique)
      acc.map.set(key, unique)
      return acc
    },
    { used: new Set(), map: new Map() },
  ).map
}

// What a schema carries as data rather than as schemas: a `$ref` member in there is a value.
// A link's `parameters` and `requestBody` are runtime expressions or literal values, and an `x-`
// extension is the user's own data.
const DATA_KEYS = new Set(['example', 'examples', 'default', 'enum', 'const', 'links'])

// The members that map a name to an object — a schema's (`properties`), an operation's
// (`responses`, `content`), the document's (`paths`, the sections of `components`): their keys are
// names, whatever they spell — a property called `default` or `$ref` is a schema like any other.
const NAMED_KEYS = new Set([
  'properties',
  'patternProperties',
  'dependentSchemas',
  'dependencies',
  '$defs',
  'definitions',
  'paths',
  'webhooks',
  'callbacks',
  'responses',
  'content',
  'encoding',
  'headers',
  'schemas',
  'parameters',
  'requestBodies',
  'securitySchemes',
  'pathItems',
  'additionalOperations',
  'mediaTypes',
])

// The key a `$ref` names in `components.schemas` (the empty key too), and the pointer past it
// (`/properties/x`). A `$ref` that does not decode names none.
function refTarget($ref: string) {
  const m = /^#\/components\/schemas\/([^/]*)(\/.*)?$/u.exec($ref)
  if (m?.[1] === undefined) return undefined
  try {
    return { key: decodeURIComponent(m[1]), rest: m[2] ?? '' }
  } catch {
    return undefined
  }
}

// A `$ref` string into a renamed key, pointed at its new key.
function renameRef($ref: string, renamed: ReadonlyMap<string, string>) {
  const target = refTarget($ref)
  const to = target === undefined ? undefined : renamed.get(target.key)
  return to === undefined || target === undefined
    ? undefined
    : `#/components/schemas/${encodeURIComponent(to)}${target.rest}`
}

// A discriminator's `mapping` value or `defaultMapping` names a schema by a `$ref` or its bare key.
function renameTarget(target: unknown, renamed: ReadonlyMap<string, string>) {
  if (typeof target !== 'string') return target
  return renameRef(target, renamed) ?? renamed.get(target) ?? target
}

function renameDiscriminator(discriminator: object, renamed: ReadonlyMap<string, string>) {
  return Object.fromEntries(
    Object.entries(discriminator).map(([key, member]: readonly [string, unknown]) => {
      if (key === 'defaultMapping') return [key, renameTarget(member, renamed)]
      if (key !== 'mapping' || typeof member !== 'object' || member === null) return [key, member]
      if (Array.isArray(member)) return [key, member]
      return [
        key,
        Object.fromEntries(
          Object.entries(member).map(([value, target]: readonly [string, unknown]) => [
            value,
            renameTarget(target, renamed),
          ]),
        ),
      ]
    }),
  )
}

function renameRefs<T>(value: T, renamed: ReadonlyMap<string, string>, named?: boolean): T
function renameRefs(value: unknown, renamed: ReadonlyMap<string, string>, named = false): unknown {
  if (Array.isArray(value)) return value.map((item: unknown) => renameRefs(item, renamed))
  if (typeof value !== 'object' || value === null) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, member]: readonly [string, unknown]) => {
      if (named) return [key, renameRefs(member, renamed)]
      if (DATA_KEYS.has(key) || key.startsWith('x-')) return [key, member]
      if (
        key === 'discriminator' &&
        typeof member === 'object' &&
        member !== null &&
        !Array.isArray(member)
      ) {
        return [key, renameDiscriminator(member, renamed)]
      }
      if (key !== '$ref' || typeof member !== 'string') {
        return [key, renameRefs(member, renamed, NAMED_KEYS.has(key))]
      }
      return [key, renameRef(member, renamed) ?? member]
    }),
  )
}

// The keys that need a suffix to stay unique, each with the unique name it is renamed to.
function renamedKeys(schemas: { readonly [k: string]: Schema }): ReadonlyMap<string, string> {
  return new Map(
    [...resolveUniqueNames(Object.keys(schemas))].filter(
      ([key, unique]) => pascalCase(key) !== unique,
    ),
  )
}

/**
 * `openAPI` with every schema key that needs a suffix to stay unique (`user` beside `User`)
 * renamed to its unique name (`User2`), and every `$ref` to it — in a schema, a response, a
 * request body, a parameter, a discriminator's mapping — pointed at the new key. Every generator
 * names a schema by its key, each in its own place: the const and the type, a rendered `$ref`,
 * an import, a model, a mock. Made once over the document they all read, the rename has them
 * name the same schema by the same name. A document without colliding keys is returned as it is.
 */
export function uniqueSchemaKeys(openAPI: OpenAPI): OpenAPI {
  const schemas = openAPI.components?.schemas
  const renamed = schemas ? renamedKeys(schemas) : new Map<string, string>()
  if (!schemas || renamed.size === 0) return openAPI
  const { components, ...rest } = renameRefs(openAPI, renamed)
  return {
    ...rest,
    components: {
      ...components,
      schemas: Object.fromEntries(
        Object.entries(components?.schemas ?? {}).map(([key, schema]) => [
          renamed.get(key) ?? key,
          schema,
        ]),
      ),
    },
  }
}

/**
 * `schemas` with every key that needs a suffix to stay unique (`user` beside `User`) renamed to
 * its unique name (`User2`), and every `$ref` to it pointed at the new key. Everything that names
 * a schema by its key — the const and the type, a `$ref` rendered as a const, a sibling file's
 * import, the file a split output writes it to — then names the one that was written for it. The
 * names are those of {@link resolveUniqueNames}, so the rename has to be made over the whole
 * document, before it is split into files. A document without colliding keys is returned as it is.
 */
export function uniqueSchemas(schemas: { readonly [k: string]: Schema }): {
  readonly [k: string]: Schema
} {
  const renamed = renamedKeys(schemas)
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
    const expr = refs.has(name) ? `t.Recursive((Self)=>${sub(inner, ident, 'Self')})` : inner
    const decl = `${exportKw}const ${ident}=${readonly(expr, readonlyMode)}`
    return exportTypes ? `${decl}\n\nexport type ${pascalCase(name)}=Static<typeof ${ident}>` : decl
  }
  const star = findStar(group)
  if (star) return emitStar(star, exportKw, readonlyMode, exportTypes)
  const memberNames = new Set(group.map((member) => member.name))
  const moduleEntries = group
    .map(({ name, schema }) => {
      const inner = typebox(schema)
      const rewritten = [...memberNames].reduce(
        (acc, m) => sub(acc, `${pascalCase(m)}Schema`, `t.Ref(${JSON.stringify(m)})`),
        inner,
      )
      return `${moduleKey(name)}:${rewritten}`
    })
    .join(',')
  const moduleId = head ? `${pascalCase(head.name)}Module` : 'Module'
  const decls = group
    .map(({ name }) => {
      const ident = `${pascalCase(name)}Schema`
      const expr = `${moduleId}.Import(${JSON.stringify(name)})`
      const decl = `${exportKw}const ${ident}=${readonly(expr, readonlyMode)}`
      return exportTypes
        ? `${decl}\n\nexport type ${pascalCase(name)}=Static<typeof ${ident}>`
        : decl
    })
    .join('\n\n')
  return `const ${moduleId}=t.Module({${moduleEntries}})\n\n${decls}`
}
