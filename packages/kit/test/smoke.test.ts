import { describe, expect, it } from 'vitest'

import { defineConfig, mergeConfigDefaults } from '../src/config'

describe('kit setup', () => {
  it('applies config defaults', () => {
    const config = defineConfig({ appRoot: 'app' })
    expect(mergeConfigDefaults(config).appRoot).toBe('app')
    expect(mergeConfigDefaults(config).routesDir).toBe('src/routes')
  })
})
