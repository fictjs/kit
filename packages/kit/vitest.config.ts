import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@fictjs\/kit$/, replacement: path.join(packageRoot, 'src', 'index.ts') },
      {
        find: '@fictjs/kit/config',
        replacement: path.join(packageRoot, 'src', 'config.ts'),
      },
      {
        find: '@fictjs/kit/router',
        replacement: path.join(packageRoot, 'src', 'router.ts'),
      },
      {
        find: '@fictjs/kit/client',
        replacement: path.join(packageRoot, 'src', 'client.ts'),
      },
      {
        find: '@fictjs/kit/server',
        replacement: path.join(packageRoot, 'src', 'server.ts'),
      },
      {
        find: '@fictjs/kit/vite',
        replacement: path.join(packageRoot, 'src', 'vite.ts'),
      },
      {
        find: '@fictjs/kit/env',
        replacement: path.join(packageRoot, 'src', 'env.ts'),
      },
    ],
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
})
