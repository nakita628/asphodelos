import { defineConfig } from 'oxlint'

import packageConfig from '../packages/asphodelos/oxlint.config.ts'

// The client suite holds itself to the package's rules rather than a copy of them, so the two
// cannot drift. What differs is only what cannot apply here:
//
// - the plugin path, which is relative to the config that names it;
// - the layering overrides, which describe `packages/asphodelos/src` and match nothing here;
// - `__generated__`, which is the generator's output and is checked by `tsc` instead.
export default defineConfig({
  ...packageConfig,
  jsPlugins: ['../packages/asphodelos/lint/custom.js'],
  ignorePatterns: ['**/node_modules/**', '__generated__/**'],
  overrides: [
    ...(packageConfig.overrides ?? []).filter((override) =>
      override.files.every((glob) => glob.startsWith('**/')),
    ),
    {
      // The scripts are command-line programs: printing a report is what they are for.
      files: ['scripts/**'],
      rules: { 'no-console': 'off' },
    },
  ],
})
