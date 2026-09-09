import { defineConfig } from 'asphodelos'

export default defineConfig({
  'vue-query': {
    output: '../../__generated__/vue-query/hooks.ts',
    import: '../../hosts/users-client',
  },
  input: '../../specs/users.yaml',
  // Every case generates the app too, since that job always runs; it is sent to the same
  // gitignored tree so a case directory holds nothing but its config.
  output: '../../__generated__/vue-query/app/index.ts',
})
