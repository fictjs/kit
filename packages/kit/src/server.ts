import {
  compileRoute,
  createBranches,
  matchRoutes,
  normalizePath,
  type RouteBranch,
  type RouteDefinition,
  type RouteMatch,
} from '@fictjs/router'

import type { FileRouteEntry, RouteModuleExports } from './router'

const DATA_PREFIX = '/_fict/data/'
const ACTION_PREFIX = '/_fict/action/'

export interface RequestEventBase {
  request: Request
  url: URL
  params: Record<string, string | undefined>
  locals: Record<string, unknown>
  fetch: typeof fetch
  setHeaders: (headers: HeadersInit) => void
  setStatus: (status: number) => void
}

export type RequestEvent = RequestEventBase & { kind: 'request' }
export type LoadEvent = RequestEventBase & { kind: 'load' }
export type ActionEvent = RequestEventBase & { kind: 'action' }

export interface ServerRouteEntry extends Pick<FileRouteEntry, 'id' | 'path'> {
  module: () => Promise<RouteModuleExports>
}

export interface RenderContext {
  request: Request
  url: URL
  matches: RouteMatch[]
  routeData: Map<string, unknown>
  locals: Record<string, unknown>
}

export type RenderFn = (context: RenderContext) => Promise<string> | string
export type TemplateFn = (url: URL) => Promise<string> | string

export interface HandlerOptions {
  mode: 'dev' | 'prod'
  routes: ServerRouteEntry[]
  getTemplate: TemplateFn
  render: RenderFn
  hooks?: {
    handle?: (event: RequestEvent, resolve: () => Promise<Response>) => Promise<Response>
    handleError?: (error: unknown, event: RequestEvent) => void
  }
}

export interface RedirectResult {
  type: 'redirect'
  location: string
  status: number
  headers?: HeadersInit
}

export function redirect(
  statusOrLocation: number | string,
  locationOrHeaders?: string | HeadersInit,
  maybeHeaders?: HeadersInit,
): RedirectResult {
  if (typeof statusOrLocation === 'string') {
    const result: RedirectResult = {
      type: 'redirect',
      location: statusOrLocation,
      status: 302,
    }
    if (locationOrHeaders !== undefined) {
      result.headers = locationOrHeaders as HeadersInit
    }
    return result
  }

  const result: RedirectResult = {
    type: 'redirect',
    location: String(locationOrHeaders),
    status: statusOrLocation,
  }
  if (maybeHeaders !== undefined) {
    result.headers = maybeHeaders
  }
  return result
}

