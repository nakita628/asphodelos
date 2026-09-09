import { describe, expect, it } from 'bun:test'

import { mergeSource } from './index.js'

describe('mergeSource — service.ts patterns', () => {
  it('keeps existing class entirely when generated has empty class of same name', () => {
    expect(
      mergeSource(
        `export abstract class Pet { static addPet() { return null } }\n`,
        `export abstract class Pet {}\n`,
      ),
    ).toBe(`\n\nexport abstract class Pet { static addPet() { return null } }\n`)
  })

  it('preserves multi-method existing class', () => {
    expect(
      mergeSource(
        `export abstract class P { static a() {} static b() {} }\n`,
        `export abstract class P {}\n`,
      ),
    ).toBe(`\n\nexport abstract class P { static a() {} static b() {} }\n`)
  })
})

describe('mergeSource — imports', () => {
  it('unions imports across both files', () => {
    expect(
      mergeSource(`import { a } from "x"\nconst z = 1\n`, `import { b } from "y"\nconst z = 2\n`),
    ).toBe(`import { b } from "y"\nimport { a } from "x"\n\nconst z = 1\n`)
  })

  it('existing import wins for the same module specifier', () => {
    expect(
      mergeSource(
        `import { a, b } from "shared"\nconst z = 1\n`,
        `import { c } from "shared"\nconst z = 2\n`,
      ),
    ).toBe(`import { a, b } from "shared"\n\nconst z = 1\n`)
  })

  it('drops a stale existing named import when generated imports the same name from a different spec', () => {
    expect(
      mergeSource(
        `import { Pet } from "../components"\nconst z = 1\n`,
        `import { Pet } from "../components/schemas"\nconst z = 2\n`,
      ),
    ).toBe(`import { Pet } from "../components/schemas"\n\nconst z = 1\n`)
  })

  it('keeps unrelated bindings on a partially-pruned existing import', () => {
    expect(
      mergeSource(
        `import { Pet, helper } from "../components"\nconst z = 1\n`,
        `import { Pet } from "../components/schemas"\nconst z = 2\n`,
      ),
    ).toBe(
      `import { Pet } from "../components/schemas"\nimport {helper} from '../components'\n\nconst z = 1\n`,
    )
  })
})

describe('mergeSource — describe / test patterns', () => {
  it('preserves user-added top-level describe alongside auto-gen one', () => {
    expect(
      mergeSource(
        `describe("API", () => {})\ndescribe("USER", () => { it("x", () => {}) })\n`,
        `describe("API", () => {})\n`,
      ),
    ).toBe(`\n\ndescribe("API", () => {})\n\ndescribe("USER", () => { it("x", () => {}) })\n`)
  })

  it('keeps user modifications inside an existing describe block', () => {
    expect(
      mergeSource(
        `describe("API", () => { it("/a", () => { /* USER */ }) })\n`,
        `describe("API", () => { it("/a", () => {}) })\n`,
      ),
    ).toBe(`\n\ndescribe("API", () => { it("/a", () => { /* USER */ }) })\n`)
  })

  it('adds new describe blocks introduced by generated', () => {
    expect(
      mergeSource(
        `describe("API", () => {})\n`,
        `describe("API", () => {})\ndescribe("NEW", () => {})\n`,
      ),
    ).toBe(`\n\ndescribe("API", () => {})\n\ndescribe("NEW", () => {})\n`)
  })

  it('preserves user mock helper while existing version of generated mock wins', () => {
    expect(
      mergeSource(
        `function userHelper() { return "x" }\nfunction mockShared() { return "EXISTING" }\n`,
        `function mockShared() { return "GENERATED" }\nfunction mockNew() { return "NEW" }\n`,
      ),
    ).toBe(
      `\n\nfunction mockShared() { return "EXISTING" }\n\nfunction mockNew() { return "NEW" }\n\nfunction userHelper() { return "x" }\n`,
    )
  })
})

