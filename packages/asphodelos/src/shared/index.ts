import { posix } from 'node:path'

import type { Config } from '../config/index.js'
import {
  callbacks,
  components,
  eden,
  elysia,
  examples,
  headers,
  hooks,
  links,
  mediaTypes,
  mock,
  parameters,
  pathItems,
  requestBodies,
  responses,
  schemas,
  securitySchemes,
  test,
  types,
} from '../core/index.js'
import type { OpenAPI } from '../openapi/index.js'

function edenJob(
  openAPI: OpenAPI,
  edenConfig: NonNullable<Config['eden']>,
  prefix: string | undefined,
) {
  return {
    name: 'eden',
    output: edenConfig.output,
    split: false,
    run: (output: string) =>
      eden(openAPI, output, edenConfig.import, edenConfig.client, prefix, edenConfig.docs),
  }
}

export function makeJob(openAPI: OpenAPI, config: Config) {
  const baseDir = posix.normalize(posix.dirname(config.output ?? 'src/index.ts'))
  // `output` (single-file mode) and the per-type targets are mutually exclusive
  // (enforced in parseConfig); split them so the per-type map keeps the shape the
  // component generators expect.
  const { output: componentsOutput, ...componentTargets } = config.components ?? {}
  const componentJobs = componentsOutput
    ? [
        {
          name: 'components',
          output: componentsOutput,
          split: false,
          run: (output: string) => components(openAPI.components, output, config.readonly),
        },
      ]
    : perTypeComponentJobs(openAPI, componentTargets, baseDir, config.readonly)
  return [
    {
      name: 'elysia',
      output: config.output ?? 'src/index.ts',
      split: false,
      run: (output: string) =>
        elysia(openAPI, {
          output,
          prefix: config.prefix,
          port: config.port,
          integration: config.integration === true,
          readonly: config.readonly === true,
          pathAlias: config.pathAlias === true ? `@/${baseDir.replace(/^\.?\/?/, '')}` : undefined,
          components: componentTargets,
          componentsOutput,
        }),
    },
    ...componentJobs,
    config.eden ? edenJob(openAPI, config.eden, config.prefix) : undefined,
    config.types
      ? {
          name: 'types',
          output: config.types.output,
          split: false,
          run: (output: string) => types(openAPI, output, config.prefix),
        }
      : undefined,
    config.test
      ? {
          name: 'test',
          output: config.test.split ? `${baseDir}/modules` : config.test.output,
          split: config.test.split,
          run: (output: string) =>
            test(openAPI, config.test?.split === true ? undefined : output, {
              appOutput: config.output ?? 'src/index.ts',
              split: config.test?.split === true,
              pathAlias: config.test?.pathAlias,
              prefix: config.prefix,
            }),
        }
      : undefined,
    config.mock
      ? {
          name: 'mock',
          output: config.mock.output,
          split: false,
          // `prefix` and `port` come from the root config — they describe the server the mock
          // stands in for, not the mock itself — and the rest from the `mock` block.
          run: (output: string) =>
            mock(openAPI, output, {
              ...config.mock,
              prefix: config.prefix,
              port: config.port,
            }),
        }
      : undefined,
    ...(
      [
        'swr',
        'tanstack-query',
        'preact-query',
        'vue-query',
        'svelte-query',
        'solid-query',
        'angular-query',
      ] as const
    ).map((library) => {
      const cfg = config[library]
      return cfg
        ? {
            name: library,
            output: cfg.output,
            split: cfg.split,
            run: (output: string) =>
              hooks(openAPI, output, cfg.import, library, {
                client: cfg.client,
                basePath: config.prefix,
                split: cfg.split,
              }),
          }
        : undefined
    }),
  ].filter((job) => job !== undefined)
}

