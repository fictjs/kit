import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

import type { Adapter, AdapterContext } from '@fictjs/kit'
import {
  createRequestHandler,
  type HandlerOptions,
  type RenderContext,
  type ServerRouteEntry,
} from '@fictjs/kit/server'

export interface AdapterStaticOptions {
  outDir?: string
  fallback?: string
  prerender?: boolean
  serverEntry?: string
}

export function adapterStatic(options: AdapterStaticOptions = {}): Adapter {
  return {
    name: '@fictjs/adapter-static',
    async adapt(context) {
      const targetDir = resolveTargetDir(context, options.outDir)

      await fs.rm(targetDir, { recursive: true, force: true })
      await copyDirectory(context.clientDir, targetDir)

      const prerenderedPaths =
        options.prerender === false
          ? []
          : await prerenderStaticPages(context, targetDir, options.serverEntry)

      const fallbackTarget = options.fallback ?? '404.html'
      const indexHtml = path.join(targetDir, 'index.html')
      const fallbackHtml = path.join(targetDir, fallbackTarget)

      if (await pathExists(indexHtml) && !(await pathExists(fallbackHtml))) {
        await fs.mkdir(path.dirname(fallbackHtml), { recursive: true })
        await fs.copyFile(indexHtml, fallbackHtml)
      }

      const metadata = {
        adapter: '@fictjs/adapter-static',
        generatedAt: new Date().toISOString(),
        sourceClientDir: context.clientDir,
        prerenderedPaths,
      }

      await fs.writeFile(
        path.join(targetDir, '.fict-adapter-static.json'),
        `${JSON.stringify(metadata, null, 2)}\n`,
      )
    },
  }
}

export default adapterStatic

function resolveTargetDir(context: AdapterContext, outDir?: string): string {
  if (!outDir) {
    return path.join(context.outDir, 'static')
  }

  return path.isAbsolute(outDir) ? outDir : path.join(context.outDir, outDir)
}

async function copyDirectory(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true })
  const entries = await fs.readdir(from, { withFileTypes: true })

  for (const entry of entries) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)

    if (entry.isDirectory()) {
      await copyDirectory(source, target)
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(source, target)
    }
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function prerenderStaticPages(
  context: AdapterContext,
  targetDir: string,
  requestedServerEntry?: string,
): Promise<string[]> {
  if (!context.kitConfig.ssr.enabled) {
    return []
  }

  const serverEntryCandidates = await resolveServerEntryCandidates(context, requestedServerEntry)
  if (serverEntryCandidates.length === 0) {
    return []
  }

  const templatePath = path.join(context.clientDir, 'index.html')
  if (!(await pathExists(templatePath))) {
    return []
  }
  const template = await fs.readFile(templatePath, 'utf8')

  const serverEntry = await loadServerEntry(serverEntryCandidates)

  const hooks = normalizeHooks(serverEntry.hooks)
  const handlerOptions: HandlerOptions = {
    mode: 'prod',
    routes: serverEntry.routes,
    getTemplate: () => template,
    render: serverEntry.render,
  }
  if (hooks) {
    handlerOptions.hooks = hooks
  }

  const handler = createRequestHandler(handlerOptions)
  const routePaths = await resolvePrerenderPaths(serverEntry.routes)
  const renderedPaths: string[] = []

  for (const routePath of routePaths) {
    const request = new Request(`http://fict.static${routePath}`)
    const response = await handler(request)

    if (!response.ok) continue
    const contentType = response.headers.get('content-type') ?? ''
    if (!contentType.includes('text/html')) continue

    const html = await response.text()
    const outFile = toStaticHtmlFile(targetDir, routePath)
    await fs.mkdir(path.dirname(outFile), { recursive: true })
    await fs.writeFile(outFile, html)
    renderedPaths.push(routePath)
  }

  return renderedPaths
}

async function resolvePrerenderPaths(routes: ServerRouteEntry[]): Promise<string[]> {
  const paths = new Set<string>()

  for (const route of routes) {
    if (!isStaticRoutePath(route.path)) {
      continue
    }

    const mod = await route.module()
    if (mod.route?.prerender === false) {
      continue
    }

    paths.add(normalizeRoutePath(route.path))
  }

  return [...paths].sort((left, right) => left.localeCompare(right))
}

function isStaticRoutePath(routePath: string): boolean {
  return !routePath.includes(':') && !routePath.includes('*') && !routePath.includes('?')
}

function normalizeRoutePath(routePath: string): string {
  const withLeadingSlash = routePath.startsWith('/') ? routePath : `/${routePath}`
  const normalized = withLeadingSlash.replace(/\/+$/g, '')
  return normalized.length === 0 ? '/' : normalized
}

function toStaticHtmlFile(targetDir: string, routePath: string): string {
  if (routePath === '/') {
    return path.join(targetDir, 'index.html')
  }

  const normalized = routePath.replace(/^\/+/, '').replace(/\/+$/g, '')
  return path.join(targetDir, normalized, 'index.html')
}

async function resolveServerEntryCandidates(
  context: AdapterContext,
  requested?: string,
): Promise<string[]> {
  if (requested) {
    const absolute = path.isAbsolute(requested) ? requested : path.join(context.outDir, requested)
    return [absolute]
  }

  const expected = path.join(context.serverDir, 'entry-server.js')
  if (await pathExists(expected)) {
    return [expected]
  }

  const entries = await readDirSafe(context.serverDir)
  const jsEntries = entries
    .filter(entry => entry.endsWith('.js'))
    .sort((left, right) => left.localeCompare(right))

  return jsEntries.map(entry => path.join(context.serverDir, entry))
}

async function readDirSafe(dirPath: string): Promise<string[]> {
  try {
    return await fs.readdir(dirPath)
  } catch {
    return []
  }
}

interface ServerEntryModule {
  routes?: ServerRouteEntry[]
  render?: (ctx: RenderContext) => Promise<string> | string
  hooks?: HandlerOptions['hooks']
}

function normalizeHooks(input: unknown): HandlerOptions['hooks'] | undefined {
  if (!input || typeof input !== 'object') {
    return undefined
  }

  const hooksValue = input as {
    handle?: unknown
    handleError?: unknown
  }
  type HandleHook = NonNullable<NonNullable<HandlerOptions['hooks']>['handle']>
  type HandleErrorHook = NonNullable<NonNullable<HandlerOptions['hooks']>['handleError']>

  const hooks: NonNullable<HandlerOptions['hooks']> = {}
  if (typeof hooksValue.handle === 'function') {
    hooks.handle = hooksValue.handle as HandleHook
  }
  if (typeof hooksValue.handleError === 'function') {
    hooks.handleError = hooksValue.handleError as HandleErrorHook
  }

  return hooks.handle || hooks.handleError ? hooks : undefined
}

async function loadServerEntry(candidates: string[]): Promise<{
  routes: ServerRouteEntry[]
  render: (ctx: RenderContext) => Promise<string> | string
  hooks?: HandlerOptions['hooks']
}> {
  const invalidCandidates: string[] = []

  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) {
      continue
    }

    const loaded = (await import(pathToFileURL(candidate).href)) as ServerEntryModule
    if (Array.isArray(loaded.routes) && typeof loaded.render === 'function') {
      return {
        routes: loaded.routes,
        render: loaded.render,
        hooks: loaded.hooks,
      }
    }

    invalidCandidates.push(candidate)
  }

  const reason =
    invalidCandidates.length > 0
      ? `Checked: ${invalidCandidates.join(', ')}`
      : 'No server entry candidates were found.'
  throw new Error(`[adapter-static] server entry must export { routes, render }. ${reason}`)
}
