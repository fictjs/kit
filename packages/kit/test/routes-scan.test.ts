import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { scanRoutes } from '../src/core/routes/scan'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('scanRoutes', () => {
  it('maps file system routes into route records', async () => {
    const root = await makeRoutesFixture({
      'index.tsx': 'export default function Page() { return null }',
      'users/[id].tsx': 'export default function Page() { return null }',
      'blog/[...slug].tsx': 'export default function Page() { return null }',
    })

    const result = await scanRoutes({ routesDir: root })

    expect(result.diagnostics.filter(item => item.level === 'error')).toHaveLength(0)
    expect(result.routes.map(route => route.routePath)).toEqual(['/users/:id', '/blog/*slug', '/'])
  })

  it('reports signature conflicts for ambiguous params', async () => {
    const root = await makeRoutesFixture({
      'users/[id].tsx': 'export default function Page() { return null }',
      'users/[name].tsx': 'export default function Page() { return null }',
    })

    const result = await scanRoutes({ routesDir: root })

    const errors = result.diagnostics.filter(item => item.level === 'error')
    expect(errors).toHaveLength(1)
    expect(errors[0]?.message).toContain('Route signature conflict')
  })
})

async function makeRoutesFixture(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-routes-'))
  dirs.push(dir)

  await Promise.all(
    Object.entries(files).map(async ([relative, content]) => {
      const absolute = path.join(dir, relative)
      await fs.mkdir(path.dirname(absolute), { recursive: true })
      await fs.writeFile(absolute, content)
    }),
  )

  return dir
}
