import { describe, expect, it } from 'vitest'

import { runCreateFict } from '../src/index'

describe('create-fict setup', () => {
  it('exports cli runner', () => {
    expect(typeof runCreateFict).toBe('function')
  })
})
