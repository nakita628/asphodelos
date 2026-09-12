import path from 'node:path'

import SwaggerParser from '@apidevtools/swagger-parser'
import { compile, NodeHost } from '@typespec/compiler'
import { getOpenAPI3 } from '@typespec/openapi3'
import { Data, Effect } from 'effect'

import type { VendorExtensions } from './vendor-ext.js'

/** The document could not be read, compiled or parsed into an OpenAPI object. */
class OpenAPIError extends Data.TaggedError('OpenAPIError')<{
  readonly message: string
}> {}

export function parseOpenAPI(input: `${string}.tsp` | `${string}.yaml` | `${string}.json`) {
  return Effect.tryPromise({
    try: async () => {
      if (!input.endsWith('.tsp')) return (await SwaggerParser.bundle(input)) as OpenAPI
      const program = await compile(NodeHost, path.resolve(input), { noEmit: true })
      if (program.diagnostics.length > 0) {
        throw new Error(
          `TypeSpec compile failed:\n${program.diagnostics.map((d) => d.message).join('\n')}`,
        )
      }
      const [record] = await getOpenAPI3(program)
      const document =
        record && ('document' in record ? record.document : record.versions[0]?.document)
      if (!document) throw new Error(`TypeSpec emitted no OpenAPI document: ${input}`)
      return document as OpenAPI
    },
    catch: (error) =>
      new OpenAPIError({ message: error instanceof Error ? error.message : String(error) }),
  })
}

export type OpenAPI = {
  readonly openapi?: string
  readonly $self?: string
  readonly info?: {
    readonly title?: string
    readonly summary?: string
    readonly description?: string
    readonly termsOfService?: string
    readonly contact?: {
      readonly name?: string
      readonly url?: string
      readonly email?: string
    }
    readonly license?: {
      readonly name?: string
      readonly identifier?: string
      readonly url?: string
    }
    readonly version?: string
  }
  readonly jsonSchemaDialect?: string
  readonly servers?: readonly Server[]
  readonly paths: OpenAPIPaths
  readonly webhooks?: {
    readonly [k: string]: PathItem
  }
  readonly components?: Components
  readonly security?: readonly { readonly [k: string]: readonly string[] }[]
  readonly tags?: {
    readonly name: string
    readonly summary?: string
    readonly description?: string
    readonly externalDocs?: ExternalDocs
    readonly parent?: string
    readonly kind?: string
  }[]
  readonly externalDocs?: ExternalDocs
}

export type Components = {
  readonly schemas?: {
    readonly [k: string]: Schema
  }
  readonly responses?: {
    readonly [k: string]: Responses
  }
  readonly parameters?: {
    readonly [k: string]: Parameter
  }
  readonly examples?: {
    readonly [k: string]:
      | {
          readonly summary?: string
          readonly description?: string
          readonly dataValue?: unknown
          readonly serializedValue?: string
          readonly externalValue?: string
          readonly value?: unknown
        }
      | Reference
  }
  readonly requestBodies?: {
    readonly [k: string]: RequestBody
  }
  readonly headers?: {
    readonly [k: string]: Header | Reference
  }
  readonly securitySchemes?: {
    readonly [k: string]:
      | {
          readonly type?: string
          readonly description?: string
          readonly name?: string
          readonly in?: string
          readonly scheme?: string
          readonly bearerFormat?: string
          readonly flows?: OAuthFlow
          readonly password?: OAuthFlow
          readonly clientCredentials?: OAuthFlow
          readonly authorizationCode?: OAuthFlow
          readonly deviceAuthorization?: OAuthFlow
          readonly openIdConnectUrl?: string
          readonly oauth2MetadataUrl?: string
          readonly deprecated?: boolean
        }
      | Reference
  }
  readonly links?: {
    readonly [k: string]: Link | Reference
  }
  readonly callbacks?: {
    readonly [k: string]: Callbacks | Reference
  }
  readonly pathItems?: {
    readonly [k: string]: PathItem
  }
  readonly mediaTypes?: {
    readonly [k: string]: Media | Reference
  }
}

type OAuthFlowDetail = {
  readonly authorizationUrl?: string
  readonly deviceAuthorizationUrl?: string
  readonly tokenUrl?: string
  readonly refreshUrl?: string
  readonly scopes: {
    readonly [k: string]: string
  }
}

type OAuthFlow = {
  readonly implicit?: OAuthFlowDetail
  readonly password?: OAuthFlowDetail
  readonly clientCredentials?: OAuthFlowDetail
  readonly authorizationCode?: OAuthFlowDetail
  readonly deviceAuthorization?: OAuthFlowDetail
}

type OpenAPIPaths = {
  readonly [k: string]: PathItem
}

export type Type =
  | 'string'
  | 'number'
  | 'integer'
  | 'date'
  | 'boolean'
  | 'array'
  | 'object'
  | 'null'

type Format = FormatString | FormatNumber

