import { promises as fs } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'

import fict from '@fictjs/vite-plugin'
import type { Plugin, PluginOption, ViteDevServer } from 'vite'

import { loadConfig, type ResolvedFictKitConfig } from '../config'
import { kitTreeShake } from '../core/picks/tree-shake'
import { assertNoRouteErrors, scanRoutes } from '../core/routes/scan'
import type { RouteRecord } from '../core/routes/types'
import {
  VIRTUAL_ENTRY_CLIENT,
  VIRTUAL_ENTRY_SERVER,
  VIRTUAL_ROUTES_CLIENT,
  VIRTUAL_ROUTES_SERVER,
  buildPickModuleId,
  generateEntryClientCode,
  generateEntryServerCode,
  generateRoutesModuleCode,
  getDefaultPickPlan,
} from '../core/routes/virtual-modules'
import type { RouteModuleExports } from '../router'
import { createRequestHandler, type RenderContext, type ServerRouteEntry } from '../server'

export interface FictKitPluginOptions {
  config?: string
  compiler?: Record<string, unknown>
}

export function fictKit(options: FictKitPluginOptions = {}): PluginOption[] {
  let root = process.cwd()
  let routes: RouteRecord[] = []
  let kitConfig: ResolvedFictKitConfig | undefined
  let clientRoutesModule = 'export default []'
  let serverRoutesModule = 'export default []'
  let entryClientModule = 'export {}'
  let entryServerModule = 'export {}'

  const pickPlan = getDefaultPickPlan()

  const ensureKitConfig = async (cwd: string): Promise<ResolvedFictKitConfig> => {
    if (!kitConfig || kitConfig.root !== cwd) {
      kitConfig = await loadConfig(cwd, options.config)
    }
    return kitConfig
  }

  const rebuildRoutes = async (): Promise<void> => {
    if (!kitConfig) {
      return
    }

    const result = await scanRoutes({ routesDir: kitConfig.routesDir })
    assertNoRouteErrors(result.diagnostics)

    routes = result.routes
    clientRoutesModule = generateRoutesModuleCode({
      routes,
      root,
      target: 'client',
      pickPlan,
    })
    serverRoutesModule = generateRoutesModuleCode({
      routes,
      root,
      target: 'server',
      pickPlan,
    })
    entryClientModule = generateEntryClientCode(kitConfig.resumability)
    entryServerModule = generateEntryServerCode()
  }

  const setupWatcher = async (server: ViteDevServer) => {
    if (!kitConfig) return

    server.watcher.add(kitConfig.routesDir)
    server.watcher.on('all', async (_event, file) => {
      const routesRoot = normalizeSlashes(path.resolve(kitConfig!.routesDir))
      const changedFile = normalizeSlashes(path.resolve(file))
      if (!changedFile.startsWith(routesRoot)) {
        return
      }

      await rebuildRoutes()
      invalidateVirtualModule(server, VIRTUAL_ROUTES_CLIENT)
      invalidateVirtualModule(server, VIRTUAL_ROUTES_SERVER)
      invalidateVirtualModule(server, VIRTUAL_ENTRY_CLIENT)
      invalidateVirtualModule(server, VIRTUAL_ENTRY_SERVER)
      server.ws.send({ type: 'full-reload', path: '*' })
    })
  }

  const setupDevMiddleware = (server: ViteDevServer) => {
    server.middlewares.use(async (req, res, next) => {
      if (!kitConfig) {
        return next()
      }

      const rawUrl = req.originalUrl ?? req.url ?? '/'
      const parsedUrl = new URL(rawUrl, 'http://fict.local')

      if (!shouldHandleKitRequest(req, parsedUrl)) {
        return next()
      }

      try {
        const entryModule = await server.ssrLoadModule(VIRTUAL_ENTRY_SERVER)
        const render = resolveRender(entryModule)

        const handler = createRequestHandler({
          mode: 'dev',
          routes: createDevServerRouteEntries(server, routes, root, pickPlan.server),
          getTemplate: async url => {
            const templatePath = path.resolve(root, 'index.html')
            const template = await fs.readFile(templatePath, 'utf8')
            return server.transformIndexHtml(`${url.pathname}${url.search}`, template)
          },
          render,
        })

        const webRequest = await toWebRequest(req, parsedUrl)
        const webResponse = await handler(webRequest)
        await writeWebResponse(res, webResponse)
      } catch (error) {
        if (error instanceof Error) {
          server.ssrFixStacktrace(error)
        }
        return next(error as Error)
      }
    })
  }

  const corePlugin: Plugin = {
    name: 'fict-kit:core',
    enforce: 'pre',
    async config(rawConfig) {
      root = path.resolve(rawConfig.root ?? process.cwd())
      const resolvedConfig = await ensureKitConfig(root)

      return {
        resolve: {
          alias: {
            '~': resolvedConfig.appRoot,
          },
        },
      }
    },
    async configResolved(resolvedConfig) {
      root = path.resolve(resolvedConfig.root)
      await ensureKitConfig(root)
      await rebuildRoutes()
    },
    async buildStart() {
      await ensureKitConfig(root)
      await rebuildRoutes()
    },
    async configureServer(server) {
      root = path.resolve(server.config.root)
      await ensureKitConfig(root)
      await rebuildRoutes()
      installDevManifestProxy(root)
      await setupWatcher(server)
      setupDevMiddleware(server)
    },
    resolveId(id) {
      if (
        id === VIRTUAL_ROUTES_CLIENT ||
        id === VIRTUAL_ROUTES_SERVER ||
        id === VIRTUAL_ENTRY_CLIENT ||
        id === VIRTUAL_ENTRY_SERVER
      ) {
        return id
      }

      return null
    },
    load(id) {
      if (id === VIRTUAL_ROUTES_CLIENT) return clientRoutesModule
      if (id === VIRTUAL_ROUTES_SERVER) return serverRoutesModule
      if (id === VIRTUAL_ENTRY_CLIENT) return entryClientModule
      if (id === VIRTUAL_ENTRY_SERVER) return entryServerModule
      return null
    },
  }

  return [
    corePlugin,
    kitTreeShake(),
    fict({
      resumable: true,
      ...(options.compiler ?? {}),
    }),
  ]
}

