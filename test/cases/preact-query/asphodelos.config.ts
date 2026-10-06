import { defineConfig } from 'asphodelos'

// The hooks import the client this config generates beside them; the client is typed by the app the
// config writes under app/, a package of its own (see app/package.json), so it imports `app` by the
// name below — which tsconfig.json maps onto the host app, whose handlers are written. The
// generated app itself is a scaffold and is not compiled.
export default defineConfig({
  input: '../../specs/users.yaml',
  output: './app/index.ts',
  package: '@asphodelos/host',
  client: {
    output: '../../__generated__/preact-query/client.ts',
    baseUrl: { env: 'ASPHODELOS_TEST_API_URL', source: 'process.env' },
  },
  'preact-query': { output: '../../__generated__/preact-query/hooks.ts' },
})
