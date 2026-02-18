import { describe, expect, it } from 'vitest'

import { adapterNode } from '../src'

describe('adapter-node setup', () => {
  it('returns adapter metadata', () => {
    expect(adapterNode().name).toBe('@fictjs/adapter-node')
  })
})