describe('mergeSource — edge cases', () => {
  it('uses generated when existing is empty', () => {
    expect(mergeSource('', `export const x = 1\n`)).toBe(`\n\nexport const x = 1\n`)
  })

  it('keeps existing when generated is empty', () => {
    expect(mergeSource(`export const x = 1\n`, '')).toBe(`\n\nexport const x = 1\n`)
  })

  it('returns only the leading separator newlines when both inputs are empty', () => {
    // mergeSource always emits the 2-blank-line separator between the
    // import block and the body, even when neither side has content.
    // This documents the existing whitespace contract so a future cleanup
    // can't silently change it without updating callers.
    expect(mergeSource('', '')).toBe(`\n\n\n`)
  })

  it('orders entities by generated order then appends existing-only at the end', () => {
    expect(
      mergeSource(
        `export const a = "EX_A"\nexport const userExtra = "X"\n`,
        `export const c = "C"\nexport const a = "GEN_A"\nexport const b = "B"\n`,
      ),
    ).toBe(
      `\n\nexport const c = "C"\n\nexport const a = "EX_A"\n\nexport const b = "B"\n\nexport const userExtra = "X"\n`,
    )
  })

  it('merges function declarations by name (existing wins, new from spec appended in order)', () => {
    expect(
      mergeSource(
        `function helper() { return "EX" }\nfunction userOnly() { return "U" }\n`,
        `function helper() { return "GEN" }\nfunction newSpec() { return "N" }\n`,
      ),
    ).toBe(
      `\n\nfunction helper() { return "EX" }\n\nfunction newSpec() { return "N" }\n\nfunction userOnly() { return "U" }\n`,
    )
  })

  it('preserves user variable declaration when generated has same name', () => {
    expect(
      mergeSource(
        `export const Service = { foo: "EXISTING" }\n`,
        `export const Service = { foo: "GENERATED" }\n`,
      ),
    ).toBe(`\n\nexport const Service = { foo: "EXISTING" }\n`)
  })
})

describe('mergeSource — type aliases & interfaces', () => {
  // Type aliases used to fall through `statementKey` (returning null)
  // and end up duplicated on every regen. The `type:Name` keyer fixed it.
  it('dedupes `type X = ...` shared by both files (existing wins)', () => {
    expect(mergeSource(`type App = { v: 1 }\n`, `type App = { v: 2 }\n`)).toBe(
      `\n\ntype App = { v: 1 }\n`,
    )
  })

  it('dedupes `export type X = ...` shared by both files', () => {
    expect(mergeSource(`export type App = typeof app\n`, `export type App = typeof app\n`)).toBe(
      `\n\nexport type App = typeof app\n`,
    )
  })

  it('keeps a user-only type alias and adds a new generated one', () => {
    expect(
      mergeSource(
        `export type App = typeof app\nexport type Helper = string\n`,
        `export type App = typeof app\nexport type Generated = number\n`,
      ),
    ).toBe(
      `\n\nexport type App = typeof app\n\nexport type Generated = number\n\nexport type Helper = string\n`,
    )
  })

  it('dedupes `interface X { ... }` declared on both sides', () => {
    expect(
      mergeSource(`interface Config { port: number }\n`, `interface Config { port: string }\n`),
    ).toBe(`\n\ninterface Config { port: number }\n`)
  })

  it('treats type-alias and var of the same name as different statements', () => {
    // `type App` (type:App) and `const App` (var:App) are different keys —
    // both survive. Prevents a future "smart dedup" from clobbering a
    // value-binding that happens to share a name with a type alias.
    const out = mergeSource(`type App = { v: 1 }\nconst App = 'hello'\n`, `type App = { v: 1 }\n`)
    expect(out.includes(`type App = { v: 1 }`)).toBe(true)
    expect(out.includes(`const App = 'hello'`)).toBe(true)
  })
})

describe('mergeSource — variable kinds', () => {
  it('keys `let` declarations the same as `const` (existing wins)', () => {
    expect(mergeSource(`let counter = 5\n`, `let counter = 0\n`)).toBe(`\n\nlet counter = 5\n`)
  })

  it('keys `var` declarations the same as `const` (existing wins)', () => {
    expect(mergeSource(`var legacy = "user"\n`, `var legacy = "gen"\n`)).toBe(
      `\n\nvar legacy = "user"\n`,
    )
  })

  it('treats multi-declarator statements by their first declarator name', () => {
    // `const a = 1, b = 2` — only `a` is the keyed name. Both sides
    // declare `a` so existing wins, which carries `b` along too.
    expect(mergeSource(`const a = 1, b = 2\n`, `const a = 99, b = 99\n`)).toBe(
      `\n\nconst a = 1, b = 2\n`,
    )
  })
})

