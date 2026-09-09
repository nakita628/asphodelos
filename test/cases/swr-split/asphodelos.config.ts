import { defineConfig } from 'asphodelos'

export default defineConfig({
  swr: {
    split: true,
    output: '../../__generated__/swr-split',
    import: '../../hosts/users-client',
  },
  input: '../../specs/users.yaml',
  output: '../../__generated__/swr-split/app/index.ts',
})
