import node from '@fictjs/adapter-node'
import { defineConfig } from '@fictjs/kit/config'

export default defineConfig({
  appRoot: 'src',
  routesDir: 'src/routes',
  adapter: node(),
})
