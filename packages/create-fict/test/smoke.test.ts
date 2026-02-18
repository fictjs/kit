import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { scaffoldProject } from '../src/index'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('create-fict', () => {
  it('scaffolds a project from template', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-fict-'))
    dirs.push(root)

    const targetDir = path.join(root, 'my-app')
    await scaffoldProject(targetDir, { template: 'minimal' })

    const packageJson = JSON.parse(await fs.readFile(path.join(targetDir, 'package.json'), 'utf8')) as {
      name: string
    }
    const entryClient = await fs.readFile(path.join(targetDir, 'src/entry-client.ts'), 'utf8')

    expect(packageJson.name).toBe('my-app')
    expect(entryClient).toContain("virtual:fict-kit/entry-client")
  })
})
