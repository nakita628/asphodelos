import { defineConfig } from 'asphodelos'

// The hooks import the client this config generates beside them; the client is typed by the app the
// config writes under app/, a package of its own (see app/package.json), so it imports `app` by the
// name below — which tsconfig.json maps onto the host app, whose handlers are written. The
// generated app itself is a scaffold and is not compiled.
export default defineConfig({
  input: '../../specs/users.yaml',
  output: './app/index.ts',
  package: '@asphodelos/host',
  // A value a module exports, imported by the specifier as written from where the client is.
  client: {
    output: '../../__generated__/tanstack-query/client.ts',
    baseUrl: { import: '../../hosts/env', value: 'env.API_URL' },
  },
  'tanstack-query': { output: '../../__generated__/tanstack-query/hooks.ts' },
})
