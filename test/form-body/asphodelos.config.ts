import { defineConfig } from 'asphodelos'

export default defineConfig({
  input: './openapi.yaml',
  output: './__generated__/index.ts',
})