function createDevServerRouteEntries(
  server: ViteDevServer,
  routes: RouteRecord[],
  root: string,
  serverPicks: string[],
): ServerRouteEntry[] {
  return routes.map(route => {
    const moduleId = buildPickModuleId(route.file, root, serverPicks)
    return {
      id: route.id,
      path: route.routePath,
      module: async () => {
        return (await server.ssrLoadModule(moduleId)) as RouteModuleExports
      },
    }
  })
}

function resolveRender(entryModule: Record<string, unknown>): (ctx: RenderContext) => Promise<string> {
  const render = entryModule.render
  if (typeof render !== 'function') {
    throw new Error('[fict-kit] virtual:fict-kit/entry-server must export render(ctx).')
  }

  return async context => {
    return String(await render(context))
  }
}

function shouldHandleKitRequest(
  req: IncomingMessage & { originalUrl?: string | undefined },
  url: URL,
): boolean {
  if (url.pathname.startsWith('/_fict/data/') || url.pathname.startsWith('/_fict/action/')) {
    return true
  }

  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') {
    return true
  }

  const pathname = url.pathname
  if (
    pathname.startsWith('/@') ||
    pathname.startsWith('/__vite') ||
    pathname.startsWith('/node_modules') ||
    pathname.startsWith('/__fict-devtools__') ||
    pathname === '/favicon.ico'
  ) {
    return false
  }

  const base = path.posix.basename(pathname)
  if (base.includes('.')) {
    return false
  }

  const accept = req.headers.accept ?? ''
  return accept.includes('text/html') || accept.includes('*/*')
}

async function toWebRequest(
  req: IncomingMessage & { originalUrl?: string | undefined },
  url: URL,
): Promise<Request> {
  const method = (req.method ?? 'GET').toUpperCase()
  const headers = new Headers()

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '))
    } else {
      headers.set(key, value)
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    return new Request(url.href, { method, headers })
  }

  const body = await readIncomingMessage(req)
  const arrayBuffer = body.buffer.slice(
    body.byteOffset,
    body.byteOffset + body.byteLength,
  ) as ArrayBuffer
  return new Request(url.href, {
    method,
    headers,
    body: arrayBuffer,
  })
}

async function readIncomingMessage(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []

  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
  }

  return Buffer.concat(chunks)
}

async function writeWebResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status

  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  if (!response.body) {
    res.end()
    return
  }

  const body = Buffer.from(await response.arrayBuffer())
  res.end(body)
}

function installDevManifestProxy(root: string): void {
  const globalState = globalThis as Record<string, unknown>
  const existing = globalState.__FICT_MANIFEST__

  if (!existing || typeof existing !== 'object') {
    globalState.__FICT_MANIFEST__ = new Proxy(
      {},
      {
        get(_target, key) {
          if (typeof key !== 'string') return undefined
          if (key.startsWith('virtual:fict-handler:')) {
            return `/@id/${key}`
          }
          return undefined
        },
      },
    )
  }

  globalState.__FICT_SSR_BASE__ = root
}

function invalidateVirtualModule(server: ViteDevServer, id: string): void {
  const module = server.moduleGraph.getModuleById(id)
  if (!module) return
  server.moduleGraph.invalidateModule(module)
}

function normalizeSlashes(input: string): string {
  return input.replace(/\\/g, '/')
}
