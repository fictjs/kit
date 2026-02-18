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
  it('copies assets and prerenders static routes', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-adapter-static-'))
    dirs.push(root)

    const outDir = path.join(root, 'dist')
    const clientDir = path.join(outDir, 'client')
    const serverDir = path.join(outDir, 'server')

    await fs.mkdir(clientDir, { recursive: true })
    await fs.mkdir(serverDir, { recursive: true })
    await fs.writeFile(path.join(clientDir, 'index.html'), '<html><body><!--app-html--></body></html>')
    await fs.writeFile(path.join(clientDir, 'assets.js'), 'console.log(1)')
    await fs.writeFile(
      path.join(serverDir, 'entry-server.js'),
      [
        'export const routes = [',
        "  { id: 'index', path: '/', module: async () => ({ route: { prerender: true } }) },",
        "  { id: 'about', path: '/about', module: async () => ({ route: { prerender: true } }) },",
        "  { id: 'skip', path: '/skip', module: async () => ({ route: { prerender: false } }) },",
        "  { id: 'users/[id]', path: '/users/:id', module: async () => ({ route: { prerender: true } }) },",
        ']',
        'export async function render(ctx) {',
        "  return '<main>' + ctx.url.pathname + '</main>'",
        '}',
        '',
      ].join('\n'),
    )

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
    await expect(fs.stat(path.join(staticDir, 'about/index.html'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(staticDir, 'skip/index.html'))).rejects.toThrow()
    await expect(fs.stat(path.join(staticDir, 'users/:id/index.html'))).rejects.toThrow()
    await expect(fs.stat(path.join(staticDir, '404.html'))).resolves.toBeDefined()
    await expect(fs.stat(path.join(staticDir, '.fict-adapter-static.json'))).resolves.toBeDefined()

    const aboutHtml = await fs.readFile(path.join(staticDir, 'about/index.html'), 'utf8')
    expect(aboutHtml).toContain('<main>/about</main>')

    const metadata = JSON.parse(
      await fs.readFile(path.join(staticDir, '.fict-adapter-static.json'), 'utf8'),
    ) as { prerenderedPaths: string[] }
    expect(metadata.prerenderedPaths).toEqual(['/', '/about'])
  })

  it('still copies assets when no server entry exists', async () => {
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
  })

  it('skips prerender when global ssr is disabled', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-adapter-static-'))
    dirs.push(root)

    const outDir = path.join(root, 'dist')
    const clientDir = path.join(outDir, 'client')
    const serverDir = path.join(outDir, 'server')

    await fs.mkdir(clientDir, { recursive: true })
    await fs.mkdir(serverDir, { recursive: true })
    await fs.writeFile(path.join(clientDir, 'index.html'), '<html><body><!--app-html--></body></html>')
    await fs.writeFile(path.join(serverDir, 'entry-server.js'), [
      'export const routes = [',
      "  { id: 'about', path: '/about', module: async () => ({ route: { prerender: true } }) },",
      ']',
      'export async function render(ctx) {',
      "  return '<main>' + ctx.url.pathname + '</main>'",
      '}',
      '',
    ].join('\n'))

    const adapter = adapterStatic()
    await adapter.adapt({
      kitConfig: {
        root,
        appRoot: path.join(root, 'src'),
        routesDir: path.join(root, 'src/routes'),
        outDir,
        ssr: { enabled: false, stream: false, resumable: false },
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
    await expect(fs.stat(path.join(staticDir, 'about/index.html'))).rejects.toThrow()

    const metadata = JSON.parse(
      await fs.readFile(path.join(staticDir, '.fict-adapter-static.json'), 'utf8'),
    ) as { prerenderedPaths: string[] }
    expect(metadata.prerenderedPaths).toEqual([])
  })

  it('throws when server entry does not export routes/render', async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'fict-kit-adapter-static-'))
    dirs.push(root)

    const outDir = path.join(root, 'dist')
    const clientDir = path.join(outDir, 'client')
    const serverDir = path.join(outDir, 'server')

    await fs.mkdir(clientDir, { recursive: true })
    await fs.mkdir(serverDir, { recursive: true })
    await fs.writeFile(path.join(clientDir, 'index.html'), '<html></html>')
    await fs.writeFile(path.join(serverDir, 'entry-server.js'), 'export const noop = true\n')

    const adapter = adapterStatic()
    await expect(
      adapter.adapt({
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
      }),
    ).rejects.toThrow('server entry must export { routes, render }')
  })
})
