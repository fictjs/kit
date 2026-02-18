import {
  createRouter,
  createStaticHistory,
  lazy,
  useRouteData as useRouterRouteData,
  type Location,
  type RouteComponentProps,
  type RouteDefinition,
} from '@fictjs/router'
import type { Component, FictNode } from '@fictjs/runtime'
import { jsx } from '@fictjs/runtime/jsx-runtime'

export interface RouteMeta {
  ssr?: boolean
  stream?: boolean
  prerender?: boolean
  cache?: {
    maxAge?: number
  }
}

export interface RouteModuleExports {
  default?: Component<RouteComponentProps>
  route?: RouteMeta
  load?: (event: unknown) => unknown | Promise<unknown>
  action?: (event: unknown) => unknown | Promise<unknown>
  GET?: (event: unknown) => Response | Promise<Response>
  POST?: (event: unknown) => Response | Promise<Response>
  PUT?: (event: unknown) => Response | Promise<Response>
  DELETE?: (event: unknown) => Response | Promise<Response>
  PATCH?: (event: unknown) => Response | Promise<Response>
}

export interface FileRouteEntry {
  id: string
  path: string
  module: () => Promise<RouteModuleExports>
}

export interface CreateFileRoutesOptions {
  initialData?: Map<string, unknown> | Record<string, unknown>
  dataEndpoint?: string
  fetchData?: ((routeId: string, url: string) => Promise<unknown>) | false
}

export interface FileRoutesProps extends CreateFileRoutesOptions {
  routes: FileRouteEntry[]
  url?: string
}

export function createFileRoutes(
  routes: FileRouteEntry[],
  options: CreateFileRoutesOptions = {},
): RouteDefinition[] {
  const initialData = normalizeInitialData(options.initialData)
  const dataEndpoint = options.dataEndpoint ?? '/_fict/data'

  return routes.map(route => {
    let initialDataConsumed = false

    return {
      key: route.id,
      path: route.path,
      component: lazy(async () => {
        const mod = await route.module()
        const Component = mod.default ?? MissingRouteComponent
        return { default: Component }
      }),
      preload: ({ location }) => {
        if (!initialDataConsumed && initialData.has(route.id)) {
          initialDataConsumed = true
          return initialData.get(route.id)
        }

        if (options.fetchData === false) {
          return undefined
        }

        const target = `${location.pathname}${location.search}${location.hash}`
        if (options.fetchData) {
          return options.fetchData(route.id, target)
        }

        return fetchRouteData({
          routeId: route.id,
          url: target,
          dataEndpoint,
        })
      },
    }
  })
}

export function FileRoutes(props: FileRoutesProps): FictNode {
  const createOptions: CreateFileRoutesOptions = {}
  if (props.initialData !== undefined) createOptions.initialData = props.initialData
  if (props.dataEndpoint !== undefined) createOptions.dataEndpoint = props.dataEndpoint
  if (props.fetchData !== undefined) createOptions.fetchData = props.fetchData

  const routeDefinitions = createFileRoutes(props.routes, createOptions)

  const routerOptions = props.url ? { history: createStaticHistory(props.url) } : undefined
  const router = createRouter(routeDefinitions, routerOptions)

  return jsx(router.Router, {})
}

export function useRouteData<T = unknown>(): () => T | undefined {
  return useRouterRouteData<T>()
}

interface FetchRouteDataOptions {
  routeId: string
  url: string
  dataEndpoint: string
}

async function fetchRouteData(options: FetchRouteDataOptions): Promise<unknown> {
  const requestUrl = `${options.dataEndpoint}/${encodeURIComponent(options.routeId)}?url=${encodeURIComponent(options.url)}`
  const response = await fetch(requestUrl, {
    headers: {
      accept: 'application/json',
    },
  })

  const payload = (await response.json()) as {
    error?: string
    data?: unknown
  }

  if (!response.ok) {
    throw new Error(payload.error ?? `Failed to load route data (${response.status})`)
  }

  if (payload.error) {
    throw new Error(payload.error)
  }

  return payload.data
}

function normalizeInitialData(input?: Map<string, unknown> | Record<string, unknown>): Map<string, unknown> {
  if (!input) return new Map<string, unknown>()
  if (input instanceof Map) return input
  return new Map<string, unknown>(Object.entries(input))
}

function MissingRouteComponent(props: RouteComponentProps): FictNode {
  return jsx('pre', {
    children: `Route module missing default export for ${props.location.pathname}`,
  })
}

export function buildLocationHref(location: Pick<Location, 'pathname' | 'search' | 'hash'>): string {
  return `${location.pathname}${location.search}${location.hash}`
}
