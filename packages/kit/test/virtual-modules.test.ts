import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateEntryServerCode, generateRoutesModuleCode } from '../src/core/routes/virtual-modules'

describe('generateRoutesModuleCode', () => {
  it('creates import code with pick query', () => {
    const code = generateRoutesModuleCode({
      root: '/repo',
      target: 'client',
      routes: [
        {
          id: 'users/[id]',
          file: path.join('/repo/src/routes/users/[id].tsx'),
          routePath: '/users/:id',
          segments: [],
          signature: 's:users/p',
          score: 200,
        },
      ],
    })

    expect(code).toContain('pick=default')
    expect(code).toContain('/src/routes/users/[id].tsx')
    expect(code).toContain('id: "users/[id]"')
  })

  it('includes hooks export when hooks module is provided', () => {
    const code = generateEntryServerCode({
      hooksModuleId: '/src/hooks.server.ts',
    })

    expect(code).toContain("import * as hooksModule from \"/src/hooks.server.ts\"")
    expect(code).toContain('export const hooks = {')
    expect(code).toContain('hooksModule.handle')
  })
})
