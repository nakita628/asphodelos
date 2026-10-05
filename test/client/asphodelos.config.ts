import { defineConfig } from 'asphodelos'

// The generated client, and the files that read it, under the path alias: the client imports the
// app entry as `@/index`, the `index.ts` beside the client re-exports it, the hooks import that
// barrel as `@/lib`, and tsconfig.json maps `@/` onto the app entry's directory the way a project
// would. The base URL is read from the
// environment so the test can point it at a server on an ephemeral port; `sameOrigin` is what a
// browser uses instead.
export default defineConfig({
  input: '../specs/users.yaml',
  output: './__generated__/src/index.ts',
  pathAlias: '@/',
  client: {
    output: './__generated__/src/lib/client.ts',
    baseUrl: { env: 'ASPHODELOS_TEST_API_URL', source: 'process.env' },
    sameOrigin: true,
  },
  'tanstack-query': {
    output: './__generated__/src/hooks.ts',
  },
})
