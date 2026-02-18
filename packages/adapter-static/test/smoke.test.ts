import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { adapterStatic } from '../src'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('adapter-static', () => {
  it('copies client assets into static output', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-adapter-static-'))
    dirs.push(root)

    const outDir = path.join(root, 'dist')
    const clientDir = path.join(outDir, 'client')
    const serverDir = path.join(outDir, 'server')

    await fs.mkdir(clientDir, { recursive: true })
    await fs.mkdir(serverDir, { recursive: true })
    await fs.writeFile(path.join(clientDir, 'index.html'), '<html></html>')
    await fs.writeFile(path.join(clientDir, 'assets.js'), 'console.log(1)')

    const adapter = adapterStatic()
    await adapter.adapt({
      kitConfig: {
        root,
        appRoot: path.join(root, 'src'),
        routesDir: path.join(root, 'src/routes'),
        outDir,
        ssr: { enabled: true, stream: false, resumable: true },
        compiler: {},
        devtools: true,
        resumability: {
          events: ['click'],
          prefetch: { visibility: true, visibilityMargin: '200px', hover: true, hoverDelay: 50 },
        },
      },
      clientDir,
      serverDir,
      outDir,
    })

    const staticDir = path.join(outDir, 'static')
    await expect(fs.stat(path.join(staticDir, 'index.html'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(staticDir, 'assets.js'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(staticDir, '404.html'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(staticDir, '.fict-adapter-static.json'))).resolves.toBeDefined()
  })
})
