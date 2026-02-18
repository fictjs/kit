import { describe, expect, it } from 'vitest'

import { createRequestHandler, redirect } from '../src/server'

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
})
