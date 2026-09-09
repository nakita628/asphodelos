import { defineConfig } from 'asphodelos'

export default defineConfig({
  'preact-query': {
    output: '../../__generated__/preact-query/hooks.ts',
    import: '../../hosts/users-client',
  },
  input: '../../specs/users.yaml',
  // Every case generates the app too, since that job always runs; it is sent to the same
  // gitignored tree so a case directory holds nothing but its config.
  output: '../../__generated__/preact-query/app/index.ts',
})
