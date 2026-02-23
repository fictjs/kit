import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

interface PackageJsonShape {
  version: string
  dependencies?: Record<string, string>
}

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')

describe('version consistency', () => {
  it('keeps internal package ranges aligned across add and create-fict', async () => {
    const kitPackage = await readPackageJson(path.join(REPO_ROOT, 'packages/kit/package.json'))
    const adapterNodePackage = await readPackageJson(
      path.join(REPO_ROOT, 'packages/adapter-node/package.json'),
    )
    const adapterStaticPackage = await readPackageJson(
      path.join(REPO_ROOT, 'packages/adapter-static/package.json'),
    )
    const createTemplatePackage = await readPackageJson(
      path.join(REPO_ROOT, 'packages/create-fict/templates/minimal/package.json'),
    )

    const addSource = await fs.readFile(path.join(REPO_ROOT, 'packages/kit/src/add.ts'), 'utf8')
    const createSource = await fs.readFile(
      path.join(REPO_ROOT, 'packages/create-fict/src/index.ts'),
      'utf8',
    )

    expect(adapterNodePackage.version).toBe(adapterStaticPackage.version)
    expect(addSource).toContain(
      `const INTERNAL_ADAPTER_VERSION_RANGE = '^${adapterNodePackage.version}'`,
    )
    expect(createSource).toContain(`const INTERNAL_FICTJS_VERSION_RANGE = '^${kitPackage.version}'`)
    expect(createTemplatePackage.dependencies?.['@fictjs/kit']).toBe(`^${kitPackage.version}`)
    expect(createTemplatePackage.dependencies?.['@fictjs/adapter-node']).toBe(
      `^${adapterNodePackage.version}`,
    )
  })
})

async function readPackageJson(filePath: string): Promise<PackageJsonShape> {
  return JSON.parse(await fs.readFile(filePath, 'utf8')) as PackageJsonShape
}
