import { describe, expect, it } from 'bun:test'

import type { Operation } from '../openapi/index.js'
import { canonicalParamNames, normalizePath, renameOperationParams } from './path-params.js'

describe('canonicalParamNames', () => {
  it('returns no entries when every position spells its param consistently', () => {
    expect(canonicalParamNames(['/audiences/{id}', '/audiences/{id}/contacts/{email}']).size).toBe(
      0,
    )
  })

  it('picks the most specific (longest) spelling for a collided position', () => {
    const canon = canonicalParamNames(['/audiences/{id}', '/audiences/{audience_id}/contacts'])
    expect(canon.get('audiences/{}')).toBe('audience_id')
  })

  it('breaks length ties lexicographically', () => {
    const canon = canonicalParamNames(['/x/{bbb}', '/x/{aaa}/y'])
    expect(canon.get('x/{}')).toBe('aaa')
  })

  it('keys positions by their static prefix, not by depth', () => {
    const canon = canonicalParamNames(['/a/{id}/b/{email}', '/a/{user_id}/b/{contact_id}/c'])
    expect(Object.fromEntries(canon)).toStrictEqual({
      'a/{}': 'user_id',
      'a/{}/b/{}': 'contact_id',
    })
  })

  it('skips a position whose spelling carries a non-identifier char (URL suffix glue)', () => {
    expect(canonicalParamNames(['/Accounts/{Sid.json}', '/Accounts/{AccountSid}/Calls']).size).toBe(
      0,
    )
  })
})

describe('normalizePath', () => {
  it('rewrites a collided segment to its canonical name and reports the rename', () => {
    const canon = new Map([['audiences/{}', 'audience_id']])
    const result = normalizePath('/audiences/{id}', canon)
    expect(result.path).toBe('/audiences/{audience_id}')
    expect(Object.fromEntries(result.renames)).toStrictEqual({ id: 'audience_id' })
  })

  it('leaves a path untouched when its spelling is already canonical', () => {
    const canon = new Map([['audiences/{}', 'audience_id']])
    const result = normalizePath('/audiences/{audience_id}/contacts/{email}', canon)
    expect(result.path).toBe('/audiences/{audience_id}/contacts/{email}')
    expect(result.renames.size).toBe(0)
  })

  it('is a no-op when no canonical names apply', () => {
    const result = normalizePath('/users/{id}', new Map())
    expect(result.path).toBe('/users/{id}')
    expect(result.renames.size).toBe(0)
  })
})

describe('renameOperationParams', () => {
  it('renames a path parameter to its canonical name', () => {
    const operation: Operation = {
      parameters: [{ name: 'id', in: 'path', required: true }],
      responses: {},
    }
    const renamed = renameOperationParams(operation, new Map([['id', 'audience_id']]))
    expect(renamed.parameters).toStrictEqual([{ name: 'audience_id', in: 'path', required: true }])
  })

  it('leaves non-path parameters and unmatched names alone', () => {
    const operation: Operation = {
      parameters: [
        { name: 'id', in: 'query', required: false },
        { name: 'other', in: 'path', required: true },
      ],
      responses: {},
    }
    const renamed = renameOperationParams(operation, new Map([['id', 'audience_id']]))
    expect(renamed.parameters).toStrictEqual([
      { name: 'id', in: 'query', required: false },
      { name: 'other', in: 'path', required: true },
    ])
  })

  it('returns the operation unchanged when there are no renames', () => {
    const operation: Operation = {
      parameters: [{ name: 'id', in: 'path', required: true }],
      responses: {},
    }
    expect(renameOperationParams(operation, new Map())).toBe(operation)
  })
})
