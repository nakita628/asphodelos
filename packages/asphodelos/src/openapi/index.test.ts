import { afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import SwaggerParser from '@apidevtools/swagger-parser'

import { runGenerator, runGeneratorError } from '../testing/index.js'
import { parseOpenAPI } from './index.js'

describe('parseOpenAPI', () => {
  it.concurrent('should return ok for a valid OpenAPI YAML string', async () => {
    await runGeneratorError(
      parseOpenAPI({
        openapi: '3.0.0',
        info: {
          title: 'Test API',
          version: '1.0.0',
        },
        components: {
          schemas: {
            Test: {
              type: 'object',
              required: ['test'],
              properties: {
                test: {
                  type: 'string',
                },
              },
            },
          },
        },
        paths: {
          '/test': {
            post: {
              summary: 'Test endpoint',
              requestBody: {
                required: true,
                content: {
                  'application/json': {
                    schema: {
                      $ref: '#/components/schemas/Test',
                    },
                  },
                },
              },
              responses: {
                '200': {
                  description: 'Successful test',
                },
              },
            },
          },
        },
      } as unknown as `${string}.json`),
    )
  })

  it.concurrent('should return err for a document that cannot be read', async () => {
    const result = await runGeneratorError(parseOpenAPI('missing.json'))
    expect(result._tag).toBe('OpenAPIError')
    expect(result.message.length).toBeGreaterThan(0)
  })

  it.concurrent('reads a .yml document', async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'asphodelos-openapi-'))
    const input = `${directory}/openapi.yml` as const
    fs.writeFileSync(
      input,
      'openapi: 3.1.0\ninfo: { title: Test API, version: 1.0.0 }\npaths:\n  /ping:\n    get:\n      responses:\n        "204": { description: No content }\n',
    )
    try {
      expect(await runGenerator(parseOpenAPI(input))).toStrictEqual({
        openapi: '3.1.0',
        info: { title: 'Test API', version: '1.0.0' },
        paths: { '/ping': { get: { responses: { '204': { description: 'No content' } } } } },
      })
    } finally {
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it('includes the resolver error code when a download has no reason text', async () => {
    const url = 'https://example.com:81/openapi.yaml'
    const failure = Object.assign(new Error(`Error downloading ${url}: `), {
      ioErrorCode: 'ETIMEDOUT',
    })
    const bundle = spyOn(SwaggerParser, 'bundle').mockRejectedValueOnce(failure)
    try {
      const error = await runGeneratorError(parseOpenAPI(url))
      expect(error.message).toBe(`Error downloading ${url}: ETIMEDOUT`)
    } finally {
      bundle.mockRestore()
    }
  })

  it('preserves an existing download reason without duplicating its code', async () => {
    const url = 'https://example.com/openapi.yaml'
    const message = `Error downloading ${url}: getaddrinfo ENOTFOUND example.com`
    const bundle = spyOn(SwaggerParser, 'bundle').mockRejectedValueOnce(
      Object.assign(new Error(message), { ioErrorCode: 'ENOTFOUND' }),
    )
    try {
      const error = await runGeneratorError(parseOpenAPI(url))
      expect(error.message).toBe(message)
    } finally {
      bundle.mockRestore()
    }
  })
})

// Anchored to this file rather than to the working directory: other suites in the same process
// `process.chdir` into their own temp directories, and a relative path here would follow them.
const TSP_TEST_DIR = path.resolve(import.meta.dir, '../..')
const TSP_TEST_FILE = path.join(TSP_TEST_DIR, 'tmp-spec.tsp') as `${string}.tsp`
const TSP_TEST_SUBDIR = path.join(TSP_TEST_DIR, 'tmp-spec')

describe('parseOpenAPI TypeSpec', () => {
  beforeEach(() => {
    fs.rmSync(TSP_TEST_FILE, { force: true })
    fs.rmSync(TSP_TEST_SUBDIR, { recursive: true, force: true })
  })
  afterEach(() => {
    fs.rmSync(TSP_TEST_FILE, { force: true })
    fs.rmSync(TSP_TEST_SUBDIR, { recursive: true, force: true })
  })
  it('typeSpecToOpenAPI not Error', async () => {
    const tmpTsp = `import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

@service(#{ title: "Widget Service" })
namespace DemoService;
using Rest;
using Http;
using OpenAPI;

model WidgetBase {
  @key id: string;
  weight: int32;
  color: "red" | "blue";
}

enum WidgetKind {
  Heavy,
  Light,
}

model HeavyWidget extends WidgetBase {
  kind: WidgetKind.Heavy;
}

model LightWidget extends WidgetBase {
  kind: WidgetKind.Light;
}

@discriminated
union Widget {
  heavy: HeavyWidget,
  light: LightWidget,
}

@error
model Error {
  code: int32;
  message: string;
}

@get op read(@path id: string): Widget | Error;
`
    fs.writeFileSync(TSP_TEST_FILE, tmpTsp)
    const result = await runGenerator(parseOpenAPI(TSP_TEST_FILE))
    expect(result.openapi).toBeDefined()
  })

  it('typeSpecToOpenAPI dir not Error', async () => {
    const tmpTsp = `import "@typespec/http";
import "@typespec/rest";
import "@typespec/openapi3";

@service(#{ title: "Widget Service" })
namespace DemoService;
using Rest;
using Http;
using OpenAPI;

model WidgetBase {
  @key id: string;
  weight: int32;
  color: "red" | "blue";
}

enum WidgetKind {
  Heavy,
  Light,
}

model HeavyWidget extends WidgetBase {
  kind: WidgetKind.Heavy;
}

model LightWidget extends WidgetBase {
  kind: WidgetKind.Light;
}

@discriminated
union Widget {
  heavy: HeavyWidget,
  light: LightWidget,
}

@error
model Error {
  code: int32;
  message: string;
}

@get op read(@path id: string): Widget | Error;
`
    fs.mkdirSync(TSP_TEST_SUBDIR, { recursive: true })
    fs.writeFileSync(`${TSP_TEST_SUBDIR}/tmp-spec.tsp`, tmpTsp)
    // A valid TypeSpec entry point compiles: a failure would reject here.
    const result = await runGenerator(parseOpenAPI(`${TSP_TEST_SUBDIR}/tmp-spec.tsp`))
    expect(result.openapi).toBeDefined()
  })

  it('typeSpecToOpenAPI Error', async () => {
    const tmpTsp = `import "@typespec`
    fs.writeFileSync(TSP_TEST_FILE, tmpTsp)
    const result = await runGeneratorError(parseOpenAPI(TSP_TEST_FILE))
    expect(result._tag).toBe('OpenAPIError')
  })
})
