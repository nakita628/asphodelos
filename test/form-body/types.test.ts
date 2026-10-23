// The TypeScript side of the same matrix: the static type the generated model gives each field of
// a form body, which is what a handler written against the generated controller sees. A field
// read from text keeps the type it is read into.
import { describe, expect, it } from 'bun:test'

import { assertType } from '../types/assert.js'
import type { Equal } from '../types/assert.js'
import type { MultipartModel } from './__generated__/modules/multipart/model.js'
import type { UrlencodedModel } from './__generated__/modules/urlencoded/model.js'

type Urlencoded = UrlencodedModel['urlencodedBody']
// A `t.Form` is typed as a `FormData` carrying its fields under Elysia's own symbol; the fields
// are what the handler reads.
type Multipart = MultipartModel['multipartBody'] extends FormData & (infer Carried)
  ? Carried[keyof Carried]
  : never

describe('form body types', () => {
  it('types every field as the value it is read into', () => {
    assertType<Equal<Urlencoded['name'], string | undefined>>(true)
    assertType<Equal<Urlencoded['age'], number | undefined>>(true)
    assertType<Equal<Urlencoded['ratio'], number | undefined>>(true)
    assertType<Equal<Urlencoded['active'], boolean | undefined>>(true)
    assertType<Equal<Urlencoded['level'], 1 | 2 | undefined>>(true)
    assertType<Equal<Urlencoded['agreed'], true | undefined>>(true)
    assertType<Equal<Urlencoded['limit'], number | undefined>>(true)
    assertType<Equal<Urlencoded['count'], number | undefined>>(true)
    assertType<Equal<Urlencoded['flag'], boolean | undefined>>(true)
    assertType<Equal<Urlencoded['tags'], string[] | undefined>>(true)
    assertType<Equal<Urlencoded['ids'], number[] | undefined>>(true)
    assertType<Equal<Urlencoded['flags'], boolean[] | undefined>>(true)
    assertType<Equal<Urlencoded['moment'], Date | undefined>>(true)
    assertType<Equal<Urlencoded['maybe'], number | null | undefined>>(true)
    assertType<Equal<Urlencoded['either'], number | string | undefined>>(true)
    expect(true).toBe(true)
  })

  it('types a file as a File and a file array as File[]', () => {
    assertType<Equal<Multipart['file'], File>>(true)
    assertType<Equal<Multipart['files'], File[] | undefined>>(true)
    assertType<Equal<Multipart['age'], number | undefined>>(true)
    assertType<Equal<Multipart['active'], boolean | undefined>>(true)
    assertType<Equal<Multipart['ids'], number[] | undefined>>(true)
    expect(true).toBe(true)
  })
})
