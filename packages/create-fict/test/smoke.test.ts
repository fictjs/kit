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
  it('scaffolds project with default features', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-fict-'))
    dirs.push(root)

    const targetDir = path.join(root, 'my-app')
    await scaffoldProject(targetDir, { template: 'minimal' })

    const packageJson = JSON.parse(await fs.readFile(path.join(targetDir, 'package.json'), 'utf8')) as {
      name: string
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }

    expect(packageJson.name).toBe('my-app')
    expect(packageJson.dependencies['@fictjs/adapter-node']).toBe('^0.1.0')
    expect(packageJson.scripts.lint).toBe('eslint .')
    expect(packageJson.scripts.test).toBe('vitest run')

    await expect(fs.stat(path.join(targetDir, 'eslint.config.js'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(targetDir, 'vitest.config.ts'))).resolves.toBeDefined()
  })

  it('supports static adapter without eslint/vitest', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-fict-'))
    dirs.push(root)

    const targetDir = path.join(root, 'my-static-app')
    await scaffoldProject(targetDir, {
      template: 'minimal',
      adapter: 'static',
      eslint: false,
      vitest: false,
    })

    const packageJson = JSON.parse(await fs.readFile(path.join(targetDir, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
      scripts: Record<string, string>
    }

    expect(packageJson.dependencies['@fictjs/adapter-static']).toBe('^0.1.0')
    expect(packageJson.dependencies['@fictjs/adapter-node']).toBeUndefined()
    expect(packageJson.scripts.lint).toBeUndefined()
    expect(packageJson.scripts.test).toBeUndefined()

    const config = await fs.readFile(path.join(targetDir, 'fict.config.ts'), 'utf8')
    expect(config).toContain("@fictjs/adapter-static")

    await expect(fs.stat(path.join(targetDir, 'eslint.config.js'))).rejects.toThrow()
    await expect(fs.stat(path.join(targetDir, 'vitest.config.ts'))).rejects.toThrow()
  })

  it('throws when target is non-empty without force/yes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-fict-'))
    dirs.push(root)

    const targetDir = path.join(root, 'existing')
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(path.join(targetDir, 'keep.txt'), 'keep')

    await expect(scaffoldProject(targetDir, { template: 'minimal' })).rejects.toThrow(
      'Target directory is not empty',
    )
  })

  it('overwrites non-empty directory with --yes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'create-fict-'))
    dirs.push(root)

    const targetDir = path.join(root, 'overwrite')
    await fs.mkdir(targetDir, { recursive: true })
    await fs.writeFile(path.join(targetDir, 'old.txt'), 'old')

    await scaffoldProject(targetDir, { template: 'minimal', yes: true })

    await expect(fs.stat(path.join(targetDir, 'old.txt'))).rejects.toThrow()
    await expect(fs.stat(path.join(targetDir, 'src/entry-client.ts'))).resolves.toBeDefined()
  })
})
