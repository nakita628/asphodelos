// Non-Latin identifiers are the input under test, not English.
// cspell:ignore Схема Русский
import { describe, expect, it } from 'bun:test'

import {
  capitalize,
  filterDefined,
  pascalCase,
  resourcePrefix,
  safeStatusKey,
  toSafeIdentifier,
  uncapitalize,
} from './index.js'

describe('capitalize', () => {
  it('uppercases the first character', () => {
    expect(capitalize('todo')).toBe('Todo')
  })

  it('leaves rest of string untouched', () => {
    expect(capitalize('petStore')).toBe('PetStore')
  })

  it('returns empty string unchanged', () => {
    expect(capitalize('')).toBe('')
  })

  it('handles single-char input', () => {
    expect(capitalize('a')).toBe('A')
  })
})

describe('uncapitalize', () => {
  it('lowercases the first character', () => {
    expect(uncapitalize('Todo')).toBe('todo')
  })

  it('leaves rest of string untouched', () => {
    expect(uncapitalize('PetStore')).toBe('petStore')
  })

  it('returns empty string unchanged', () => {
    expect(uncapitalize('')).toBe('')
  })

  it('handles single-char input', () => {
    expect(uncapitalize('A')).toBe('a')
  })
})

describe('pascalCase', () => {
  it('preserves PascalCase as-is', () => {
    expect(pascalCase('Pet')).toBe('Pet')
    expect(pascalCase('UserName')).toBe('UserName')
  })

  it('capitalizes lowercase single word', () => {
    expect(pascalCase('pet')).toBe('Pet')
  })

  it('joins snake_case', () => {
    expect(pascalCase('petstore_auth')).toBe('PetstoreAuth')
    expect(pascalCase('api_key')).toBe('ApiKey')
  })

  it('joins kebab-case', () => {
    expect(pascalCase('user-name')).toBe('UserName')
  })

  it('passes camelCase through with first-letter capitalization', () => {
    expect(pascalCase('bearerAuth')).toBe('BearerAuth')
  })

  it('rescues a leading digit with an underscore', () => {
    expect(pascalCase('2FAConfig')).toBe('_2FAConfig')
  })

  it('encodes non-ascii characters injectively by code point', () => {
    expect(pascalCase('日本語スキーマ')).toBe('U65e5u672cu8a9eu30b9u30adu30fcu30de')
  })

  it('distinguishes distinct non-ascii names', () => {
    expect(pascalCase('Схема_Русский')).toBe('U421u445u435u43cu430U420u443u441u441u43au438u439')
  })

  it('falls back to Schema when no identifier characters remain', () => {
    expect(pascalCase('')).toBe('Schema')
  })
})

describe('filterDefined', () => {
  it('drops null and undefined', () => {
    expect(filterDefined(['a', null, 'b', undefined, 'c'])).toStrictEqual(['a', 'b', 'c'])
  })

  it('preserves falsy non-nullish values', () => {
    expect(filterDefined([0, '', false, null, undefined])).toStrictEqual([0, '', false])
  })

  it('returns empty for all-nullish input', () => {
    expect(filterDefined([null, undefined])).toStrictEqual([])
  })

  it('returns empty for empty input', () => {
    expect(filterDefined<string>([])).toStrictEqual([])
  })
})

describe('toSafeIdentifier', () => {
  it('passes a valid non-reserved name through unchanged', () => {
    expect(toSafeIdentifier('pet')).toBe('pet')
    expect(toSafeIdentifier('findPetsByStatus')).toBe('findPetsByStatus')
  })

  it('suffixes a reserved word so it is a valid const binding', () => {
    expect(toSafeIdentifier('class')).toBe('classModule')
    expect(toSafeIdentifier('function')).toBe('functionModule')
    expect(toSafeIdentifier('return')).toBe('returnModule')
    expect(toSafeIdentifier('import')).toBe('importModule')
  })

  it('leaves contextual keywords that are valid identifiers untouched', () => {
    expect(toSafeIdentifier('type')).toBe('type')
  })

  it('normalizes non-identifier characters and leading digits', () => {
    expect(toSafeIdentifier('user-name')).toBe('userName')
    expect(toSafeIdentifier('123value')).toBe('_123value')
  })
})

describe('safeStatusKey', () => {
  it('keeps pure-integer status codes unquoted', () => {
    expect(safeStatusKey('200')).toBe('200')
    expect(safeStatusKey('404')).toBe('404')
  })

  it('quotes status ranges so they are not parsed as numeric literals', () => {
    expect(safeStatusKey('2XX')).toBe('"2XX"')
  })

  it('quotes the default status key', () => {
    expect(safeStatusKey('default')).toBe('"default"')
  })
})

describe('resourcePrefix', () => {
  it('returns the first path segment', () => {
    expect(resourcePrefix('/posts/{id}')).toBe('posts')
  })

  it('handles a leading slash and single segment', () => {
    expect(resourcePrefix('/posts')).toBe('posts')
  })

  it('handles a path without a leading slash', () => {
    expect(resourcePrefix('posts/{id}')).toBe('posts')
  })

  it('falls back to empty string for the root path', () => {
    expect(resourcePrefix('/')).toBe('')
  })
})
