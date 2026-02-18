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
  generateEntryClientCode,
  generateEntryServerCode,
  generateRoutesModuleCode,
} from '../core/routes/virtual-modules'

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
    })
    serverRoutesModule = generateRoutesModuleCode({
      routes,
      root,
      target: 'server',
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
