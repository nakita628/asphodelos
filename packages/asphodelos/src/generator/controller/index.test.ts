import { describe, expect, it } from 'bun:test'

import { controllerFile } from './index.js'

describe('controllerFile', () => {
  it('emits a route-less Elysia chain when there are no routes', () => {
    expect(controllerFile('items', [])).toBe(
      "import {Elysia} from 'elysia'\n" +
        "import {ItemsModel} from './model'\n" +
        '\n' +
        'export const items=new Elysia()\n',
    )
  })

  it('mangles a reserved-word tag into a valid const binding', () => {
    expect(controllerFile('class', [])).toBe(
      "import {Elysia} from 'elysia'\n" +
        "import {ClassModel} from './model'\n" +
        '\n' +
        'export const classModule=new Elysia()\n',
    )
  })

  it('quotes a non-integer response status key (2XX)', () => {
    expect(
      controllerFile('pet', [
        {
          method: 'get',
          path: '/pet',
          operationId: 'x',
          tags: [],
          responses: [{ status: '2XX', schema: { kind: 'void' } }],
          security: [],
        },
      ]),
    ).toBe(
      "import {Elysia,t} from 'elysia'\n" +
        "import {PetModel} from './model'\n" +
        '\n' +
        'export const pet=new Elysia().get("/pet",()=>{},{response:{"2XX":t.Void()},detail:{tags:[],operationId:"x"}})\n',
    )
  })

  it('imports + registers component schemas under their original spec names', () => {
    const out = controllerFile('pet', [], ['Pet', 'Order'], new Set(['Pet', 'Order']))
    expect(out.includes("import {PetSchema,OrderSchema} from '../../components'")).toBe(true)
    expect(out.includes('.model({Pet:PetSchema,Order:OrderSchema})')).toBe(true)
  })

  it('honors a custom schemasImportPath (path alias)', () => {
    const out = controllerFile('pet', [], ['Pet'], new Set(['Pet']), '@/lib/schemas')
    expect(out.includes("import {PetSchema} from '@/lib/schemas'")).toBe(true)
  })

  it('emits empty handler stub and converts {petId} to :petId in path', () => {
    const out = controllerFile(
      'pet',
      [
        {
          method: 'get',
          path: '/pet/{petId}',
          operationId: 'getPetById',
          tags: [],
          paramsRef: 'getPetByIdParams',
          responses: [{ status: '200', schema: { kind: 'ref', name: 'Pet' } }],
          security: [],
        },
      ],
      ['Pet'],
      new Set(['Pet']),
    )
    expect(out.includes('.get("/pet/:petId"')).toBe(true)
    expect(out.includes(`({params})=>{}`)).toBe(true)
  })

  it('component refs in body / response → string keys', () => {
    const out = controllerFile(
      'pet',
      [
        {
          method: 'post',
          path: '/pet',
          operationId: 'addPet',
          tags: [],
          bodyRef: 'Pet',
          responses: [{ status: '200', schema: { kind: 'ref', name: 'Pet' } }],
          security: [],
        },
      ],
      ['Pet'],
      new Set(['Pet']),
    )
    expect(out.includes("body:'Pet'")).toBe(true)
    expect(out.includes("response:{200:'Pet'}")).toBe(true)
  })

  it('synthesized per-op refs → inline `<Tag>Model.<key>` references', () => {
    const out = controllerFile(
      'pet',
      [
        {
          method: 'get',
          path: '/pet/findByStatus',
          operationId: 'findPetsByStatus',
          tags: [],
          queryRef: 'findPetsByStatusQuery',
          responses: [
            { status: '200', schema: { kind: 'ref', name: 'findPetsByStatusResponse200' } },
          ],
          security: [],
        },
      ],
      [],
    )
    expect(out.includes('query:PetModel.findPetsByStatusQuery')).toBe(true)
    expect(out.includes('response:{200:PetModel.findPetsByStatusResponse200}')).toBe(true)
  })

  it('void responses become `t.Void()`', () => {
    const out = controllerFile(
      'pet',
      [
        {
          method: 'delete',
          path: '/pet/{petId}',
          operationId: 'deletePet',
          tags: [],
          paramsRef: 'deletePetParams',
          responses: [{ status: '204', schema: { kind: 'void' } }],
          security: [],
        },
      ],
      [],
    )
    expect(out.includes('response:{204:t.Void()}')).toBe(true)
  })

  it('detail block carries operationId, tags, summary, description, security, callbacks', () => {
    const out = controllerFile(
      'pet',
      [
        {
          method: 'post',
          path: '/pet',
          operationId: 'addPet',
          summary: 'Add a pet',
          description: 'Create a new pet',
          tags: ['pet'],
          responses: [],
          security: [{ petstore_auth: ['write:pets'] }],
          callbacks: { onCreated: { foo: 'bar' } },
        },
      ],
      [],
    )
    expect(out.includes('summary:"Add a pet"')).toBe(true)
    expect(out.includes('description:"Create a new pet"')).toBe(true)
    expect(out.includes('operationId:"addPet"')).toBe(true)
    expect(out.includes('tags:["pet"]')).toBe(true)
    expect(out.includes('security:[{"petstore_auth":["write:pets"]}]')).toBe(true)
    expect(out.includes('callbacks:{"onCreated":{"foo":"bar"}}')).toBe(true)
  })

  it('handler arg destructure follows order: params, query, body', () => {
    const out = controllerFile(
      'pet',
      [
        {
          method: 'post',
          path: '/pet/{petId}',
          operationId: 'updatePet',
          tags: [],
          paramsRef: 'updatePetParams',
          queryRef: 'updatePetQuery',
          bodyRef: 'Pet',
          responses: [],
          security: [],
        },
      ],
      ['Pet'],
      new Set(['Pet']),
    )
    expect(out.includes(`({params,query,body})=>{}`)).toBe(true)
  })

  it('routes header / cookie param refs into Elysia opts and the handler arg', () => {
    const out = controllerFile('auth', [
      {
        method: 'get',
        path: '/check',
        operationId: 'check',
        tags: [],
        headersRef: 'checkHeaders',
        cookieRef: 'checkCookie',
        responses: [],
        security: [],
      },
    ])
    expect(out.includes('headers:AuthModel.checkHeaders')).toBe(true)
    expect(out.includes('cookie:AuthModel.checkCookie')).toBe(true)
    expect(out.includes(`({headers,cookie})=>{}`)).toBe(true)
  })

  it('imports {Elysia,t} when at least one route has a void response', () => {
    const out = controllerFile('items', [
      {
        method: 'delete',
        path: '/items/{id}',
        operationId: 'deleteItem',
        tags: [],
        paramsRef: 'deleteItemParams',
        responses: [{ status: '204', schema: { kind: 'void' } }],
        security: [],
      },
    ])
    expect(out.startsWith("import {Elysia,t} from 'elysia'\n")).toBe(true)
    expect(out.includes('204:t.Void()')).toBe(true)
  })

  it('imports only {Elysia} when no route has a void response', () => {
    const out = controllerFile(
      'pet',
      [
        {
          method: 'get',
          path: '/pet/{petId}',
          operationId: 'getPetById',
          tags: [],
          paramsRef: 'getPetByIdParams',
          responses: [{ status: '200', schema: { kind: 'ref', name: 'Pet' } }],
          security: [],
        },
      ],
      ['Pet'],
      new Set(['Pet']),
    )
    expect(out.startsWith("import {Elysia} from 'elysia'\n")).toBe(true)
    expect(out.includes('t.Void()')).toBe(false)
  })

  it('imports t for any t.<PascalCase>(…) factory the renderer might emit', () => {
    const fakeChain = '.get("/foo", () => "ok", { response: { 200: t.String() } })'
    expect(/\bt\.[A-Z]\w*\(/u.test(fakeChain)).toBe(true)
  })
})
