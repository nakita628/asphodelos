import { Context, Data, Effect } from 'effect'
import { format } from 'oxfmt'
import type { FormatConfig } from 'oxfmt'

/** oxfmt rejected the source it was handed. */
export class FormatError extends Data.TaggedError('FormatError')<{
  readonly message: string
}> {}

const defaultConfig: FormatConfig = {
  printWidth: 100,
  singleQuote: true,
  semi: false,
}

/**
 * The oxfmt options generated source is written with.
 *
 * A `Reference` rather than module state: the default is what a program gets without saying
 * anything, and a config file's `format` block overrides it for that program only — two runs in
 * one process cannot leak options into each other.
 */
export const FormatOptions = Context.Reference<FormatConfig>('asphodelos/FormatOptions', {
  defaultValue: () => defaultConfig,
})

/**
 * oxfmt keeps a blank line wherever the author had one, including between imports. Generated
 * source has no author, so the gaps are an artifact of how the header was assembled.
 */
function collapseImportGaps(code: string) {
  return code.replaceAll(/^(import\s[^\n]*?\sfrom\s[^\n]+\n)\n+(?=import\s[^\n]*?\sfrom\s)/gm, '$1')
}

/** Formats generated TypeScript with the options in scope. */
export function fmt(input: string) {
  return Effect.gen(function* () {
    const config = yield* FormatOptions
    // `tryPromise`, not `promise`: oxfmt is a third-party formatter fed generated source, so a
    // rejection belongs in the error channel rather than becoming a defect that walks past every
    // `catch` and `mapError` between here and the CLI.
    const { code, errors } = yield* Effect.tryPromise({
      try: () => format('<stdin>.ts', input, { ...defaultConfig, ...config }),
      catch: (cause) =>
        new FormatError({ message: cause instanceof Error ? cause.message : String(cause) }),
    })
    if (errors.length > 0) {
      return yield* new FormatError({ message: errors.map((error) => error.message).join('\n') })
    }
    return collapseImportGaps(code)
  })
}
