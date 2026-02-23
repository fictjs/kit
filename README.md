# Fict Kit

[![CI](https://github.com/fictjs/kit/actions/workflows/ci.yml/badge.svg)](https://github.com/fictjs/kit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@fictjs/kit.svg)](https://www.npmjs.com/package/@fictjs/kit)
![license](https://img.shields.io/npm/l/@fictjs/kit)

The meta-framework for [Fict](https://github.com/fictjs/fict) -- file-based routing, SSR, resumability, and deployment adapters, powered by Vite.

Fict Kit is to Fict what SvelteKit is to Svelte or what Next.js is to React: an opinionated application layer that handles routing, server-side rendering, data loading, and production deployment so you can focus on building your UI.

## Features

- **File-based routing** -- Pages map to files in `src/routes/` with dynamic params, optional params, and catch-all segments
- **Server-side rendering** -- SSR enabled by default with streaming support
- **Resumability** -- Serializes component state during SSR and resumes on the client without full hydration (similar to Qwik)
- **Data loading** -- Co-located `load()` functions for server-side data fetching, automatically available to components
- **API routes** -- Export HTTP method handlers (`GET`, `POST`, etc.) directly from route files
- **Actions** -- Form submissions and mutations via `action()` exports with redirect support
- **Server hooks** -- Middleware-style `handle()` and `handleError()` hooks via `hooks.server.ts`
- **Automatic tree-shaking** -- Server-only code (`load`, `action`, HTTP methods) is stripped from client bundles at build time
- **Typed routes** -- Generated TypeScript declarations for route IDs, params, and a typed `href()` helper
- **Deployment adapters** -- Build for Node.js servers or static hosting with a single config change
- **CLI tooling** -- `dev`, `build`, `preview`, `sync`, `inspect`, `doctor`, and `add` commands
- **Vite 7** -- Built on Vite for fast HMR and optimized production builds

## Quick Start

### Create a New Project

```bash
# npm
npm create @fictjs/fict@latest my-app

# pnpm
pnpm create @fictjs/fict my-app

# Scaffold with options
pnpm create @fictjs/fict my-app --adapter node --tailwind --vitest
```

### Or Add to an Existing Fict Project

```bash
npm install @fictjs/kit @fictjs/adapter-node
```

## Project Structure

```
my-app/
  fict.config.ts          # Kit configuration
  index.html              # HTML shell
  src/
    entry-client.ts       # Client entry (imports virtual module)
    hooks.server.ts       # Server hooks (optional)
    routes/
      index.tsx           # → /
      about.tsx           # → /about
      users/
        [id].tsx          # → /users/:id
        [[lang]].tsx      # → /users/:lang? (optional param)
      blog/
        [...slug].tsx     # → /blog/*slug (catch-all)
```

Files starting with `_` or `.` are ignored by the router.

## Configuration

```ts
// fict.config.ts
import node from '@fictjs/adapter-node'
import { defineConfig } from '@fictjs/kit/config'

export default defineConfig({
  appRoot: 'src',
  routesDir: 'src/routes',
  adapter: node(),
  ssr: {
    enabled: true,
    stream: false,
    resumable: true,
  },
  devtools: true,
})
```

Then add the Vite plugin:

```ts
// vite.config.ts
import { fictKit } from '@fictjs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [fictKit()],
})
```

## Routing

### Pages

Every file in `src/routes/` becomes a route. The component is the default export:

```tsx
// src/routes/about.tsx
export default function AboutPage() {
  return <h1>About</h1>
}
```

### Dynamic Routes

| File Pattern         | URL Pattern    | Example Match         |
| -------------------- | -------------- | --------------------- |
| `users/[id].tsx`     | `/users/:id`   | `/users/42`           |
| `docs/[[lang]].tsx`  | `/docs/:lang?` | `/docs` or `/docs/en` |
| `blog/[...slug].tsx` | `/blog/*slug`  | `/blog/2026/hello`    |

### Data Loading

Export a `load()` function to fetch data on the server. Access it in the component with `useRouteData()`:

```tsx
// src/routes/index.tsx
import { useRouteData } from '@fictjs/kit/router'

export async function load() {
  const posts = await db.posts.findMany()
  return { posts }
}

export default function HomePage() {
  const data = useRouteData<Awaited<ReturnType<typeof load>>>()

  return (
    <ul>
      {data()?.posts.map(post => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  )
}
```

The `load()` function runs on the server during SSR and is automatically tree-shaken from client bundles.

### Route Parameters

Dynamic segments are passed to `load()` via `event.params`:

```tsx
// src/routes/users/[id].tsx
export async function load(event: { params: Record<string, string | undefined> }) {
  const user = await db.users.findById(event.params.id)
  return { user }
}

export default function UserPage() {
  const data = useRouteData<Awaited<ReturnType<typeof load>>>()
  return <h1>User {data()?.user?.name}</h1>
}
```

### API Routes

Export HTTP method handlers to create API endpoints:

```tsx
// src/routes/api/users.ts
export async function GET(event) {
  const users = await db.users.findMany()
  return Response.json(users)
}

export async function POST(event) {
  const body = await event.request.json()
  const user = await db.users.create(body)
  return Response.json(user, { status: 201 })
}
```

### Actions

Handle form submissions with the `action()` export:

```tsx
import { redirect } from '@fictjs/kit/server'

export async function action(event) {
  const formData = await event.request.formData()
  await db.todos.create({ title: formData.get('title') })
  return redirect(303, '/todos')
}
```

### Route Metadata

Control per-route behavior with the `route` export:

```tsx
export const route = {
  ssr: false, // Disable SSR for this route
  prerender: true, // Prerender at build time
  cache: { maxAge: 120 }, // Cache-Control header (seconds)
}
```

## Server Hooks

Create `src/hooks.server.ts` to add middleware and error handling:

```ts
import type { RequestEvent } from '@fictjs/kit/server'

export async function handle(event: RequestEvent, resolve: () => Promise<Response>) {
  // Run before route handling
  const start = performance.now()

  const response = await resolve()

  // Run after route handling
  console.log(`${event.request.method} ${event.url.pathname} - ${performance.now() - start}ms`)
  return response
}

export function handleError(error: unknown, event: RequestEvent) {
  console.error(`Unhandled error on ${event.url.pathname}:`, error)
}
```

## Resumability

Fict Kit supports resumability by default. During SSR, component state is serialized into the HTML. On the client, instead of replaying the full component tree (hydration), event handlers are lazily loaded only when the user interacts with the page.

Configure resumability behavior in `fict.config.ts`:

```ts
export default defineConfig({
  ssr: { resumable: true },
  resumability: {
    events: ['click', 'input', 'change', 'submit'],
    prefetch: {
      visibility: true, // Prefetch handlers when elements become visible
      visibilityMargin: '200px',
      hover: true, // Prefetch on hover
      hoverDelay: 50, // ms before prefetch on hover
    },
  },
})
```

## CLI

```bash
fict-kit dev           # Start dev server with HMR
fict-kit build         # Build for production (client + server bundles)
fict-kit preview       # Preview production build locally
fict-kit sync          # Generate type declarations for routes and virtual modules
fict-kit inspect       # Print resolved config, routes, and diagnostics as JSON
fict-kit doctor        # Run environment and build diagnostics
fict-kit add <feature> # Add features to an existing project
```

### `fict-kit dev`

```bash
fict-kit dev [--config <path>] [--host] [--port <number>] [--open]
```

### `fict-kit build`

```bash
fict-kit build [--config <path>]
```

Outputs client assets to `dist/client/` and server bundle to `dist/server/`. If an adapter is configured, it runs the adapter to produce deployable output.

### `fict-kit add`

```bash
fict-kit add tailwind vitest playwright
```

Supported features: `adapter-node`, `adapter-static`, `eslint`, `vitest`, `tailwind`, `playwright`

## Adapters

### Node Adapter

Produces a standalone Node.js HTTP server:

```bash
npm install @fictjs/adapter-node
```

```ts
// fict.config.ts
import node from '@fictjs/adapter-node'
import { defineConfig } from '@fictjs/kit/config'

export default defineConfig({
  adapter: node({
    outFile: 'dist/index.js', // default
    host: '0.0.0.0', // default
    port: 3000, // default
  }),
})
```

```bash
fict-kit build
node dist/index.js
```

### Static Adapter

Generates static HTML with optional prerendering:

```bash
npm install @fictjs/adapter-static
```

```ts
// fict.config.ts
import static_ from '@fictjs/adapter-static'
import { defineConfig } from '@fictjs/kit/config'

export default defineConfig({
  adapter: static_({
    outDir: 'dist/static', // default
    fallback: '404.html', // default
    prerender: true, // default
  }),
})
```

## Type Generation

Run `fict-kit sync` to generate TypeScript declarations in `.fict/generated/`:

- **`routes.d.ts`** -- `RouteId` union type and `RouteParamsMap` for typed params
- **`links.d.ts`** -- Typed `href()` function for building route URLs
- **`virtual-modules.d.ts`** -- Module declarations for virtual imports
- **`env.d.ts`** -- `ImportMetaEnv` with `PUBLIC_*` environment variables

## Packages

| Package                                             | Description                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------- |
| [`@fictjs/kit`](packages/kit)                       | Core framework -- CLI, Vite plugin, router, server handler, client runtime |
| [`@fictjs/adapter-node`](packages/adapter-node)     | Node.js deployment adapter                                                 |
| [`@fictjs/adapter-static`](packages/adapter-static) | Static site generation adapter                                             |
| [`@fictjs/create-fict`](packages/create-fict)       | Project scaffolder                                                         |

## Contributing

### Prerequisites

- Node.js >= 20
- pnpm >= 9

### Setup

```bash
git clone https://github.com/fictjs/kit.git
cd kit
pnpm install
```

### Development

```bash
pnpm dev              # Watch mode for all packages
pnpm build            # Build all packages
pnpm test             # Run all tests
pnpm lint             # Lint
pnpm typecheck        # Type check
pnpm format           # Format with Prettier
```

### Commit Convention

```bash
# Format: type(scope): message
feat(kit): add streaming SSR support
fix(adapter-node): handle graceful shutdown
```

## License

[MIT](LICENSE)
