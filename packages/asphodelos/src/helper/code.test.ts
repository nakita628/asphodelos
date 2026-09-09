import { describe, expect, it } from 'bun:test'

import { makeBarrel, makeImports, makeModuleSpec } from './code.js'

describe('makeModuleSpec', () => {
  it('emits `./sibling` for a same-directory target', () => {
    expect(makeModuleSpec('/gen/src/a.ts', { output: '/gen/src/b.ts' })).toBe('./b')
  })

  it('strips a trailing /index segment', () => {
    expect(makeModuleSpec('/gen/src/a.ts', { output: '/gen/src/b/index.ts' })).toBe('./b')
  })

  it('strips the .ts extension', () => {
    expect(makeModuleSpec('/gen/src/a.ts', { output: '/gen/src/nested/c.ts' })).toBe('./nested/c')
  })

  it('walks up with ../ for parent-directory targets', () => {
    expect(makeModuleSpec('/gen/src/sub/a.ts', { output: '/gen/src/b.ts' })).toBe('../b')
  })

  it('returns `.` when the target collapses to the current directory', () => {
    expect(makeModuleSpec('/gen/src/a.ts', { output: '/gen/src/index.ts' })).toBe('.')
  })

  // The aggregate `components.output` path resolution: a module at
  // `src/modules/<r>/index.ts` (depth-matched by the `_` dummy segment elysia uses)
  // importing from the single components file.
  it('resolves a module to a flat aggregated components file', () => {
    expect(
      makeModuleSpec('/gen/src/modules/_/index.ts', { output: '/gen/src/components.ts' }),
    ).toBe('../../components')
  })

  it('resolves a module to a nested aggregated components file', () => {
    expect(
      makeModuleSpec('/gen/src/modules/_/index.ts', { output: '/gen/src/lib/components.ts' }),
    ).toBe('../../lib/components')
  })
})

describe('makeImports — Elysia primitives', () => {
  it('imports {t} when `t.<Capital>` appears', () => {
    const result = makeImports('const X = t.String()', '/gen/x.ts', undefined)
    expect(result).toBe(`import {t} from 'elysia'\n\nconst X = t.String()`)
  })

  it('does not import `t` when only lowercase `t.` appears (e.g. `t.id`)', () => {
    const code = 'const ref = "t.id"'
    expect(makeImports(code, '/gen/x.ts', undefined)).toBe(code)
  })

  it('imports Static and t together', () => {
    const code = 'type Foo = Static<typeof X>\nconst X = t.String()'
    expect(makeImports(code, '/gen/x.ts', undefined)).toBe(
      `import {t,type Static} from 'elysia'\n\n${code}`,
    )
  })

  it('imports UnwrapSchema as a type from elysia', () => {
    const code = 'type Foo = UnwrapSchema<typeof X>'
    expect(makeImports(code, '/gen/x.ts', undefined)).toBe(
      `import {type UnwrapSchema} from 'elysia'\nimport {UnwrapSchema} from './schemas'\n\n${code}`,
    )
  })

  it('excludes locally-exported `Static` from the import', () => {
    const code = 'export type Static = unknown\ntype Foo = Static<typeof X>'
    expect(makeImports(code, '/gen/x.ts', undefined)).toBe(code)
  })

  it('imports {Value} when `Value.Check` appears', () => {
    const code = 'const ok = Value.Check(S, v)'
    expect(makeImports(code, '/gen/x.ts', undefined)).toBe(
      `import {Value} from '@sinclair/typebox/value'\n\n${code}`,
    )
  })
})

