import { describe, expect, it, spyOn } from 'bun:test'

import type { Operation } from '../openapi/index.js'
import {
  canonicalParamNames,
  elysiaPath,
  isElysiaRoutePath,
  isTreatyPath,
  normalizePath,
  renameOperationParams,
} from './path-params.js'

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

describe('isElysiaRoutePath', () => {
  it('accepts a path key with no query string after a path parameter', () => {
    expect(isElysiaRoutePath('/jobs/{id}')).toBe(true)
    expect(isElysiaRoutePath('/jobs/{id}/cancel?beta=true')).toBe(true)
  })

  it('refuses a query string after a path parameter, warning once per key', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(isElysiaRoutePath('/tasks/{task_id}?beta=true')).toBe(false)
      expect(isElysiaRoutePath('/tasks/{task_id}?beta=true')).toBe(false)
      expect(warn.mock.calls).toStrictEqual([
        [
          "[asphodelos] path '/tasks/{task_id}?beta=true' has a query string after a path parameter, which Elysia reads as an optional parameter; it is left out of the app, its types, the mock, the Eden wrappers and the hooks",
        ],
      ])
    } finally {
      warn.mockRestore()
    }
  })

  // Elysia reads `:Sid.json` as the parameter `Sid.json`, so the params model rejects every request.
  it('refuses static text after a path parameter in its segment, warning once per key', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(isElysiaRoutePath('/Accounts/{Sid}.json')).toBe(false)
      expect(isElysiaRoutePath('/Accounts/{Sid}.json')).toBe(false)
      expect(isElysiaRoutePath('/files/{name}{ext}')).toBe(false)
      expect(warn.mock.calls).toStrictEqual([
        [
          "[asphodelos] path '/Accounts/{Sid}.json' has static text after a path parameter in its segment, which Elysia reads as part of the parameter name; it is left out of the app, its types, the mock, the Eden wrappers and the hooks",
        ],
        [
          "[asphodelos] path '/files/{name}{ext}' has static text after a path parameter in its segment, which Elysia reads as part of the parameter name; it is left out of the app, its types, the mock, the Eden wrappers and the hooks",
        ],
      ])
    } finally {
      warn.mockRestore()
    }
  })

  // The app routes a parameter after static text, `/v:version`, as the document means it.
  it('accepts static text before a path parameter in its segment', () => {
    expect(isElysiaRoutePath('/v{version}/items')).toBe(true)
    expect(isElysiaRoutePath('/Accounts/{AccountSid}/Calls.json')).toBe(true)
  })
})

// The spelling the controller registers a route by and the Eden chain is read off: Elysia reads a
// parameter from its `:` to the end of the segment, so static text after it stays in its name.
describe('elysiaPath', () => {
  it('writes each path parameter as a colon parameter', () => {
    expect(elysiaPath('/users/{userId}/posts/{postId}')).toBe('/users/:userId/posts/:postId')
  })

  it('leaves the static text beside a parameter where it is', () => {
    expect(elysiaPath('/Accounts/{Sid}.json')).toBe('/Accounts/:Sid.json')
    expect(elysiaPath('/v{version}/items')).toBe('/v:version/items')
    expect(elysiaPath('/widget.json')).toBe('/widget.json')
  })
})

// Treaty calls a segment as a parameter only when it starts with `:`, so `/v:version` is a property.
describe('isTreatyPath', () => {
  it('accepts a path key whose parameters fill whole segments', () => {
    expect(isTreatyPath('/users/{id}/posts')).toBe(true)
    expect(isTreatyPath('/widget.json')).toBe(true)
  })

  it('refuses static text before a path parameter in its segment, warning once per key', () => {
    const warn = spyOn(console, 'warn').mockImplementation(() => {})
    try {
      expect(isTreatyPath('/v{version}/items')).toBe(false)
      expect(isTreatyPath('/v{version}/items')).toBe(false)
      expect(warn.mock.calls).toStrictEqual([
        [
          "[asphodelos] path '/v{version}/items' has static text before a path parameter in its segment, which Eden treaty cannot fill; it is left out of the Eden wrappers and the hooks",
        ],
      ])
    } finally {
      warn.mockRestore()
    }
  })
})
