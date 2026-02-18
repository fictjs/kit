import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { addFeatures } from '../src/add'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('addFeatures', () => {
  it('switches node adapter to static adapter', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-add-'))
    dirs.push(root)

    await writeFixture(root, {
      'package.json': JSON.stringify(
        {
          name: 'test-app',
          private: true,
          dependencies: {
            '@fictjs/adapter-node': '^0.1.0',
          },
        },
        null,
        2,
      ),
      'fict.config.ts':
        "import node from '@fictjs/adapter-node'\nimport { defineConfig } from '@fictjs/kit/config'\n\nexport default defineConfig({\n  appRoot: 'src',\n  routesDir: 'src/routes',\n  adapter: node(),\n})\n",
    })

    const result = await addFeatures({
      cwd: root,
      features: ['static'],
    })

    expect(result.applied).toContain('adapter-static')
    expect(result.files).toContain('fict.config.ts')

    const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      dependencies: Record<string, string>
    }

    expect(packageJson.dependencies['@fictjs/adapter-static']).toBe('^0.1.0')
    expect(packageJson.dependencies['@fictjs/adapter-node']).toBeUndefined()

    const config = await fs.readFile(path.join(root, 'fict.config.ts'), 'utf8')
    expect(config).toContain("@fictjs/adapter-static")
    expect(config).toContain('adapter: staticAdapter()')
  })

  it('adds tailwind playwright eslint and vitest scaffolding', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-add-'))
    dirs.push(root)

    await writeFixture(root, {
      'package.json': JSON.stringify(
        {
          name: 'test-app',
          private: true,
          scripts: {
            dev: 'fict-kit dev',
          },
          dependencies: {
            fict: '^0.10.0',
            '@fictjs/kit': '^0.1.0',
          },
          devDependencies: {},
        },
        null,
        2,
      ),
      "src/entry-client.ts": "import 'virtual:fict-kit/entry-client'\n",
    })

    await addFeatures({
      cwd: root,
      features: ['tailwind', 'playwright', 'eslint', 'vitest'],
    })

    const packageJson = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>
      devDependencies: Record<string, string>
    }

    expect(packageJson.scripts.lint).toBe('eslint .')
    expect(packageJson.scripts.test).toBe('vitest run')
    expect(packageJson.scripts['test:e2e']).toBe('playwright test')
    expect(packageJson.devDependencies.tailwindcss).toBe('^3.4.17')
    expect(packageJson.devDependencies['@playwright/test']).toBe('^1.58.2')

    await expect(fs.stat(path.join(root, 'tailwind.config.ts'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(root, 'playwright.config.ts'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(root, 'eslint.config.js'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(root, 'vitest.config.ts'))).resolves.toBeDefined()

    const entryClient = await fs.readFile(path.join(root, 'src/entry-client.ts'), 'utf8')
    expect(entryClient).toContain("import './styles.css'")
  })

  it('throws on unknown feature', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-add-'))
    dirs.push(root)

    await writeFixture(root, {
      'package.json': JSON.stringify({ name: 'test-app', private: true }, null, 2),
    })

    await expect(
      addFeatures({
        cwd: root,
        features: ['unknown-feature'],
      }),
    ).rejects.toThrow('Unknown add feature')
  })
})

async function writeFixture(root: string, files: Record<string, string>): Promise<void> {
  await Promise.all(
    Object.entries(files).map(async ([relative, content]) => {
      const absolute = path.join(root, relative)
      await fs.mkdir(path.dirname(absolute), { recursive: true })
      await fs.writeFile(absolute, content)
    }),
  )
}