describe('mergeSource — import edge cases', () => {
  it('preserves a default import distinct from a named import on the same module', () => {
    // Default and named occupy different binding slots; the merger must
    // keep both when the existing file has a default and generated has
    // only the named (or vice versa).
    expect(
      mergeSource(
        `import elysia from 'elysia'\nconst x = 1\n`,
        `import { Elysia } from 'elysia'\nconst x = 2\n`,
      ),
    ).toBe(`import elysia from 'elysia'\n\nconst x = 1\n`)
  })

  it('keeps namespace imports (`import * as`)', () => {
    expect(
      mergeSource(
        `import * as E from 'elysia'\nconst x = 1\n`,
        `import { Elysia } from 'elysia'\nconst x = 2\n`,
      ),
    ).toBe(`import * as E from 'elysia'\n\nconst x = 1\n`)
  })

  it('keeps `import type { X }` distinct from a value import', () => {
    expect(mergeSource(`import type { App } from './types'\nconst x = 1\n`, `const x = 2\n`)).toBe(
      `import type { App } from './types'\n\nconst x = 1\n`,
    )
  })

  it('keeps a side-effect-only import alongside named imports', () => {
    expect(
      mergeSource(
        `import './side-effect'\nimport { a } from 'x'\nconst z = 1\n`,
        `import { b } from 'y'\nconst z = 2\n`,
      ).includes(`import './side-effect'`),
    ).toBe(true)
  })

  it('preserves user-added imports across ten-plus existing module imports', () => {
    // Stress-checks that a busy import block still has the user-only
    // entry resolved to the bottom (per mergeSource's import-union order)
    // rather than being dropped by some accidental dedup.
    const existing = `import { Elysia } from 'elysia'
import { customCors } from '@elysiajs/cors'
import { logger } from '@bogeychan/elysia-logger'
import { jwt } from '@elysiajs/jwt'
import { staticPlugin } from '@elysiajs/static'
import { swagger } from '@elysiajs/swagger'
import { auth } from './lib/auth'
import { db } from './lib/db'
import { config } from './lib/config'
import { items } from './modules/items'
import { users } from './modules/users'

const app = new Elysia()
  .use(swagger())
  .use(staticPlugin())
  .use(customCors())
  .use(logger())
  .use(jwt({ secret: 'x' }))
  .mount('/api/auth', auth.handler)
  .decorate('db', db)
  .use(items)
  .use(users)
  .listen(config.port)

export type App = typeof app
`
    const generated = `import { Elysia } from 'elysia'
import { items } from './modules/items'
import { users } from './modules/users'

const app = new Elysia().use(items).use(users).listen(3000)

export type App = typeof app
`
    const out = mergeSource(existing, generated)
    for (const userImport of [
      `import { customCors } from '@elysiajs/cors'`,
      `import { logger } from '@bogeychan/elysia-logger'`,
      `import { jwt } from '@elysiajs/jwt'`,
      `import { staticPlugin } from '@elysiajs/static'`,
      `import { swagger } from '@elysiajs/swagger'`,
      `import { auth } from './lib/auth'`,
      `import { db } from './lib/db'`,
      `import { config } from './lib/config'`,
    ]) {
      expect(out.includes(userImport)).toBe(true)
    }
    // app declaration: existing wins → `.listen(config.port)`, every
    // user `.use(...)` chain link survives.
    expect(out.includes(`.listen(config.port)`)).toBe(true)
    expect(out.includes(`.mount('/api/auth', auth.handler)`)).toBe(true)
    expect(out.includes(`.decorate('db', db)`)).toBe(true)
    expect(out.includes(`.listen(3000)`)).toBe(false)
  })
})

describe('mergeSource — async / class methods / arrow', () => {
  it('preserves async function bodies with same name (existing wins)', () => {
    expect(
      mergeSource(
        `async function load() { await db.connect(); return db }\n`,
        `async function load() { /* TODO */ }\n`,
      ),
    ).toBe(`\n\nasync function load() { await db.connect(); return db }\n`)
  })

  it('preserves arrow-function variable assignments', () => {
    expect(
      mergeSource(
        `const handler = async (ctx: Context) => ctx.json({ ok: true })\n`,
        `const handler = (ctx) => null\n`,
      ).includes(`async (ctx: Context) => ctx.json({ ok: true })`),
    ).toBe(true)
  })

  it('does not collapse class declaration into same-name function', () => {
    // `class Foo {}` and `function Foo() {}` have different statementKey
    // prefixes (`class:Foo` vs `fn:Foo`) so both survive — guarding
    // against a regression where a future statementKey change would
    // accidentally merge the two.
    const out = mergeSource(`class Foo {}\nfunction Foo() { return 1 }\n`, `class Foo {}\n`)
    expect(out.includes('class Foo')).toBe(true)
    expect(out.includes('function Foo')).toBe(true)
  })
})

