import { defineConfig } from 'oxfmt'

// Single source of truth for formatting style across the workspace. `oxfmt` walks up from each
// file until it finds a config, so this root file is the only one — there is deliberately no
// second config under `packages/*`, and style is never restated per package.
//
// The same three style options are duplicated as `defaultConfig` in
// packages/asphodelos/src/format/index.ts, because generated output is formatted by the library
// itself at runtime and must come out looking like the source it sits next to.
export default defineConfig({
  printWidth: 100,
  singleQuote: true,
  semi: false,
  sortPackageJson: true,
  sortImports: {},
  ignorePatterns: [
    '**/node_modules/**',
    '**/dist/**',
    // Throwaway work trees the runtime tests generate into. Their contents are the generator's
    // own output, formatted by its own oxfmt pass (src/format).
    '**/tmp-*/**',
  ],
})
