import { afterEach, beforeEach, describe, expect, it } from 'bun:test'
import fs from 'node:fs'
import path from 'node:path'

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
      } as unknown as string),
    )
  })

  it.concurrent('should return err for a completely invalid input', async () => {
    const result = await runGeneratorError(parseOpenAPI('not yaml nor json'))
    expect(result._tag).toBe('OpenAPIError')
    expect(result.message.length).toBeGreaterThan(0)
  })
})

// Anchored to this file rather than to the working directory: other suites in the same process
// `process.chdir` into their own temp directories, and a relative path here would follow them.
const TSP_TEST_DIR = path.resolve(import.meta.dir, '../..')
const TSP_TEST_FILE = path.join(TSP_TEST_DIR, 'tmp-spec.tsp')
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