export function createRequestHandler(options: HandlerOptions) {
  const routeMap = new Map(options.routes.map(route => [route.id, route] as const))
  const branches = createRouteBranches(options.routes)

  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url)

    const locals: Record<string, unknown> = {}
    const responseHeaders = new Headers()
    let responseStatus = 200

    const setHeaders = (headers: HeadersInit) => {
      const next = new Headers(headers)
      next.forEach((value, key) => responseHeaders.set(key, value))
    }

    const setStatus = (status: number) => {
      responseStatus = status
    }

    const baseEvent: RequestEvent = {
      kind: 'request',
      request,
      url,
      params: {},
      locals,
      fetch: createEventFetch(request),
      setHeaders,
      setStatus,
    }

    const resolve = async () => {
      if (isDataRequest(url)) {
        return handleDataRequest({
          routeMap,
          branches,
          event: { ...baseEvent, kind: 'load' },
          routeId: getRequestedRouteId(url, DATA_PREFIX),
        })
      }

      if (isActionRequest(url)) {
        return handleActionRequest({
          routeMap,
          branches,
          event: { ...baseEvent, kind: 'action' },
          routeId: getRequestedRouteId(url, ACTION_PREFIX),
        })
      }

      const matches = matchRoutes(branches, normalizePath(url.pathname)) ?? []

      const apiResponse = await maybeHandleApiRoute({
        request,
        event: baseEvent,
        matches,
        routeMap,
      })
      if (apiResponse) {
        return apiResponse
      }

      const leafRouteMeta = await resolveLeafRouteMeta({
        matches,
        routeMap,
      })
      applyCacheMeta(responseHeaders, leafRouteMeta)

      if (leafRouteMeta?.ssr === false) {
        const template = await options.getTemplate(url)
        const payload = template.includes('<!--app-html-->')
          ? template.replace('<!--app-html-->', '')
          : template

        const headers = new Headers(responseHeaders)
        headers.set('content-type', 'text/html; charset=utf-8')
        return new Response(payload, { status: responseStatus, headers })
      }

      const routeData = await loadMatchedRouteData({
        event: baseEvent,
        matches,
        routeMap,
        handleError: options.hooks?.handleError,
      })
      if (routeData instanceof Response) {
        return routeData
      }

      const template = await options.getTemplate(url)
      const html = await options.render({
        request,
        url,
        matches,
        routeData,
        locals,
      })

      const payload = template.includes('<!--app-html-->')
        ? template.replace('<!--app-html-->', () => html)
        : html

      const headers = new Headers(responseHeaders)
      headers.set('content-type', 'text/html; charset=utf-8')
      return new Response(payload, { status: responseStatus, headers })
    }

    const respondInternalError = (error: unknown): Response => {
      options.hooks?.handleError?.(error, baseEvent)

      if (isDataRequest(url)) {
        return json({ type: 'data', error: 'internal_error' }, 500)
      }

      if (isActionRequest(url)) {
        return json({ type: 'action', error: 'internal_error' }, 500)
      }

      const accept = request.headers.get('accept') ?? ''
      const isJsonRequest = accept.includes('application/json')
      const method = request.method.toUpperCase()
      const isMutation = method !== 'GET' && method !== 'HEAD'
      if (isJsonRequest || isMutation) {
        return json({ error: 'internal_error' }, 500)
      }

      return new Response('Internal Server Error', { status: 500 })
    }

    const runResolve = async (): Promise<Response> => {
      try {
        return await resolve()
      } catch (error) {
        return respondInternalError(error)
      }
    }

    if (options.hooks?.handle) {
      try {
        return await options.hooks.handle(baseEvent, runResolve)
      } catch (error) {
        return respondInternalError(error)
      }
    }

    return runResolve()
  }
}

async function loadMatchedRouteData(input: {
  event: RequestEvent
  matches: RouteMatch[]
  routeMap: Map<string, ServerRouteEntry>
  handleError: ((error: unknown, event: RequestEvent) => void) | undefined
}): Promise<Map<string, unknown> | Response> {
  const routeData = new Map<string, unknown>()

  for (const match of input.matches) {
    const routeId = getRouteId(match)
    if (!routeId) continue

    const entry = input.routeMap.get(routeId)
    if (!entry) continue

    const mod = await entry.module()
    if (!mod.load) continue

    try {
      const data = await mod.load({
        ...input.event,
        kind: 'load',
        params: match.params,
      })
      routeData.set(routeId, data)
    } catch (error) {
      input.handleError?.(error, input.event)
      return new Response('Internal Server Error', { status: 500 })
    }
  }

  return routeData
}

async function maybeHandleApiRoute(input: {
  request: Request
  event: RequestEvent
  matches: RouteMatch[]
  routeMap: Map<string, ServerRouteEntry>
}): Promise<Response | null> {
  const leaf = input.matches[input.matches.length - 1]
  if (!leaf) return null

  const routeId = getRouteId(leaf)
  if (!routeId) return null

  const entry = input.routeMap.get(routeId)
  if (!entry) return null

  const mod = await entry.module()
  const handler = getMethodHandler(mod, input.request.method)
  if (!handler) {
    return null
  }

  const accept = input.request.headers.get('accept') ?? ''
  const wantsHtml = accept.includes('text/html')
  const isMutation = input.request.method !== 'GET' && input.request.method !== 'HEAD'
  const shouldTreatAsApi = isMutation || !wantsHtml
  if (!shouldTreatAsApi) {
    return null
  }

  return handler({
    ...input.event,
    params: leaf.params,
  })
}