describe('mergeSource — exhaustive idempotence', () => {
  // Running the merger on its own output should be a fixed point.
  // Any drift between run N and run N+1 means a regen would diverge
  // over time — the most insidious kind of bug because it'd show up
  // as "this file keeps growing" months down the line.
  it('is a fixed point when applied to its own output', () => {
    const existing = `import { Elysia } from 'elysia'
import { cors } from '@elysiajs/cors'
import { items } from './modules/items'

const app = new Elysia().use(cors()).use(items).listen(8080)

export type App = typeof app

export default app
`
    const generated = `import { Elysia } from 'elysia'
import { items } from './modules/items'

const app = new Elysia().use(items).listen(3000)

export type App = typeof app
`
    const once = mergeSource(existing, generated)
    const twice = mergeSource(once, generated)
    expect(twice).toBe(once)
  })

  it('is a fixed point on a complex realistic file', () => {
    const existing = `import { Elysia } from 'elysia'
import { swagger } from '@elysiajs/swagger'
import { jwt } from '@elysiajs/jwt'
import { auth } from './lib/auth'
import type { Config } from './lib/config'
import { items } from './modules/items'
import { users } from './modules/users'

interface AppConfig {
  port: number
  jwt: { secret: string }
}

const config: AppConfig = { port: 4000, jwt: { secret: process.env.SECRET ?? '' } }

const app = new Elysia()
  .use(swagger())
  .use(jwt(config.jwt))
  .mount('/auth', auth.handler)
  .use(items)
  .use(users)
  .listen(config.port)

export type App = typeof app

export default app
`
    const generated = `import { Elysia } from 'elysia'
import { items } from './modules/items'
import { users } from './modules/users'

const app = new Elysia().use(items).use(users).listen(3000)

export type App = typeof app
`
    const once = mergeSource(existing, generated)
    const twice = mergeSource(once, generated)
    const thrice = mergeSource(twice, generated)
    expect(twice).toBe(once)
    expect(thrice).toBe(once)
  })
})

describe('mergeSource — side-effect statement (expr:*) contract', () => {
  it('respects user deletion of a top-level console.log on regen', () => {
    const existing = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)
`
    const generated = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
`
    expect(mergeSource(existing, generated)).toBe(
      `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)
`,
    )
  })

  it('emits the generated console.log on initial emit (no existing statements)', () => {
    const generated = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log(\`hello\`)
`
    expect(mergeSource('', generated)).toBe(
      `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log(\`hello\`)
`,
    )
  })

  it('keeps a user-edited console.log message instead of generator default', () => {
    const existing = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log('hello from user')
`
    const generated = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log('generator default')
`
    expect(mergeSource(existing, generated)).toBe(
      `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log('hello from user')
`,
    )
  })

  it('restores a deleted named declaration (var:app) — contrast with expr:* drop', () => {
    const existing = `import { Elysia } from 'elysia'
`
    const generated = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)
`
    expect(mergeSource(existing, generated)).toBe(
      `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)
`,
    )
  })

  it('restores a deleted import — contrast with expr:* drop', () => {
    const existing = `const app = 1
`
    const generated = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)
`
    expect(mergeSource(existing, generated)).toBe(
      `import { Elysia } from 'elysia'

const app = 1
`,
    )
  })

  it('is idempotent: merge(merge(e, g), g) === merge(e, g)', () => {
    const existing = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)
`
    const generated = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log(\`startup\`)
`
    const once = mergeSource(existing, generated)
    const twice = mergeSource(once, generated)
    expect(twice).toBe(once)
  })
})

describe('mergeSource — expr:* edge cases', () => {
  it('keeps multiple top-level console.log statements with the same callee', () => {
    const existing = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log('a')
console.log('b')
`
    const generated = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log('c')
`
    expect(mergeSource(existing, generated)).toBe(
      `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log('a')

console.log('b')
`,
    )
  })

  it('preserves emoji and template-literal placeholders byte-for-byte through merge', () => {
    const generated = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
`
    expect(mergeSource('', generated)).toBe(
      `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log(\`🦊 Elysia is running at \${app.server?.hostname}:\${app.server?.port}\`)
`,
    )
  })

  it('emits generated expr:* when existing has only imports (no statement body)', () => {
    const existing = `import { Elysia } from 'elysia'
`
    const generated = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log(\`hello\`)
`
    expect(mergeSource(existing, generated)).toBe(
      `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log(\`hello\`)
`,
    )
  })

  it('keeps unkeyed (null-key) statements like top-level if blocks verbatim from existing', () => {
    const existing = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)
if (process.env.DEBUG) {
  console.log('debug')
}
`
    const generated = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)
`
    expect(mergeSource(existing, generated)).toBe(
      `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

if (process.env.DEBUG) {
  console.log('debug')
}
`,
    )
  })

  it('drops generator console.log AND keeps user-edited variant when both differ in args', () => {
    const existing = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log('hello from user')
`
    const generated = `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log('generator default')
`
    expect(mergeSource(existing, generated)).toBe(
      `import { Elysia } from 'elysia'

const app = new Elysia().listen(3000)

console.log('hello from user')
`,
    )
  })
})
