import { describe, expect, it } from 'bun:test'

import { appFile } from './index.js'

describe('appFile (standalone mode, default)', () => {
  it('exports the app and guards .listen(3000) with import.meta.main', () => {
    const out = appFile(['users', 'orders'])
    expect(out).toBe(
      "import {Elysia} from 'elysia'\n" +
        "import {users} from './modules/users'\n" +
        "import {orders} from './modules/orders'\n" +
        '\n' +
        'export const app=new Elysia().use(users).use(orders)\n' +
        '\n' +
        'if (import.meta.main) {\n' +
        '  app.listen(3000)\n' +
        '  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)\n' +
        '}\n',
    )
  })

  it('honors prefix as Elysia constructor `prefix`', () => {
    const out = appFile(['pet'], { prefix: '/api/v3' })
    expect(out.includes('new Elysia({prefix:"/api/v3"})')).toBe(true)
    expect(out.includes('app.listen(3000)')).toBe(true)
  })

  it('aliases a resource named "app" to "appModule" to avoid the const-name clash', () => {
    const out = appFile(['app', 'todos'])
    expect(out.includes("import {app as appModule} from './modules/app'")).toBe(true)
    expect(out.includes("import {todos} from './modules/todos'")).toBe(true)
    expect(out.includes('.use(appModule).use(todos)')).toBe(true)
  })

  it('emits no .use() calls when the resource list is empty', () => {
    const out = appFile([])
    expect(out.includes('.use(')).toBe(false)
    expect(out.includes('app.listen(3000)')).toBe(true)
  })

  it('imports and uses a reserved-word resource via its mangled binding', () => {
    const out = appFile(['class', 'pet'], { integration: true })
    expect(out).toBe(
      "import {Elysia} from 'elysia'\n" +
        "import {classModule} from './modules/class'\n" +
        "import {pet} from './modules/pet'\n" +
        '\n' +
        'export const app=new Elysia().use(classModule).use(pet)\n',
    )
  })
})

describe('appFile (integration mode)', () => {
  it('exports `const app` and drops the listen block', () => {
    const out = appFile(['todos'], { integration: true })
    expect(out).toBe(
      "import {Elysia} from 'elysia'\n" +
        "import {todos} from './modules/todos'\n" +
        '\n' +
        'export const app=new Elysia().use(todos)\n',
    )
  })

  it('integration + prefix: prefix preserved, no listen block', () => {
    const out = appFile(['pet'], { prefix: '/api', integration: true })
    expect(out.includes('export const app=new Elysia({prefix:"/api"})')).toBe(true)
    expect(out.includes('.listen(')).toBe(false)
    expect(out.includes('import.meta.main')).toBe(false)
  })
})

describe('appFile (port argument)', () => {
  it('uses the supplied port verbatim in app.listen(<port>)', () => {
    expect(appFile(['x'], { port: '8080' })).toBe(
      "import {Elysia} from 'elysia'\n" +
        "import {x} from './modules/x'\n" +
        '\n' +
        'export const app=new Elysia().use(x)\n' +
        '\n' +
        'if (import.meta.main) {\n' +
        '  app.listen(8080)\n' +
        '  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)\n' +
        '}\n',
    )
  })

  it('defaults to port 3000 when omitted', () => {
    expect(appFile(['x'])).toBe(
      "import {Elysia} from 'elysia'\n" +
        "import {x} from './modules/x'\n" +
        '\n' +
        'export const app=new Elysia().use(x)\n' +
        '\n' +
        'if (import.meta.main) {\n' +
        '  app.listen(3000)\n' +
        '  console.log(`🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`)\n' +
        '}\n',
    )
  })

  it('ignores port in integration mode (no listen block at all)', () => {
    expect(appFile(['x'], { integration: true, port: '8080' })).toBe(
      "import {Elysia} from 'elysia'\n" +
        "import {x} from './modules/x'\n" +
        '\n' +
        'export const app=new Elysia().use(x)\n',
    )
  })
})

describe('appFile (merge contract — stable statement keys)', () => {
  it('emits exactly one top-level `if (import.meta.main)` block for stable merge keying', () => {
    const matches = appFile(['users']).match(/^if \(import\.meta\.main\)/gm) ?? []
    expect(matches.length).toBe(1)
  })

  it('integration mode emits no listen block', () => {
    expect(appFile(['users'], { integration: true }).includes('import.meta.main')).toBe(false)
  })
})
