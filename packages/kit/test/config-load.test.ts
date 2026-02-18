import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('loadConfig', () => {
  it('throws when explicit config path does not exist', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-config-'))
    dirs.push(root)

    await expect(loadConfig(root, 'missing.config.ts')).rejects.toThrow('Config file not found')
  })

  it('uses defaults when no config file is present and no explicit path is provided', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-config-'))
    dirs.push(root)

    const config = await loadConfig(root)
    expect(config.root).toBe(root)
    expect(config.appRoot).toBe(path.join(root, 'src'))
    expect(config.routesDir).toBe(path.join(root, 'src/routes'))
  })
})
