export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function uncapitalize(s: string) {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function encodeNonAscii(name: string) {
  // Spreading a string iterates by code point, which is the unit this function re-encodes;
  // a surrogate pair must not be split.
  // oxlint-disable-next-line typescript/no-misused-spread
  return [...name]
    .map((ch) => {
      const cp = ch.codePointAt(0) ?? 0
      return cp > 0x7f ? `u${cp.toString(16)}` : ch
    })
    .join('')
}

export function pascalCase(s: string) {
  const parts = encodeNonAscii(s)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
  if (parts.length === 0) return 'Schema'
  const result = parts.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join('')
  return /^[0-9]/.test(result) ? `_${result}` : result
}

export function filterDefined<T>(arr: readonly (T | null | undefined)[]) {
  return arr.filter((e): e is T => e !== null && e !== undefined)
}

const JS_RESERVED: ReadonlySet<string> = new Set([
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'enum',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
  'let',
  'static',
  'yield',
  'await',
  'implements',
  'interface',
  'package',
  'private',
  'protected',
  'public',
])

/**
 * Produce a valid lower-camel JavaScript identifier for a module variable.
 * Already-valid, non-reserved names pass through unchanged; reserved words get
 * a `Module` suffix (`class` → `classModule`) and non-identifier characters /
 * leading digits are normalized so `export const <name>` always parses.
 */
export function toSafeIdentifier(name: string) {
  const cleaned = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)
    ? name
    : (() => {
        const parts = name.split(/[^A-Za-z0-9]+/).filter(Boolean)
        const joined = parts
          .map((p, i) => (i === 0 ? p : p.charAt(0).toUpperCase() + p.slice(1)))
          .join('')
        if (joined.length === 0) return '_'
        return /^[0-9]/.test(joined) ? `_${joined}` : joined
      })()
  return JS_RESERVED.has(cleaned) ? `${cleaned}Module` : cleaned
}

/**
 * Encode an HTTP response status as an object key: pure-integer codes stay
 * unquoted (`200`), ranges and `default` (`2XX`, `default`) are quoted so they
 * are not parsed as malformed numeric literals.
 */
export function safeStatusKey(status: string) {
  return /^[0-9]+$/.test(status) ? status : JSON.stringify(status)
}

/**
 * The top-level resource segment of a path, used as the first element of every
 * cache-key tuple (`/posts/{id}` → `posts`). An empty path falls back to `''`.
 */
export function resourcePrefix(pathStr: string) {
  return pathStr.replace(/^\//, '').split('/')[0] ?? ''
}
