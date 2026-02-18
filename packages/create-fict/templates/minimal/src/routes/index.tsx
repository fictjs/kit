import { Link } from '@fictjs/router'

import { useRouteData } from '@fictjs/kit/router'

export async function load() {
  return {
    title: 'Fict Kit',
    description: 'SSR + resumability + file-based routing',
  }
}

export default function HomePage() {
  const data = useRouteData<Awaited<ReturnType<typeof load>>>()

  return (
    <main style={{ padding: '2rem', fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>{data()?.title}</h1>
      <p>{data()?.description}</p>
      <p>
        <Link to="/about">About</Link>
      </p>
      <p>
        <Link to="/users/42">User 42</Link>
      </p>
    </main>
  )
}
