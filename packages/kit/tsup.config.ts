import { defineConfig } from 'tsup'

export default defineConfig({
  entry: {
    index: 'src/index.ts',
    config: 'src/config.ts',
    vite: 'src/vite.ts',
    client: 'src/client.ts',
    server: 'src/server.ts',
    router: 'src/router.ts',
    env: 'src/env.ts',
    cli: 'src/cli.ts',
  },
  format: ['cjs', 'esm'],
  dts: true,
  clean: true,
  sourcemap: true,
  minify: false,
  external: ['virtual:fict-kit/routes', 'virtual:fict-kit/routes.server'],
})
