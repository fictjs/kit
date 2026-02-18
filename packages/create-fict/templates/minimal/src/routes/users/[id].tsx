import { useRouteData } from '@fictjs/kit/router'

export async function load(event: { params: Record<string, string | undefined> }) {
  return {
    id: event.params.id ?? 'unknown',
  }
}

export default function UserPage() {
  const data = useRouteData<Awaited<ReturnType<typeof load>>>()

  return (
    <main style={{ padding: '2rem', fontFamily: 'ui-sans-serif, system-ui' }}>
      <h1>User {data()?.id}</h1>
    </main>
  )
}