type FormatString =
  | 'email'
  | 'uuid'
  | 'uuidv4'
  | 'uuidv6'
  | 'uuidv7'
  | 'uri'
  | 'hex'
  | 'jwt'
  | 'emoji'
  | 'base64'
  | 'base64url'
  | 'nanoid'
  | 'cuid'
  | 'cuid2'
  | 'ulid'
  | 'ipv4'
  | 'ipv6'
  | 'cidrv4'
  | 'cidrv6'
  | 'date'
  | 'time'
  | 'date-time'
  | 'duration'
  | 'binary'
  | 'boolean-string'
  | 'toLowerCase'
  | 'toUpperCase'
  | 'trim'

type FormatNumber =
  | 'int32'
  | 'int64'
  | 'bigint'
  | 'float'
  | 'float32'
  | 'float64'
  | 'double'
  | 'numeric'

export type Ref =
  | `#/components/schemas/${string}`
  | `#/components/responses/${string}`
  | `#/components/parameters/${string}`
  | `#/components/examples/${string}`
  | `#/components/requestBodies/${string}`
  | `#/components/headers/${string}`
  | `#/components/securitySchemes/${string}`
  | `#/components/links/${string}`
  | `#/components/callbacks/${string}`
  | `#/components/pathItems/${string}`
  | `#/components/mediaTypes/${string}`

type Server = {
  readonly url: string
  readonly description?: string
  readonly name?: string
  readonly variables?: {
    readonly [k: string]: {
      readonly enum?: readonly string[]
      readonly default?: string
      readonly description?: string
    }
  }
}

export type Header = {
  readonly description?: string
  readonly required?: boolean
  readonly deprecated?: boolean
  readonly example?: unknown
  readonly examples?: {
    readonly [k: string]:
      | {
          readonly summary?: string
          readonly description?: string
          readonly defaultValue?: unknown
          readonly serializedValue?: string
          readonly externalValue?: string
          readonly value?: unknown
        }
      | Reference
  }
  style?: string
  explode?: boolean
  allowReserved?: boolean
  schema?: Schema
  content?: Content
} & VendorExtensions

export type Link = {
  readonly operationRef?: string
  readonly operationId?: string
  readonly parameters?: {
    readonly [k: string]: unknown
  }
  readonly requestBody?: unknown
  readonly description?: string
  readonly server?: Server
}

export type Reference = {
  readonly $ref?: Ref
  readonly summary?: string
  readonly description?: string
}

type Encoding = {
  readonly contentType?: string
  readonly headers?: {
    readonly [k: string]: Header | Reference
  }
  readonly encoding?: {
    readonly [k: string]: Encoding
  }
  readonly prefixEncoding?: Encoding
  readonly itemEncoding?: Encoding
}

export type Content = {
  readonly [k: string]: Media
}

export type PathItem = {
  readonly $ref?: Ref
  readonly summary?: string
  readonly description?: string
  readonly get?: Operation
  readonly put?: Operation
  readonly post?: Operation
  readonly delete?: Operation
  readonly options?: Operation
  readonly head?: Operation
  readonly patch?: Operation
  readonly trace?: Operation
  readonly query?: Operation
  readonly additionalOperations?: {
    readonly [k: string]: Operation
  }
  readonly servers?: readonly Server[]
  readonly parameters?: readonly (Parameter | Reference)[]
}

export type Operation = {
  readonly tags?: readonly string[]
  readonly summary?: string
  readonly description?: string
  readonly externalDocs?: {
    readonly description?: string
    readonly url: string
  }
  readonly operationId?: string
  readonly parameters?: readonly (Parameter | Reference)[]
  readonly requestBody?: RequestBody | Reference
  readonly responses: {
    readonly [k: string]: Responses
  }
  readonly callbacks?: {
    readonly [k: string]: Callbacks | Reference
  }
  readonly deprecated?: boolean
  readonly security?: readonly { readonly [scheme: string]: readonly string[] }[]
  readonly servers?: readonly {
    readonly url: string
    readonly description?: string
    readonly variables?: {
      readonly [k: string]: {
        readonly enum?: readonly string[]
        readonly default?: string
        readonly description?: string
      }
    }
  }[]
  readonly 'x-pagination'?: boolean
} & VendorExtensions

export type Responses = {
  readonly $ref?: Ref
  readonly summary?: string
  readonly description?: string
  readonly content?: Content
  readonly headers?: {
    readonly [k: string]: Header | Reference
  }
  readonly links?: {
    readonly [k: string]: Link | Reference
  }
} & VendorExtensions

type Discriminator = {
  readonly propertyName?: string
  readonly mapping?: {
    readonly [k: string]: string
  }
  readonly defaultMapping?: string
}

type ExternalDocs = {
  readonly url: string
  readonly description?: string
}

