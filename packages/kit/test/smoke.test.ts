import { describe, expect, it } from 'vitest'

import { defineConfig, mergeConfigDefaults } from '../src/config'

describe('kit setup', () => {
  it('applies config defaults', () => {
    const config = defineConfig({ appRoot: 'app' })
    const merged = mergeConfigDefaults(config, '/repo')

    expect(merged.appRoot).toBe('/repo/app')
    expect(merged.routesDir).toBe('/repo/app/routes')
  })
})
