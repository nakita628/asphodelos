import { defineConfig } from 'tsdown'

// `cli` is the bin (a process); `index` is what `import { defineConfig } from 'asphodelos'`
// resolves to. One entry per subpath in package.json `exports` — a missing one publishes a
// subpath that resolves to nothing.
export default defineConfig({
  entry: {
    cli: 'src/index.ts',
    index: 'src/config/index.ts',
    'vite-plugin/index': 'src/vite-plugin/index.ts',
  },
})
