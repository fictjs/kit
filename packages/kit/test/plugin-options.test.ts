import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fictSpy } = vi.hoisted(() => ({
  fictSpy: vi.fn(() => ({ name: 'fict-mock' })),
}))

vi.mock('@fictjs/vite-plugin', () => ({
  default: fictSpy,
}))

import { fictKit } from '../src/plugin/fict-kit'

describe('fictKit options passthrough', () => {
  beforeEach(() => {
    fictSpy.mockClear()
  })

  it('passes compiler options and resumable flag to @fictjs/vite-plugin', () => {
    fictKit({
      compiler: {
        strictGuarantee: true,
      },
      resumable: false,
    })

    expect(fictSpy).toHaveBeenCalledTimes(1)
    expect(fictSpy).toHaveBeenCalledWith({
      strictGuarantee: true,
      resumable: false,
    })
  })

  it('defaults resumable to true', () => {
    fictKit()

    expect(fictSpy).toHaveBeenCalledTimes(1)
    expect(fictSpy).toHaveBeenCalledWith({
      resumable: true,
    })
  })
})
