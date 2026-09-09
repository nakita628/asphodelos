import { defineConfig } from 'asphodelos'

export default defineConfig({
  swr: {
    output: '../../__generated__/swr/hooks.ts',
    import: '../../hosts/users-client',
  },
  input: '../../specs/users.yaml',
  // Every case generates the app too, since that job always runs; it is sent to the same
  // gitignored tree so a case directory holds nothing but its config.
  output: '../../__generated__/swr/app/index.ts',
})
