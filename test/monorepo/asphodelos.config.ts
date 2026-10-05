import { defineConfig } from 'asphodelos'

// Three packages, one config: the app in apps/elysia, the client in apps/eden — re-exported by the
// `index.ts` beside it, which is what `@repo/eden` resolves to — and the hooks in apps/react. Each
// `package.json` marks a package boundary, so the client imports the app as `@repo/elysia` and
// the hooks import the client as `@repo/eden`; tsconfig.json maps both names the way a workspace
// would. The base URL is read from the environment so the test can point it at a server on an
// ephemeral port.
export default defineConfig({
  input: '../specs/users.yaml',
  output: 'apps/elysia/__generated__/src/index.ts',
  client: {
    output: 'apps/eden/__generated__/src/client.ts',
    import: '@repo/elysia',
    package: '@repo/eden',
    baseUrl: { env: 'ASPHODELOS_TEST_API_URL', source: 'process.env' },
  },
  'tanstack-query': {
    output: 'apps/react/__generated__/src/hooks.ts',
  },
})