describe('makeImports — components classification (longest-suffix)', () => {
  it('classifies XSchema as schemas', () => {
    const result = makeImports('const X = UserSchema', '/gen/a.ts', undefined)
    expect(result).toBe(`import {UserSchema} from './schemas'\n\nconst X = UserSchema`)
  })

  it('classifies XParamsSchema as parameters (longer suffix wins over Schema)', () => {
    const code = 'const X = ListItemsParamsSchema'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(
      `import {ListItemsParamsSchema} from './parameters'\n\n${code}`,
    )
  })

  it('classifies XHeaderSchema as headers (longer suffix wins)', () => {
    const code = 'const X = AuthHeaderSchema'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(
      `import {AuthHeaderSchema} from './headers'\n\n${code}`,
    )
  })

  it('classifies XResponseSchema as responses', () => {
    const code = 'const X = NotFoundResponseSchema'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(
      `import {NotFoundResponseSchema} from './responses'\n\n${code}`,
    )
  })

  it('classifies XMediaTypeSchema as mediaTypes', () => {
    const code = 'const X = JsonMediaTypeSchema'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(
      `import {JsonMediaTypeSchema} from './mediaTypes'\n\n${code}`,
    )
  })

  it('classifies XRequestBodySchema as requestBodies', () => {
    const code = 'const X = CreateUserRequestBodySchema'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(
      `import {CreateUserRequestBodySchema} from './requestBodies'\n\n${code}`,
    )
  })

  it('groups names by kind with one import line each, sorted alphabetically', () => {
    const code = 'const X = [UserSchema, PostSchema, AdminSchema]'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(
      `import {AdminSchema,PostSchema,UserSchema} from './schemas'\n\n${code}`,
    )
  })
})

describe('makeImports — excludeKinds + local exports', () => {
  it('skips identifiers exported locally in the same file', () => {
    const code = 'export const UserSchema = t.Object({})\nconst X = UserSchema'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(`import {t} from 'elysia'\n\n${code}`)
  })

  it('skips identifiers from explicitly excluded kinds', () => {
    const code = 'const X = UserSchema'
    expect(makeImports(code, '/gen/a.ts', undefined, false, new Set(['schemas']))).toBe(code)
  })
})

describe('makeImports — path resolution', () => {
  it('uses components[kind].import alias verbatim when provided', () => {
    const code = 'const X = UserSchema'
    const components = { schemas: { output: '/ignored.ts', import: '@my/lib' } }
    expect(makeImports(code, '/gen/a.ts', components)).toBe(
      `import {UserSchema} from '@my/lib'\n\n${code}`,
    )
  })

  it('resolves a relative module spec from components[kind].output', () => {
    const code = 'const X = UserSchema'
    const components = { schemas: { output: '/gen/components/schemas.ts' } }
    expect(makeImports(code, '/gen/routes/a.ts', components)).toBe(
      `import {UserSchema} from '../components/schemas'\n\n${code}`,
    )
  })

  it('falls back to `..` prefix in split mode', () => {
    const code = 'const X = UserSchema'
    expect(makeImports(code, '/gen/op/a.ts', undefined, true)).toBe(
      `import {UserSchema} from '../schemas'\n\n${code}`,
    )
  })
})

describe('makeImports — comment / string skipping', () => {
  it('ignores identifiers inside line comments', () => {
    const code = '// UserSchema is not actually referenced\nconst Y = 1'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(code)
  })

  it('ignores identifiers inside block comments', () => {
    const code = '/* UserSchema */\nconst Y = 1'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(code)
  })

  it('ignores identifiers inside double-quoted strings', () => {
    const code = 'const Y = "UserSchema"'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(code)
  })

  it('ignores identifiers inside template literals', () => {
    const code = 'const Y = `UserSchema`'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(code)
  })
})

describe('makeImports — no-op cases', () => {
  it('returns the input unchanged when no imports are needed', () => {
    const code = 'const X = 1'
    expect(makeImports(code, '/gen/a.ts', undefined)).toBe(code)
  })
})

describe('makeBarrel', () => {
  it('emits sorted export lines with lowercased first char', () => {
    expect(makeBarrel({ Pet: {}, Order: {}, User: {} })).toBe(
      "export * from './order'\nexport * from './pet'\nexport * from './user'\n",
    )
  })

  it('returns trailing newline only for empty input', () => {
    expect(makeBarrel({})).toBe('\n')
  })

  it('preserves already-lowercased keys', () => {
    expect(makeBarrel({ pet: {}, order: {} })).toBe(
      "export * from './order'\nexport * from './pet'\n",
    )
  })
})
