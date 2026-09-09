import { defineConfig } from 'asphodelos'

export default defineConfig({
  'tanstack-query': {
    split: true,
    output: '../../__generated__/tanstack-query-split',
    import: '../../hosts/users-client',
  },
  input: '../../specs/users.yaml',
  output: '../../__generated__/tanstack-query-split/app/index.ts',
})
