import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { syncGeneratedFiles } from '../src/sync/generate'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('syncGeneratedFiles', () => {
  it('writes type declaration files', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-sync-'))
    dirs.push(tmp)

    const outDir = path.join(tmp, '.fict/generated')
    const result = await syncGeneratedFiles({
      outDir,
      routes: [
        {
          id: 'users/[id]',
          file: '/repo/src/routes/users/[id].tsx',
          routePath: '/users/:id',
          signature: 's:users/p',
          score: 100,
          segments: [{ kind: 'static', value: 'users' }, { kind: 'param', name: 'id' }],
        },
      ],
    })

    expect(result.files).toHaveLength(3)

    const routesDts = await fs.readFile(path.join(outDir, 'routes.d.ts'), 'utf8')
    expect(routesDts).toContain("'users/[id]': { id: string }")

    const virtualDts = await fs.readFile(path.join(outDir, 'virtual-modules.d.ts'), 'utf8')
    expect(virtualDts).toContain("declare module 'virtual:fict-kit/routes'")
  })
})
