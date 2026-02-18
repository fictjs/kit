import { describe, expect, it, vi } from 'vitest'

import { createFileRoutes } from '../src/router'

describe('createFileRoutes', () => {
  it('uses initialData once before hitting fetcher', async () => {
    const fetchData = vi.fn(async () => ({ from: 'network' }))

    const routes = createFileRoutes(
      [
        {
          id: 'index',
          path: '/',
          module: async () => ({ default: () => null }),
        },
      ],
      {
        initialData: { index: { from: 'ssr' } },
        fetchData,
      },
    )

    const preload = routes[0]?.preload
    expect(preload).toBeTypeOf('function')

    const location = {
      pathname: '/',
      search: '',
      hash: '',
      state: null,
      key: 'initial',
    }

    const first = preload?.({ params: {}, location, intent: 'navigate' })
    expect(first).toEqual({ from: 'ssr' })

    const second = await preload?.({ params: {}, location, intent: 'navigate' })
    expect(second).toEqual({ from: 'network' })
    expect(fetchData).toHaveBeenCalledTimes(1)
  })
})
