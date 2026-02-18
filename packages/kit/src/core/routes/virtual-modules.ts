import path from 'node:path'

import type { ResumabilityConfig } from '../../config'

import type { RouteRecord } from './types'

export const VIRTUAL_ROUTES_CLIENT = 'virtual:fict-kit/routes'
export const VIRTUAL_ROUTES_SERVER = 'virtual:fict-kit/routes.server'
export const VIRTUAL_ENTRY_CLIENT = 'virtual:fict-kit/entry-client'
export const VIRTUAL_ENTRY_SERVER = 'virtual:fict-kit/entry-server'

export interface PickPlan {
  client: string[]
  server: string[]
}

export function getDefaultPickPlan(): PickPlan {
  return {
    client: ['default', 'route', '$css'],
    server: ['default', 'route', 'load', 'action', 'GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  }
}

export function generateRoutesModuleCode(args: {
  routes: RouteRecord[]
  root: string
  target: 'client' | 'server'
  pickPlan?: PickPlan
}): string {
  const picks = (args.pickPlan ?? getDefaultPickPlan())[args.target]

  const items = args.routes.map(route => {
    const moduleId = buildPickModuleId(route.file, args.root, picks)

    return `{
      id: ${JSON.stringify(route.id)},
      path: ${JSON.stringify(route.routePath)},
      module: () => import(${JSON.stringify(moduleId)})
    }`
  })

  return `
export const routes = [
${items.join(',\n')}
]

export const routeIds = routes.map(route => route.id)

export default routes
`
}

export function generateEntryClientCode(resumability: ResumabilityConfig): string {
  const options = JSON.stringify(resumability, null, 2)
  return `
import { setupClientRuntime } from '@fictjs/kit/client'

void setupClientRuntime(${options})
`
}

export function generateEntryServerCode(): string {
  return `
import { renderToString } from '@fictjs/ssr'
import { jsx } from '@fictjs/runtime/jsx-runtime'

import { FileRoutes } from '@fictjs/kit/router'
import routes from 'virtual:fict-kit/routes.server'

export { routes }

export function render(input) {
  const url = typeof input.url === 'string'
    ? input.url
    : input.url.pathname + input.url.search + input.url.hash

  return renderToString(
    () => jsx(FileRoutes, {
      routes,
      url,
      initialData: input.routeData,
    }),
    {
      includeSnapshot: true,
      includeContainer: true,
      containerId: 'app',
    },
  )
}
`
}

export function buildPickModuleId(file: string, root: string, picks: string[]): string {
  const importPath = toViteImportPath(file, root)
  const query = picks.map(pick => `pick=${encodeURIComponent(pick)}`).join('&')
  return `${importPath}?${query}`
}

export function toViteImportPath(file: string, root: string): string {
  const normalizedFile = normalizeSlashes(path.resolve(file))
  const normalizedRoot = normalizeSlashes(path.resolve(root))

  if (normalizedFile.startsWith(`${normalizedRoot}/`)) {
    const relative = normalizedFile.slice(normalizedRoot.length)
    return relative.startsWith('/') ? relative : `/${relative}`
  }

  return `/@fs/${normalizedFile}`
}

function normalizeSlashes(input: string): string {
  return input.replace(/\\/g, '/')
}