async function handleDataRequest(input: {
  routeMap: Map<string, ServerRouteEntry>
  branches: RouteBranch[]
  event: LoadEvent
  routeId: string | undefined
}): Promise<Response> {
  const target = resolveTargetUrl(input.event.url)
  const matches = matchRoutes(input.branches, normalizePath(target.pathname))
  if (!matches || matches.length === 0) {
    return json({ type: 'data', error: 'no_match' }, 404)
  }

  const leaf = matches[matches.length - 1]
  const leafId = leaf ? getRouteId(leaf) : undefined
  const routeId = input.routeId ?? leafId

  if (!routeId) {
    return json({ type: 'data', error: 'unknown_route' }, 404)
  }

  const entry = input.routeMap.get(routeId)
  if (!entry) {
    return json({ type: 'data', error: 'unknown_route', routeId }, 404)
  }

  if (leafId && leafId !== routeId) {
    return json({ type: 'data', error: 'route_mismatch', routeId, leafId }, 400)
  }

  const module = await entry.module()
  if (!module.load) {
    return json({ type: 'data', routeId, data: null }, 200)
  }

  const headers = new Headers()
  let status = 200

  const data = await module.load({
    ...input.event,
    params: leaf?.params ?? {},
    url: target,
    setHeaders(next: HeadersInit) {
      const values = new Headers(next)
      values.forEach((value, key) => headers.set(key, value))
    },
    setStatus(nextStatus: number) {
      status = nextStatus
    },
  })

  return json({ type: 'data', routeId, data }, status, headers)
}

async function handleActionRequest(input: {
  routeMap: Map<string, ServerRouteEntry>
  branches: RouteBranch[]
  event: ActionEvent
  routeId: string | undefined
}): Promise<Response> {
  const target = resolveTargetUrl(input.event.url)
  const matches = matchRoutes(input.branches, normalizePath(target.pathname))
  if (!matches || matches.length === 0) {
    return json({ type: 'action', error: 'no_match' }, 404)
  }

  const leaf = matches[matches.length - 1]
  const leafId = leaf ? getRouteId(leaf) : undefined
  const routeId = input.routeId ?? leafId

  if (!routeId) {
    return json({ type: 'action', error: 'unknown_route' }, 404)
  }

  const entry = input.routeMap.get(routeId)
  if (!entry) {
    return json({ type: 'action', error: 'unknown_route', routeId }, 404)
  }

  if (leafId && leafId !== routeId) {
    return json({ type: 'action', error: 'route_mismatch', routeId, leafId }, 400)
  }

  const module = await entry.module()
  const action = module.action ?? getMethodHandler(module, input.event.request.method)
  if (!action) {
    return json({ type: 'action', routeId, data: null }, 200)
  }

  const headers = new Headers()
  let status = 200

  const result = await action({
    ...input.event,
    params: leaf?.params ?? {},
    url: target,
    setHeaders(next: HeadersInit) {
      const values = new Headers(next)
      values.forEach((value, key) => headers.set(key, value))
    },
    setStatus(nextStatus: number) {
      status = nextStatus
    },
  })

  if (result instanceof Response) {
    return result
  }

  if (isRedirectResult(result)) {
    const redirectHeaders = new Headers(result.headers)
    redirectHeaders.set('location', result.location)
    return new Response(null, { status: result.status, headers: redirectHeaders })
  }

  if (isRedirectShape(result)) {
    const redirectHeaders = new Headers(result.headers)
    redirectHeaders.set('location', result.location)
    return new Response(null, { status: result.status ?? 302, headers: redirectHeaders })
  }

  return json({ type: 'action', routeId, data: result }, status, headers)
}

