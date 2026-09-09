import { describe, expect, it } from 'bun:test'

import { Effect } from 'effect'

import { parseConfig } from '../config/index.js'
import type { OpenAPI } from '../openapi/index.js'
import { makeJob } from './index.js'

describe('makeJob', () => {
  it('emits only the elysia job for a minimal config and component-less spec', () => {
    const parsed = Effect.runSync(parseConfig({ input: 'api.yaml' }))
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
    } as OpenAPI
    const jobs = makeJob(openAPI, parsed).map(({ name, output, split }) => ({
      name,
      output,
      split,
    }))
    expect(jobs).toStrictEqual([{ name: 'elysia', output: 'src/index.ts', split: false }])
  })

  it('assembles component, eden, types and hook jobs in canonical order with default outputs', () => {
    const parsed = Effect.runSync(
      parseConfig({
        input: 'api.yaml',
        output: 'src/index.ts',
        eden: { output: 'src/eden.ts', import: './lib' },
        types: { output: 'src/types.ts' },
        swr: { output: 'src/swr.ts', import: './lib' },
        'preact-query': { output: 'src/preact.ts', import: './lib' },
      }),
    )
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
      components: {
        schemas: { Foo: { type: 'object' } },
        responses: { Bar: { description: 'ok' } },
      },
    } as OpenAPI
    const jobs = makeJob(openAPI, parsed).map(({ name, output, split }) => ({
      name,
      output,
      split,
    }))
    expect(jobs).toStrictEqual([
      { name: 'elysia', output: 'src/index.ts', split: false },
      { name: 'schemas', output: 'src/components/schemas.ts', split: false },
      { name: 'responses', output: 'src/components/responses.ts', split: false },
      { name: 'eden', output: 'src/eden.ts', split: false },
      { name: 'types', output: 'src/types.ts', split: false },
      { name: 'swr', output: 'src/swr.ts', split: false },
      { name: 'preact-query', output: 'src/preact.ts', split: false },
    ])
  })

  it('wires the test job, carrying split from config (default false)', () => {
    const single = Effect.runSync(
      parseConfig({ input: 'api.yaml', test: { output: 'src/app.test.ts' } }),
    )
    const split = Effect.runSync(parseConfig({ input: 'api.yaml', test: { split: true } }))
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
    } as OpenAPI
    const singleJob = makeJob(openAPI, single).find((job) => job.name === 'test')
    const splitJob = makeJob(openAPI, split).find((job) => job.name === 'test')
    expect(singleJob?.split).toBe(false)
    expect(singleJob?.output).toBe('src/app.test.ts')
    expect(splitJob?.split).toBe(true)
    expect(splitJob?.output).toBe('src/modules')
  })

  it('wires the mock job when config.mock is set (single file, never split)', () => {
    const parsed = Effect.runSync(
      parseConfig({ input: 'api.yaml', mock: { output: 'src/mock.ts' } }),
    )
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
    } as OpenAPI
    const mockJob = makeJob(openAPI, parsed).find((job) => job.name === 'mock')
    expect(mockJob).toBeDefined()
    expect(mockJob?.split).toBe(false)
    expect(mockJob?.output).toBe('src/mock.ts')
  })

  it('omits the mock job when config.mock is absent', () => {
    const parsed = Effect.runSync(parseConfig({ input: 'api.yaml' }))
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
    } as OpenAPI
    expect(makeJob(openAPI, parsed).find((job) => job.name === 'mock')).toBeUndefined()
  })

  it('includes a preact-query job (shared with cli + vite-plugin)', () => {
    const parsed = Effect.runSync(
      parseConfig({
        input: 'api.yaml',
        'preact-query': { output: 'src/preact', import: './lib', split: true },
      }),
    )
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
    } as OpenAPI
    const preact = makeJob(openAPI, parsed).find((job) => job.name === 'preact-query')
    expect(preact).toBeDefined()
    expect(preact?.split).toBe(true)
    expect(preact?.output).toBe('src/preact')
  })

  it('emits a single aggregate components job (and no per-type jobs) when components.output is set', () => {
    const parsed = Effect.runSync(
      parseConfig({
        input: 'api.yaml',
        output: 'src/index.ts',
        components: { output: 'src/components.ts' },
      }),
    )
    const openAPI = {
      openapi: '3.1.0',
      info: { title: 'T', version: '0' },
      paths: {},
      components: {
        schemas: { Foo: { type: 'object' } },
        responses: { Bar: { description: 'ok' } },
      },
    } as OpenAPI
    const jobs = makeJob(openAPI, parsed).map(({ name, output, split }) => ({
      name,
      output,
      split,
    }))
    expect(jobs).toStrictEqual([
      { name: 'elysia', output: 'src/index.ts', split: false },
      { name: 'components', output: 'src/components.ts', split: false },
    ])
  })
})
