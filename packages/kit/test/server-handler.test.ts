import { afterEach, describe, expect, it, vi } from 'vitest'

import { createRequestHandler, redirect } from '../src/server'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('createRequestHandler', () => {
  it('serves data endpoint', async () => {
    const handler = createRequestHandler({
      mode: 'dev',
      routes: [
        {
          id: 'index',
          path: '/',
          module: async () => ({
            load: async () => ({ hello: 'world' }),
          }),
        },
      ],
      getTemplate: () => '<!--app-html-->',
      render: () => '<div>app</div>',
    })

    const response = await handler(new Request('http://local/_fict/data/index?url=%2F'))
    expect(response.status).toBe(200)

    const payload = (await response.json()) as { routeId: string; data: { hello: string } }
    expect(payload.routeId).toBe('index')
    expect(payload.data).toEqual({ hello: 'world' })
  })

  it('supports action redirects', async () => {
    const handler = createRequestHandler({
      mode: 'dev',
      routes: [
        {
          id: 'index',
          path: '/',
          module: async () => ({
            action: async () => redirect(303, '/next'),
          }),
        },
      ],
      getTemplate: () => '<!--app-html-->',
      render: () => '<div>app</div>',
    })

    const response = await handler(
      new Request('http://local/_fict/action/index?url=%2F', { method: 'POST' }),
    )

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('/next')
  })

  it('uses route method handlers for API requests', async () => {
    const handler = createRequestHandler({
      mode: 'dev',
      routes: [
        {
          id: 'users',
          path: '/users',
          module: async () => ({
            GET: async () => new Response('ok', { status: 201 }),
          }),
        },
      ],
      getTemplate: () => '<!--app-html-->',
      render: () => '<div>app</div>',
    })

    const response = await handler(
      new Request('http://local/users', {
        headers: {
          accept: 'application/json',
        },
      }),
    )

    expect(response.status).toBe(201)
    expect(await response.text()).toBe('ok')
  })

  it('supports hooks.handle wrapping resolve', async () => {
    const handler = createRequestHandler({
      mode: 'dev',
      routes: [],
      getTemplate: () => '<!--app-html-->',
      render: () => '<div>app</div>',
      hooks: {
        handle: async (_event, resolve) => {
          const response = await resolve()
          const headers = new Headers(response.headers)
          headers.set('x-hook', 'yes')
          return new Response(await response.text(), {
            status: response.status,
            headers,
          })
        },
      },
    })

    const response = await handler(new Request('http://local/'))
    expect(response.status).toBe(200)
    expect(response.headers.get('x-hook')).toBe('yes')
  })

  it('returns structured error payload for data endpoint failures', async () => {
    const handleError = vi.fn()
    const handler = createRequestHandler({
      mode: 'dev',
      routes: [
        {
          id: 'index',
          path: '/',
          module: async () => ({
            load: async () => {
              throw new Error('boom')
            },
          }),
        },
      ],
      getTemplate: () => '<!--app-html-->',
      render: () => '<div>app</div>',
      hooks: {
        handleError,
      },
    })

    const response = await handler(new Request('http://local/_fict/data/index?url=%2F'))
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      type: 'data',
      error: 'internal_error',
    })
    expect(handleError).toHaveBeenCalledTimes(1)
  })

  it('returns structured error payload for action endpoint failures', async () => {
    const handler = createRequestHandler({
      mode: 'dev',
      routes: [
        {
          id: 'index',
          path: '/',
          module: async () => ({
            action: async () => {
              throw new Error('boom')
            },
          }),
        },
      ],
      getTemplate: () => '<!--app-html-->',
      render: () => '<div>app</div>',
    })

    const response = await handler(
      new Request('http://local/_fict/action/index?url=%2F', { method: 'POST' }),
    )
    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      type: 'action',
      error: 'internal_error',
    })
  })

  it('returns json error payload for api failures', async () => {
    const handler = createRequestHandler({
      mode: 'dev',
      routes: [
        {
          id: 'users',
          path: '/users',
          module: async () => ({
            GET: async () => {
              throw new Error('api error')
            },
          }),
        },
      ],
      getTemplate: () => '<!--app-html-->',
      render: () => '<div>app</div>',
    })

    const response = await handler(
      new Request('http://local/users', {
        headers: {
          accept: 'application/json',
        },
      }),
    )

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({
      error: 'internal_error',
    })
  })

  it('skips SSR render when route meta sets ssr false', async () => {
    const loadSpy = vi.fn(async () => ({ secret: true }))

    const handler = createRequestHandler({
      mode: 'dev',
      routes: [
        {
          id: 'spa',
          path: '/spa',
          module: async () => ({
            route: {
              ssr: false,
            },
            load: loadSpy,
          }),
        },
      ],
      getTemplate: () => '<html><body><main><!--app-html--></main></body></html>',
      render: () => '<div>server rendered</div>',
    })

    const response = await handler(new Request('http://local/spa'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<html><body><main></main></body></html>')
    expect(loadSpy).not.toHaveBeenCalled()
  })

  it('applies cache-control from route meta cache.maxAge', async () => {
    const handler = createRequestHandler({
      mode: 'dev',
      routes: [
        {
          id: 'home',
          path: '/',
          module: async () => ({
            route: {
              cache: {
                maxAge: 120,
              },
            },
          }),
        },
      ],
      getTemplate: () => '<!--app-html-->',
      render: () => '<div>home</div>',
    })

    const response = await handler(new Request('http://local/'))
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('public, max-age=120')
  })

  it('respects global ssrEnabled=false option', async () => {
    const loadSpy = vi.fn(async () => ({ value: 1 }))

    const handler = createRequestHandler({
      mode: 'dev',
      ssrEnabled: false,
      routes: [
        {
          id: 'home',
          path: '/',
          module: async () => ({
            load: loadSpy,
          }),
        },
      ],
      getTemplate: () => '<html><body><!--app-html--></body></html>',
      render: () => '<div>rendered</div>',
    })

    const response = await handler(new Request('http://local/'))
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('<html><body></body></html>')
    expect(loadSpy).not.toHaveBeenCalled()
  })

  it('forwards auth headers for same-origin event.fetch', async () => {
    const fetchSpy = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchSpy)

    const handler = createRequestHandler({
      mode: 'dev',
      routes: [
        {
          id: 'home',
          path: '/',
          module: async () => ({
            load: async event => {
              await event.fetch('/api/session', {
                headers: {
                  'x-request-id': 'abc123',
                },
              })
              return null
            },
          }),
        },
      ],
      getTemplate: () => '<!--app-html-->',
      render: () => '<div>home</div>',
    })

    await handler(
      new Request('http://local/', {
        headers: {
          cookie: 'session=xyz',
          authorization: 'Bearer token',
        },
      }),
    )

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get('cookie')).toBe('session=xyz')
    expect(headers.get('authorization')).toBe('Bearer token')
    expect(headers.get('x-request-id')).toBe('abc123')
  })

  it('does not forward auth headers for cross-origin event.fetch', async () => {
    const fetchSpy = vi.fn(async () => new Response('ok'))
    vi.stubGlobal('fetch', fetchSpy)

    const handler = createRequestHandler({
      mode: 'dev',
      routes: [
        {
          id: 'home',
          path: '/',
          module: async () => ({
            load: async event => {
              await event.fetch('https://third-party.example/api', {
                headers: {
                  'x-request-id': 'abc123',
                },
              })
              return null
            },
          }),
        },
      ],
      getTemplate: () => '<!--app-html-->',
      render: () => '<div>home</div>',
    })

    await handler(
      new Request('http://local/', {
        headers: {
          cookie: 'session=xyz',
          authorization: 'Bearer token',
        },
      }),
    )

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const init = fetchSpy.mock.calls[0]?.[1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get('cookie')).toBeNull()
    expect(headers.get('authorization')).toBeNull()
    expect(headers.get('x-request-id')).toBe('abc123')
  })
})