export type Schema = {
  readonly discriminator?: Discriminator
  readonly xml?: {
    readonly nodeType?: string
    readonly name?: string
    readonly namespace?: string
    readonly prefix?: string
    readonly attribute?: boolean
    readonly wrapped?: boolean
  }
  readonly externalDocs?: ExternalDocs
  readonly example?: unknown
  /** An array of values in OpenAPI 3.1 / JSON Schema 2020-12; the keyed map is the 3.0 shape. */
  readonly examples?:
    | readonly unknown[]
    | {
        readonly [k: string]:
          | {
              readonly summary?: string
              readonly description?: string
              readonly defaultValue?: unknown
              readonly serializedValue?: string
              readonly externalValue?: string
              readonly value?: unknown
            }
          | Reference
      }
  readonly title?: string
  readonly name?: string
  readonly description?: string
  readonly type?: Type | [Type, ...Type[]]
  readonly format?: Format
  readonly pattern?: string
  readonly minLength?: number
  readonly maxLength?: number
  readonly minimum?: number
  readonly maximum?: number
  readonly exclusiveMinimum?: number | boolean
  readonly exclusiveMaximum?: number | boolean
  readonly multipleOf?: number
  readonly minItems?: number
  readonly maxItems?: number
  readonly uniqueItems?: boolean
  readonly minProperties?: number
  readonly maxProperties?: number
  readonly default?: unknown
  readonly properties?: {
    readonly [k: string]: Schema
  }
  readonly required?: readonly string[]
  readonly items?: Schema | readonly Schema[]
  readonly prefixItems?: readonly Schema[]
  readonly enum?: readonly (
    | string
    | number
    | boolean
    | null
    | readonly (string | number | boolean | null)[]
  )[]
  readonly nullable?: boolean
  readonly readOnly?: boolean
  readonly writeOnly?: boolean
  readonly deprecated?: boolean
  readonly additionalProperties?: Schema | boolean
  readonly $ref?: Ref
  readonly oneOf?: readonly Schema[]
  readonly allOf?: readonly Schema[]
  readonly anyOf?: readonly Schema[]
  readonly not?: Schema
  readonly const?: unknown
  readonly patternProperties?: {
    readonly [k: string]: Schema
  }
  readonly propertyNames?: Schema
  readonly dependentRequired?: {
    readonly [k: string]: readonly string[]
  }
  readonly dependentSchemas?: {
    readonly [k: string]: Schema
  }
  readonly contains?: Schema
  readonly minContains?: number
  readonly maxContains?: number
  readonly contentEncoding?: string
  readonly contentMediaType?: string
  readonly if?: Schema
  readonly then?: Schema
  readonly else?: Schema
  readonly unevaluatedProperties?: boolean | Schema
  readonly unevaluatedItems?: boolean | Schema
  readonly 'x-trim'?: boolean
  readonly 'x-toLowerCase'?: boolean
  readonly 'x-toUpperCase'?: boolean
  readonly 'x-lowercase'?: boolean
  readonly 'x-uppercase'?: boolean
  readonly 'x-normalize'?: 'NFC' | 'NFD' | 'NFKC' | 'NFKD'
  readonly 'x-emailRegex'?: string
  readonly 'x-readonly'?: boolean
  readonly 'x-includes'?: string
  readonly 'x-startsWith'?: string
  readonly 'x-endsWith'?: string
  /**
   * Verbatim TypeBox transform. The value is a complete `t.Transform(...)`
   * expression string that replaces the emitted base schema as-is; the
   * generator does not introspect or escape it, so it runs as code when the
   * generated module is imported — only use specs you trust. The author owns
   * the correctness of `Decode`/`Encode`. The usual modifiers compose around
   * it as for any base: `nullable` adds `t.Union([…, t.Null()])`, `x-brand`
   * adds `t.Unsafe<…>(…)`, `x-readonly` adds `t.Readonly(…)`. Note that
   * `t.Union`/`t.Unsafe` widen a transform's decoded type, so prefer to
   * express null/brand inside the transform itself when you need the decoded
   * type preserved.
   * @see https://github.com/sinclairzx81/typebox#transform-types
   */
  readonly 'x-transform'?: string
} & VendorExtensions

export type Parameter = {
  readonly $ref?: Ref
  readonly name: string
  readonly in: 'path' | 'query' | 'header' | 'cookie'
  readonly description?: string
  readonly required?: boolean
  readonly deprecated?: boolean
  readonly allowEmptyValue?: boolean
  readonly style?: string
  readonly explode?: boolean
  readonly allowReserved?: boolean
  readonly schema?: Schema
  readonly content?: Content
  readonly example?: unknown
  readonly examples?: {
    readonly [k: string]:
      | {
          readonly summary?: string
          readonly description?: string
          readonly defaultValue?: unknown
          readonly serializedValue?: string
          readonly externalValue?: string
          readonly value?: unknown
        }
      | Reference
  }
} & VendorExtensions

export type RequestBody = {
  readonly description?: string
  readonly content?: {
    readonly [k: string]: Media | Reference
  }
  readonly required?: boolean
} & VendorExtensions

export type Media = {
  readonly schema: Schema
  readonly itemSchema?: Schema
  readonly example?: unknown
  readonly examples?: {
    readonly [k: string]:
      | {
          readonly summary?: string
          readonly description?: string
          readonly defaultValue?: unknown
          readonly serializedValue?: string
          readonly externalValue?: string
          readonly value?: unknown
        }
      | Reference
  }
  readonly encoding?: {
    readonly [k: string]: Encoding
  }
  readonly prefixEncoding?: Encoding
  readonly itemEncoding?: Encoding
} & VendorExtensions

type Callbacks = {
  readonly [k: string]: PathItem
}
