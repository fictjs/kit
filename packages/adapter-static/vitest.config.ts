import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

const packageRoot = path.dirname(fileURLToPath(import.meta.url))
const kitPackageRoot = path.resolve(packageRoot, '..', 'kit')

export default defineConfig({
  resolve: {
    alias: {
      '@fictjs/kit/server': path.join(kitPackageRoot, 'src', 'server.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: true,
    include: ['test/**/*.test.ts'],
  },
})
