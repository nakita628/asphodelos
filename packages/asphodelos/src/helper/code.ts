import path from 'node:path'

export function makeModuleSpec(
  fromFile: string,
  target: { readonly output: string; readonly split?: boolean },
) {
  const rel = path.relative(path.dirname(fromFile), target.output).replaceAll('\\', '/')
  const stripped = rel.replace(/\.ts$/u, '').replace(/(^|\/)index$/u, '')
  return stripped === '' ? '.' : stripped.startsWith('.') ? stripped : `./${stripped}`
}

export function makeBarrel(value: { readonly [k: string]: unknown }) {
  return `${Object.keys(value)
    .toSorted()
    .map((k) => `export * from './${k.charAt(0).toLowerCase() + k.slice(1)}'`)
    .join('\n')}\n`
}

const JS_IDENT = '[A-Za-z_$][A-Za-z0-9_$]*'

const COMPONENT_SUFFIXES = [
  ['schemas', 'Schema'],
  ['responses', 'ResponseSchema'],
  ['parameters', 'ParamsSchema'],
  ['examples', 'Example'],
  ['requestBodies', 'RequestBodySchema'],
  ['headers', 'HeaderSchema'],
  ['securitySchemes', 'SecurityScheme'],
  ['links', 'Link'],
  ['callbacks', 'Callback'],
  ['pathItems', 'PathItem'],
  ['mediaTypes', 'MediaTypeSchema'],
] as const

const SCAN = new RegExp(
  [
    String.raw`"(?:\\.|[^"\\])*"`,
    String.raw`'(?:\\.|[^'\\])*'`,
    // A plain string: under the `u` flag an escaped backtick is a syntax error, and a raw
    // template cannot spell a backtick without escaping it.
    '`(?:\\\\.|[^`\\\\])*`',
    String.raw`//[^\n]*`,
    String.raw`/\*[\s\S]*?\*/`,
    `\\b(${JS_IDENT}(?:${COMPONENT_SUFFIXES.map(([, suf]) => suf).join('|')}))\\b`,
  ].join('|'),
  'gu',
)

const CONST_PATTERN = new RegExp(`(?:export\\s+)?const\\s+(${JS_IDENT})\\s*=`, 'gu')
const EXPORT_TYPE_PATTERN = new RegExp(`export\\s+type\\s+(${JS_IDENT})\\s*=`, 'gu')

function classifyRef(name: string) {
  return COMPONENT_SUFFIXES.reduce<readonly [string, string] | undefined>(
    (best, entry) =>
      name.endsWith(entry[1]) && (!best || entry[1].length > best[1].length) ? entry : best,
    undefined,
  )?.[0]
}

export function makeImports(
  code: string,
  fromFile: string,
  components:
    | {
        readonly [k: string]: {
          readonly output: string
          readonly split?: boolean
          readonly import?: string
        }
      }
    | undefined,
  split = false,
  excludeKinds: ReadonlySet<string> = new Set(),
) {
  const fallbackPrefix = split ? '..' : '.'
  const resolvePath = (k: string): string => {
    const target = components?.[k]
    return target?.import ?? (target ? makeModuleSpec(fromFile, target) : `${fallbackPrefix}/${k}`)
  }
  const definedConsts = new Set(
    Array.from(code.matchAll(CONST_PATTERN), (m) => m[1]).filter(Boolean),
  )
  const definedTypes = new Set(
    Array.from(code.matchAll(EXPORT_TYPE_PATTERN), (m) => m[1]).filter(Boolean),
  )
  const grouped = new Map<string, Set<string>>()
  for (const match of code.matchAll(SCAN)) {
    const name = match[1]
    if (!name || definedConsts.has(name) || definedTypes.has(name)) continue
    const kind = classifyRef(name)
    if (!kind || excludeKinds.has(kind)) continue
    const bucket = grouped.get(kind) ?? new Set()
    bucket.add(name)
    grouped.set(kind, bucket)
  }
  const needsT = /\bt\.[A-Z]/u.test(code)
  const needsStatic = /\bStatic\s*</u.test(code) && !definedTypes.has('Static')
  const needsUnwrap = /\bUnwrapSchema\s*</u.test(code) && !definedTypes.has('UnwrapSchema')
  const elysiaParts = [
    needsT ? 't' : '',
    needsStatic ? 'type Static' : '',
    needsUnwrap ? 'type UnwrapSchema' : '',
  ].filter(Boolean)
  const elysiaLine = elysiaParts.length > 0 ? `import {${elysiaParts.join(',')}} from 'elysia'` : ''
  const needsValue = /\bValue\.Check\b/u.test(code)
  const valueLine = needsValue ? `import {Value} from '@sinclair/typebox/value'` : ''
  const componentImports = COMPONENT_SUFFIXES.flatMap(([kind]) => {
    const names = grouped.get(kind)
    if (!names) return []
    return [`import {${[...names].toSorted().join(',')}} from '${resolvePath(kind)}'`]
  })
  const headerLines = [elysiaLine, valueLine, ...componentImports].filter(Boolean)
  if (headerLines.length === 0) return code
  return `${headerLines.join('\n')}\n\n${code}`
}
