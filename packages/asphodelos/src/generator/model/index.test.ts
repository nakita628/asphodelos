import { describe, expect, it } from 'bun:test'

import { modelFile } from './index.js'

describe('modelFile', () => {
  it('emits an empty Model object when there are no inline schemas', () => {
    const out = modelFile('items', [])
    expect(out).toBe(
      '\n' +
        'export const ItemsModel={} as const\n' +
        '\n' +
        'export type ItemsModel=typeof ItemsModel\n',
    )
  })

  it('inlines per-op schemas inside the Model literal under their original keys', () => {
    const out = modelFile('items', [
      {
        name: 'listItemsQuery',
        schema: { type: 'object', properties: { page: { type: 'integer' } } },
      },
      { name: 'listItemsResponse200', schema: { type: 'string' } },
    ])
    expect(out.includes('export const ItemsModel={listItemsQuery:t.Object(')).toBe(true)
    expect(out.includes('listItemsResponse200:t.String()')).toBe(true)
    expect(out.includes('} as const')).toBe(true)
  })

  it('imports referenced component schemas and emits them as bare identifiers', () => {
    const out = modelFile(
      'pet',
      [
        {
          name: 'response200',
          schema: { type: 'array', items: { $ref: '#/components/schemas/Pet' } },
        },
      ],
      new Set(['Pet']),
    )
    expect(out.includes("import {PetSchema} from '../../components'")).toBe(true)
    expect(out.includes('t.Array(PetSchema)')).toBe(true)
  })

  it('honors a custom schemasImportPath (e.g. tsconfig path alias)', () => {
    const out = modelFile(
      'pet',
      [{ name: 'response200', schema: { $ref: '#/components/schemas/Pet' } }],
      new Set(['Pet']),
      '@/lib/schemas',
    )
    expect(out.includes("import {PetSchema} from '@/lib/schemas'")).toBe(true)
  })

  it('skips the import when no inline schema references components', () => {
    const out = modelFile(
      'items',
      [{ name: 'listItemsQuery', schema: { type: 'string' } }],
      new Set(['Pet']),
    )
    expect(out.includes('from')).toBe(true) // elysia import
    expect(out.includes('PetSchema')).toBe(false)
  })

  it('imports each referenced schema only once, alphabetically sorted', () => {
    const out = modelFile(
      'pet',
      [
        { name: 'a', schema: { $ref: '#/components/schemas/Order' } },
        { name: 'b', schema: { $ref: '#/components/schemas/Pet' } },
        { name: 'c', schema: { $ref: '#/components/schemas/Order' } }, // duplicate
      ],
      new Set(['Pet', 'Order']),
    )
    expect(out.includes("import {OrderSchema,PetSchema} from '../../components'")).toBe(true)
  })

  it('capitalizes the tag for the Model class name', () => {
    const out = modelFile('healthz', [])
    expect(out.includes('export const HealthzModel=')).toBe(true)
    expect(out.includes('export type HealthzModel=')).toBe(true)
  })

  it('prefixes a leading-digit tag so the Model identifier is valid', () => {
    expect(modelFile('1', [])).toBe(
      '\nexport const _1Model={} as const\n\nexport type _1Model=typeof _1Model\n',
    )
  })
})