function getMethodHandler(
  module: RouteModuleExports,
  method: string,
): ((event: unknown) => Response | Promise<Response>) | undefined {
  const upper = method.toUpperCase()
  if (upper === 'GET') return module.GET
  if (upper === 'POST') return module.POST
  if (upper === 'PUT') return module.PUT
  if (upper === 'DELETE') return module.DELETE
  if (upper === 'PATCH') return module.PATCH
  return undefined
}

function isDataRequest(url: URL): boolean {
  return url.pathname.startsWith(DATA_PREFIX) || url.searchParams.has('__fict_data')
}

function isActionRequest(url: URL): boolean {
  return url.pathname.startsWith(ACTION_PREFIX) || url.searchParams.has('__fict_action')
}

function getRequestedRouteId(url: URL, prefix: string): string | undefined {
  if (url.pathname.startsWith(prefix)) {
    return decodeURIComponent(url.pathname.slice(prefix.length))
  }

  const key = prefix === DATA_PREFIX ? '__fict_data' : '__fict_action'
  const value = url.searchParams.get(key)
  if (!value || value === '1' || value === 'true') {
    return undefined
  }
  return value
}

function getRouteId(match: RouteMatch): string | undefined {
  const key = (match.route as RouteDefinition).key
  return typeof key === 'string' ? key : undefined
}

function createRouteBranches(routes: ServerRouteEntry[]): RouteBranch[] {
  const definitions: RouteDefinition[] = routes.map(route => ({
    key: route.id,
    path: route.path,
  }))

  return createBranches(definitions.map(route => compileRoute(route)))
}

function resolveTargetUrl(url: URL): URL {
  const raw = url.searchParams.get('url')
  if (!raw) {
    return url
  }

  try {
    return new URL(raw, url.origin)
  } catch {
    return url
  }
}

function createEventFetch(request: Request): typeof fetch {
  return (input, init) => {
    const headers = new Headers(init?.headers)

    const cookie = request.headers.get('cookie')
    if (cookie && !headers.has('cookie')) {
      headers.set('cookie', cookie)
    }

    const authorization = request.headers.get('authorization')
    if (authorization && !headers.has('authorization')) {
      headers.set('authorization', authorization)
    }

    return fetch(input, {
      ...init,
      headers,
    })
  }
}

function json(body: unknown, status = 200, extraHeaders?: Headers): Response {
  const headers = new Headers(extraHeaders)
  headers.set('content-type', 'application/json; charset=utf-8')
  return new Response(JSON.stringify(body), { status, headers })
}

function isRedirectResult(value: unknown): value is RedirectResult {
  if (!value || typeof value !== 'object') return false
  const candidate = value as RedirectResult
  return candidate.type === 'redirect' && typeof candidate.location === 'string'
}

function isRedirectShape(
  value: unknown,
): value is { location: string; status?: number; headers?: HeadersInit } {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { location?: unknown; status?: unknown; headers?: unknown }
  return typeof candidate.location === 'string'
}

async function resolveLeafRouteMeta(input: {
  matches: RouteMatch[]
  routeMap: Map<string, ServerRouteEntry>
}): Promise<RouteModuleExports['route'] | undefined> {
  const leaf = input.matches[input.matches.length - 1]
  if (!leaf) return undefined

  const routeId = getRouteId(leaf)
  if (!routeId) return undefined

  const entry = input.routeMap.get(routeId)
  if (!entry) return undefined

  const module = await entry.module()
  return module.route
}

function applyCacheMeta(headers: Headers, routeMeta: RouteModuleExports['route'] | undefined): void {
  const maxAge = routeMeta?.cache?.maxAge
  if (maxAge === undefined || !Number.isFinite(maxAge)) {
    return
  }

  const normalized = Math.max(0, Math.floor(maxAge))
  headers.set('cache-control', `public, max-age=${normalized}`)
}