function perTypeComponentJobs(
  openAPI: OpenAPI,
  componentTargets: Omit<NonNullable<Config['components']>, 'output'>,
  baseDir: string,
  readonly: boolean | undefined,
) {
  return [
    openAPI.components?.schemas
      ? {
          name: 'schemas',
          output: componentTargets.schemas?.output ?? `${baseDir}/components/schemas.ts`,
          split: componentTargets.schemas?.split ?? false,
          run: (output: string) =>
            schemas(
              openAPI.components?.schemas,
              output,
              componentTargets.schemas?.split ?? false,
              componentTargets.schemas?.exportTypes ?? false,
              componentTargets,
              readonly,
            ),
        }
      : undefined,
    openAPI.components?.responses
      ? {
          name: 'responses',
          output: componentTargets.responses?.output ?? `${baseDir}/components/responses.ts`,
          split: componentTargets.responses?.split ?? false,
          run: (output: string) =>
            responses(
              openAPI.components?.responses,
              output,
              componentTargets.responses?.split ?? false,
              componentTargets.responses?.exportTypes ?? false,
              componentTargets,
              readonly,
            ),
        }
      : undefined,
    openAPI.components?.parameters
      ? {
          name: 'parameters',
          output: componentTargets.parameters?.output ?? `${baseDir}/components/parameters.ts`,
          split: componentTargets.parameters?.split ?? false,
          run: (output: string) =>
            parameters(
              openAPI.components?.parameters,
              output,
              componentTargets.parameters?.split ?? false,
              componentTargets.parameters?.exportTypes ?? false,
              componentTargets,
              readonly,
            ),
        }
      : undefined,
    openAPI.components?.examples
      ? {
          name: 'examples',
          output: componentTargets.examples?.output ?? `${baseDir}/components/examples.ts`,
          split: componentTargets.examples?.split ?? false,
          run: (output: string) =>
            examples(
              openAPI.components?.examples,
              output,
              componentTargets.examples?.split ?? false,
              componentTargets,
            ),
        }
      : undefined,
    openAPI.components?.requestBodies
      ? {
          name: 'requestBodies',
          output:
            componentTargets.requestBodies?.output ?? `${baseDir}/components/requestBodies.ts`,
          split: componentTargets.requestBodies?.split ?? false,
          run: (output: string) =>
            requestBodies(
              openAPI.components?.requestBodies,
              output,
              componentTargets.requestBodies?.split ?? false,
              componentTargets.requestBodies?.exportTypes ?? false,
              componentTargets,
              readonly,
            ),
        }
      : undefined,
    openAPI.components?.headers
      ? {
          name: 'headers',
          output: componentTargets.headers?.output ?? `${baseDir}/components/headers.ts`,
          split: componentTargets.headers?.split ?? false,
          run: (output: string) =>
            headers(
              openAPI.components?.headers,
              output,
              componentTargets.headers?.split ?? false,
              componentTargets.headers?.exportTypes ?? false,
              componentTargets,
              readonly,
            ),
        }
      : undefined,
    openAPI.components?.securitySchemes
      ? {
          name: 'securitySchemes',
          output:
            componentTargets.securitySchemes?.output ?? `${baseDir}/components/securitySchemes.ts`,
          split: componentTargets.securitySchemes?.split ?? false,
          run: (output: string) =>
            securitySchemes(
              openAPI.components?.securitySchemes,
              output,
              componentTargets.securitySchemes?.split ?? false,
              componentTargets,
            ),
        }
      : undefined,
    openAPI.components?.links
      ? {
          name: 'links',
          output: componentTargets.links?.output ?? `${baseDir}/components/links.ts`,
          split: componentTargets.links?.split ?? false,
          run: (output: string) =>
            links(
              openAPI.components?.links,
              output,
              componentTargets.links?.split ?? false,
              componentTargets,
            ),
        }
      : undefined,
    openAPI.components?.callbacks
      ? {
          name: 'callbacks',
          output: componentTargets.callbacks?.output ?? `${baseDir}/components/callbacks.ts`,
          split: componentTargets.callbacks?.split ?? false,
          run: (output: string) =>
            callbacks(
              openAPI.components?.callbacks,
              output,
              componentTargets.callbacks?.split ?? false,
              componentTargets,
            ),
        }
      : undefined,
    openAPI.components?.pathItems
      ? {
          name: 'pathItems',
          output: componentTargets.pathItems?.output ?? `${baseDir}/components/pathItems.ts`,
          split: componentTargets.pathItems?.split ?? false,
          run: (output: string) =>
            pathItems(
              openAPI.components?.pathItems,
              output,
              componentTargets.pathItems?.split ?? false,
              componentTargets,
            ),
        }
      : undefined,
    openAPI.components?.mediaTypes
      ? {
          name: 'mediaTypes',
          output: componentTargets.mediaTypes?.output ?? `${baseDir}/components/mediaTypes.ts`,
          split: componentTargets.mediaTypes?.split ?? false,
          run: (output: string) =>
            mediaTypes(
              openAPI.components?.mediaTypes,
              output,
              componentTargets.mediaTypes?.split ?? false,
              componentTargets.mediaTypes?.exportTypes ?? false,
              componentTargets,
              readonly,
            ),
        }
      : undefined,
  ]
}
