import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { createServer, type Server } from 'node:http'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'vite'
import { afterEach, describe, expect, it } from 'vitest'

import { adapterNode } from '../../adapter-node/src'
import { adapterStatic } from '../../adapter-static/src'
import { scaffoldProject } from '../../create-fict/src/index'
import type { ResolvedFictKitConfig } from '../src/config'
import { fictKit } from '../src/plugin/fict-kit'

const dirs: string[] = []
const childProcesses: ChildProcess[] = []
const httpServers: Server[] = []

const kitPackageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const fixtureRootBase = path.join(kitPackageRoot, '.tmp-tests')

afterEach(async () => {
  await Promise.allSettled(childProcesses.map(child => stopChildProcess(child)))
  childProcesses.length = 0

  await Promise.allSettled(httpServers.map(server => closeHttpServer(server)))
  httpServers.length = 0

  await Promise.allSettled(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('contracts', () => {
  it(
    'builds create-fict app and serves SSR through adapter-node output',
    async () => {
      const fixtureRoot = await createFixture('contract-node')
      const buildOutput = await buildFixture(fixtureRoot)

      await linkLocalKitPackage(fixtureRoot)

      const port = await getAvailablePort()
      const adapter = adapterNode({ host: '127.0.0.1', port })
      await adapter.adapt({
        kitConfig: createResolvedConfig(fixtureRoot, buildOutput.outDir),
        clientDir: buildOutput.clientDir,
        serverDir: buildOutput.serverDir,
        outDir: buildOutput.outDir,
      })

      const entry = path.join(buildOutput.outDir, 'index.js')
      const child = spawn(process.execPath, [entry], {
        cwd: fixtureRoot,
        env: {
          ...process.env,
          HOST: '127.0.0.1',
          PORT: String(port),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      })
      childProcesses.push(child)

      let logs = ''
      child.stdout?.on('data', chunk => {
        logs += chunk.toString()
      })
      child.stderr?.on('data', chunk => {
        logs += chunk.toString()
      })

      const baseUrl = `http://127.0.0.1:${port}`
      await waitForHttpReady(`${baseUrl}/`, child, () => logs)

      const home = await fetch(`${baseUrl}/`)
      expect(home.status).toBe(200)
      const homeHtml = await home.text()
      expect(homeHtml).toContain('id="__FICT_SNAPSHOT__"')
      expect(homeHtml).toContain('"pathname":"/"')

      const about = await fetch(`${baseUrl}/about`)
      expect(about.status).toBe(200)
      const aboutHtml = await about.text()
      expect(aboutHtml).toContain('"pathname":"/about"')

      const data = await fetch(`${baseUrl}/_fict/data/index?url=%2F`)
      expect(data.status).toBe(200)
      const dataPayload = (await data.json()) as { type: string; routeId: string; data: unknown }
      expect(dataPayload.type).toBe('data')
      expect(dataPayload.routeId).toBe('index')
      expect(dataPayload.data).toBeNull()
    },
    120_000,
  )

  it(
    'builds create-fict app and prerenders static routes with adapter-static output',
    async () => {
      const fixtureRoot = await createFixture('contract-static')
      const buildOutput = await buildFixture(fixtureRoot)

      const adapter = adapterStatic()
      await adapter.adapt({
        kitConfig: createResolvedConfig(fixtureRoot, buildOutput.outDir),
        clientDir: buildOutput.clientDir,
        serverDir: buildOutput.serverDir,
        outDir: buildOutput.outDir,
      })

      const staticDir = path.join(buildOutput.outDir, 'static')
      const aboutFile = path.join(staticDir, 'about', 'index.html')
      await expect(fs.stat(aboutFile)).resolves.toBeDefined()
      const aboutHtml = await fs.readFile(aboutFile, 'utf8')
      expect(aboutHtml).toContain('"pathname":"/about"')

      const dynamicFile = path.join(staticDir, 'users', ':id', 'index.html')
      await expect(fs.stat(dynamicFile)).rejects.toThrow()

      const metadata = JSON.parse(
        await fs.readFile(path.join(staticDir, '.fict-adapter-static.json'), 'utf8'),
      ) as { prerenderedPaths: string[] }
      expect(metadata.prerenderedPaths).toEqual(['/', '/about'])

      const staticServer = await startStaticServer(staticDir)
      const response = await fetch(`${staticServer.baseUrl}/about/`)
      expect(response.status).toBe(200)
      const html = await response.text()
      expect(html).toContain('"pathname":"/about"')
    },
    120_000,
  )
})

async function createFixture(prefix: string): Promise<string> {
  await fs.mkdir(fixtureRootBase, { recursive: true })
  const fixtureRoot = await fs.mkdtemp(path.join(fixtureRootBase, `${prefix}-`))
  dirs.push(fixtureRoot)

  await scaffoldProject(fixtureRoot, { template: 'minimal', yes: true })
  await fs.rm(path.join(fixtureRoot, 'fict.config.ts'), { force: true })
  await writeFixtureRoutes(fixtureRoot)

  return fixtureRoot
}

async function writeFixtureRoutes(fixtureRoot: string): Promise<void> {
  await fs.writeFile(
    path.join(fixtureRoot, 'src', 'routes', 'index.tsx'),
    [
      'export default function HomePage() {',
      '  return (',
      "    <main style={{ padding: '2rem' }}>",
      '      <h1>Fict Kit</h1>',
      '      <p>Contract fixture home</p>',
      '    </main>',
      '  )',
      '}',
      '',
    ].join('\n'),
  )

  await fs.writeFile(
    path.join(fixtureRoot, 'src', 'routes', 'about.tsx'),
    [
      'export default function AboutPage() {',
      '  return (',
      "    <main style={{ padding: '2rem' }}>",
      '      <h1>About</h1>',
      '      <p>Static contract route</p>',
      '    </main>',
      '  )',
      '}',
      '',
    ].join('\n'),
  )

  await fs.writeFile(
    path.join(fixtureRoot, 'src', 'routes', 'users', '[id].tsx'),
    [
      'export default function UserPage() {',
      '  return (',
      "    <main style={{ padding: '2rem' }}>",
      '      <h1>User</h1>',
      '    </main>',
      '  )',
      '}',
      '',
    ].join('\n'),
  )
}

function createResolvedConfig(root: string, outDir: string): ResolvedFictKitConfig {
  return {
    root,
    appRoot: path.join(root, 'src'),
    routesDir: path.join(root, 'src', 'routes'),
    outDir,
    ssr: {
      enabled: true,
      stream: false,
      resumable: true,
    },
    compiler: {},
    devtools: true,
    resumability: {
      events: ['click', 'input', 'change', 'submit'],
      prefetch: {
        visibility: true,
        visibilityMargin: '200px',
        hover: true,
        hoverDelay: 50,
      },
    },
  }
}

async function buildFixture(fixtureRoot: string): Promise<{
  outDir: string
  clientDir: string
  serverDir: string
}> {
  const outDir = path.join(fixtureRoot, 'dist')
  const clientDir = path.join(outDir, 'client')
  const serverDir = path.join(outDir, 'server')

  const plugins = fictKit()
  const alias = {
    '@fictjs/kit/config': path.join(kitPackageRoot, 'src', 'config.ts'),
    '@fictjs/kit/router': path.join(kitPackageRoot, 'src', 'router.ts'),
    '@fictjs/kit/client': path.join(kitPackageRoot, 'src', 'client.ts'),
    '@fictjs/kit/server': path.join(kitPackageRoot, 'src', 'server.ts'),
    '@fictjs/kit/vite': path.join(kitPackageRoot, 'src', 'vite.ts'),
    '@fictjs/kit/env': path.join(kitPackageRoot, 'src', 'env.ts'),
  }

  await build({
    root: fixtureRoot,
    configFile: false,
    plugins,
    resolve: { alias },
    build: {
      outDir: clientDir,
      emptyOutDir: true,
      manifest: true,
      minify: false,
    },
  })

  await build({
    root: fixtureRoot,
    configFile: false,
    plugins,
    resolve: { alias },
    build: {
      outDir: serverDir,
      emptyOutDir: false,
      ssr: 'virtual:fict-kit/entry-server',
      minify: false,
    },
  })

  return { outDir, clientDir, serverDir }
}

async function linkLocalKitPackage(fixtureRoot: string): Promise<void> {
  const scopeDir = path.join(fixtureRoot, 'node_modules', '@fictjs')
  await fs.mkdir(scopeDir, { recursive: true })

  const linkPath = path.join(scopeDir, 'kit')
  try {
    await fs.symlink(kitPackageRoot, linkPath, 'dir')
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException
    if (maybeErr.code !== 'EEXIST') {
      throw error
    }
  }
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve an ephemeral port'))
        return
      }

      const port = address.port
      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function waitForHttpReady(
  url: string,
  child: ChildProcess,
  getLogs: () => string,
): Promise<void> {
  const start = Date.now()
  const timeoutMs = 15_000

  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(
        `Node server exited before becoming ready (code: ${child.exitCode}).\n${getLogs()}`,
      )
    }

    try {
      const response = await fetch(url)
      if (response.status < 500) {
        return
      }
    } catch {
      // Server not listening yet.
    }

    await sleep(150)
  }

  throw new Error(`Timed out waiting for ${url}.\n${getLogs()}`)
}

async function stopChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return
  }

  child.kill('SIGTERM')
  await waitForChildExit(child, 3_000)

  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await waitForChildExit(child, 3_000)
  }
}

function closeHttpServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close(error => {
      if (error) {
        reject(error)
        return
      }
      resolve()
    })
  })
}

async function startStaticServer(rootDir: string): Promise<{ baseUrl: string }> {
  const port = await getAvailablePort()

  const server = createServer(async (req, res) => {
    const rawPath = req.url ?? '/'
    const pathname = decodeURIComponent(rawPath.split('?')[0] ?? '/')
    const filePath = resolveStaticFile(rootDir, pathname)

    if (!filePath) {
      res.statusCode = 404
      res.end('Not Found')
      return
    }

    try {
      const body = await fs.readFile(filePath)
      res.statusCode = 200
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(body)
    } catch {
      res.statusCode = 404
      res.end('Not Found')
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => resolve())
  })

  httpServers.push(server)
  return { baseUrl: `http://127.0.0.1:${port}` }
}

function resolveStaticFile(rootDir: string, pathname: string): string | undefined {
  const clean = pathname.replace(/\/+/g, '/')
  const normalized = clean === '/' ? '/index.html' : clean

  if (normalized.endsWith('/')) {
    return path.join(rootDir, normalized, 'index.html')
  }

  if (path.extname(normalized) !== '') {
    return path.join(rootDir, normalized)
  }

  return path.join(rootDir, normalized, 'index.html')
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      return
    }
    await sleep(50)
  }
}
