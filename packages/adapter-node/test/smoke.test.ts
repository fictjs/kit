import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { adapterNode } from '../src'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('adapter-node', () => {
  it('writes a deployable node entry', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-adapter-node-'))
    dirs.push(root)

    const outDir = path.join(root, 'dist')
    const clientDir = path.join(outDir, 'client')
    const serverDir = path.join(outDir, 'server')

    await fs.mkdir(clientDir, { recursive: true })
    await fs.mkdir(serverDir, { recursive: true })
    await fs.writeFile(path.join(serverDir, 'entry-server.js'), 'export const routes = []; export const render = () => ""')

    const adapter = adapterNode()
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

    const outFile = path.join(outDir, 'index.js')
    const source = await fs.readFile(outFile, 'utf8')

    expect(source).toContain("createRequestHandler")
    expect(source).toContain("server.listen")
  })
})
