import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { RouteRecord, RouteSegment } from '../core/routes/types'

export interface SyncGeneratedFilesOptions {
  routes: RouteRecord[]
  outDir: string
}

export interface SyncGeneratedFilesResult {
  outDir: string
  files: string[]
}

export async function syncGeneratedFiles(
  options: SyncGeneratedFilesOptions,
): Promise<SyncGeneratedFilesResult> {
  const outDir = path.resolve(options.outDir)
  await fs.mkdir(outDir, { recursive: true })

  const routesFile = path.join(outDir, 'routes.d.ts')
  const linksFile = path.join(outDir, 'links.d.ts')
  const virtualModulesFile = path.join(outDir, 'virtual-modules.d.ts')
  const envFile = path.join(outDir, 'env.d.ts')
  const files = [routesFile, linksFile, virtualModulesFile, envFile]

  await Promise.all([
    fs.writeFile(routesFile, buildRoutesDeclaration(options.routes)),
    fs.writeFile(linksFile, buildLinksDeclaration(options.routes)),
    fs.writeFile(virtualModulesFile, buildVirtualModulesDeclaration()),
    fs.writeFile(envFile, buildEnvDeclaration()),
  ])

  return {
    outDir,
    files,
  }
}

function buildRoutesDeclaration(routes: RouteRecord[]): string {
  const routeIds = routes.map(route => route.id)
  const routeIdUnion = routeIds.length > 0 ? routeIds.map(id => `'${escapeType(id)}'`).join(' | ') : 'never'

  const routeParamEntries = routes
    .map(route => {
      const params = segmentParamsToType(route.segments)
      return `  '${escapeType(route.id)}': ${params}`
    })
    .join('\n')

  return `export type RouteId = ${routeIdUnion}

export interface RouteParamsMap {
${routeParamEntries}
}
`
}

function buildLinksDeclaration(routes: RouteRecord[]): string {
  const routeIds = routes.map(route => route.id)
  const routeIdUnion = routeIds.length > 0 ? routeIds.map(id => `'${escapeType(id)}'`).join(' | ') : 'never'

  return `import type { RouteParamsMap } from './routes'

export type TypedRouteId = ${routeIdUnion}

export declare function href<T extends TypedRouteId>(id: T, params: RouteParamsMap[T]): string
`
}

function buildVirtualModulesDeclaration(): string {
  return `declare module 'virtual:fict-kit/routes' {
  import type { FileRouteEntry } from '@fictjs/kit/router'

  export const routes: FileRouteEntry[]
  export const routeIds: string[]
  export default routes
}

declare module 'virtual:fict-kit/routes.server' {
  import type { FileRouteEntry } from '@fictjs/kit/router'

  export const routes: FileRouteEntry[]
  export const routeIds: string[]
  export default routes
}

declare module 'virtual:fict-kit/entry-client' {
  export {}
}

declare module 'virtual:fict-kit/entry-server' {
  import type { RequestEvent } from '@fictjs/kit/server'
  import type { RenderContext } from '@fictjs/kit/server'
  import type { FileRouteEntry } from '@fictjs/kit/router'

  export const routes: FileRouteEntry[]
  export const hooks: {
    handle?: (event: RequestEvent, resolve: () => Promise<Response>) => Promise<Response>
    handleError?: (error: unknown, event: RequestEvent) => void
  }
  export function render(ctx: RenderContext): Promise<string> | string
}
`
}

function buildEnvDeclaration(): string {
  return [
    'interface ImportMetaEnv {',
    '  readonly MODE: string',
    '  readonly DEV: boolean',
    '  readonly PROD: boolean',
    '  readonly BASE_URL: string',
    '  readonly SSR: boolean',
    '  readonly [key: `PUBLIC_${string}`]: string | undefined',
    '}',
    '',
    'interface ImportMeta {',
    '  readonly env: ImportMetaEnv',
    '}',
    '',
  ].join('\n')
}

function segmentParamsToType(segments: RouteSegment[]): string {
  const entries: string[] = []

  for (const segment of segments) {
    if (segment.kind === 'param') {
      entries.push(`${segment.name}: string`)
      continue
    }

    if (segment.kind === 'optional-param') {
      entries.push(`${segment.name}?: string`)
      continue
    }

    if (segment.kind === 'rest') {
      entries.push(`${segment.name}: string`)
    }
  }

  return entries.length > 0 ? `{ ${entries.join('; ')} }` : 'Record<string, never>'
}

function escapeType(value: string): string {
  return value.replace(/'/g, "\\'")
}
