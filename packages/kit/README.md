# @fictjs/kit

[![CI](https://github.com/fictjs/kit/actions/workflows/ci.yml/badge.svg)](https://github.com/fictjs/kit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@fictjs/kit.svg)](https://www.npmjs.com/package/@fictjs/kit)
![license](https://img.shields.io/npm/l/@fictjs/kit)

The core meta-framework package for [Fict](https://github.com/fictjs/fict). Provides file-based routing, server-side rendering with resumability, data loading, API routes, server hooks, and a CLI -- all built on Vite.

## Installation

```bash
npm install @fictjs/kit
# or
pnpm add @fictjs/kit
```

### Peer Dependencies

```bash
npm install fict @fictjs/runtime @fictjs/router @fictjs/ssr @fictjs/vite-plugin vite @fictjs/devtools
```

`@fictjs/devtools` is optional.

## Quick Start

### 1. Configure

```ts
// fict.config.ts
import node from '@fictjs/adapter-node'
import { defineConfig } from '@fictjs/kit/config'

export default defineConfig({
  appRoot: 'src',
  routesDir: 'src/routes',
  adapter: node(),
})
```

### 2. Add the Vite Plugin

```ts
// vite.config.ts
import { fictKit } from '@fictjs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [fictKit()],
})
```

### 3. Create Routes

```tsx
// src/routes/index.tsx
import { useRouteData } from '@fictjs/kit/router'

export async function load() {
  return { message: 'Hello from Fict Kit!' }
}

export default function HomePage() {
  const data = useRouteData<Awaited<ReturnType<typeof load>>>()
  return <h1>{data()?.message}</h1>
}
```

### 4. Run

```bash
fict-kit dev     # Development
fict-kit build   # Production build
fict-kit preview # Preview production build
```

## CLI Commands

| Command                      | Description                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `fict-kit dev`               | Start dev server with HMR                                                         |
| `fict-kit build`             | Build client and server bundles                                                   |
| `fict-kit preview`           | Preview production build locally                                                  |
| `fict-kit sync`              | Generate route type declarations to `.fict/generated/`                            |
| `fict-kit inspect`           | Print resolved config, routes, and diagnostics as JSON                            |
| `fict-kit doctor`            | Run environment and build diagnostics                                             |
| `fict-kit add <features...>` | Add features (tailwind, vitest, playwright, eslint, adapter-node, adapter-static) |

## Exports

The package provides multiple sub-path exports:

### `@fictjs/kit/config`

```ts
import {
  defineConfig,
  loadConfig,
  mergeConfigDefaults,
  resolveConfigPath,
} from '@fictjs/kit/config'
```

- **`defineConfig(config)`** -- Define a typed configuration object
- **`loadConfig(cwd?, configFile?)`** -- Load and resolve config from disk
- **`mergeConfigDefaults(config, cwd?)`** -- Merge user config with defaults
- **`resolveConfigPath(cwd, explicit?)`** -- Find the config file path

### `@fictjs/kit/vite`

```ts
import { fictKit } from '@fictjs/kit/vite'
```

- **`fictKit(options?)`** -- Vite plugin that sets up routing, virtual modules, SSR middleware, and tree-shaking

### `@fictjs/kit/router`

```ts
import { FileRoutes, createFileRoutes, useRouteData, buildLocationHref } from '@fictjs/kit/router'
```

- **`FileRoutes`** -- Component that renders file-based routes
- **`createFileRoutes(routes, options?)`** -- Create route definitions from file route entries
- **`useRouteData<T>()`** -- Access data returned by `load()` functions
- **`buildLocationHref(location)`** -- Build a URL string from a location object

### `@fictjs/kit/server`

```ts
import { createRequestHandler, redirect } from '@fictjs/kit/server'
```

- **`createRequestHandler(options)`** -- Create a universal request handler for SSR and API routes
- **`redirect(location, headers?)`** -- Create a redirect response from actions
- **`redirect(status, location, headers?)`** -- Create a redirect response with explicit status

### `@fictjs/kit/client`

```ts
import { setupClientRuntime } from '@fictjs/kit/client'
```

- **`setupClientRuntime(options?)`** -- Initialize the client-side runtime with resumability and manifest loading

### `@fictjs/kit/env`

```ts
import { getPublicEnv } from '@fictjs/kit/env'
```

- **`getPublicEnv(prefix?)`** -- Get environment variables matching the given prefix (default: `PUBLIC_`)

## Configuration

```ts
interface FictKitConfig {
  appRoot?: string // Default: 'src'
  routesDir?: string // Default: 'src/routes'
  outDir?: string // Default: 'dist'
  ssr?:
    | boolean
    | {
        enabled?: boolean // Default: true
        stream?: boolean // Default: false
        resumable?: boolean // Default: true
      }
  compiler?: Record<string, unknown>
  devtools?: boolean // Default: true
  resumability?: {
    events?: string[] // Default: ['click', 'input', 'change', 'submit']
    prefetch?: {
      visibility?: boolean // Default: true
      visibilityMargin?: string // Default: '200px'
      hover?: boolean // Default: true
      hoverDelay?: number // Default: 50
    }
  }
  adapter?: Adapter
}
```

## File-Based Routing

| File                        | Route Path     |
| --------------------------- | -------------- |
| `routes/index.tsx`          | `/`            |
| `routes/about.tsx`          | `/about`       |
| `routes/users/[id].tsx`     | `/users/:id`   |
| `routes/docs/[[lang]].tsx`  | `/docs/:lang?` |
| `routes/blog/[...slug].tsx` | `/blog/*slug`  |

Files starting with `_` or `.` are ignored.

## Route Module Exports

```tsx
// Page component (required for page routes)
export default function Page() { ... }

// Route metadata (optional)
export const route = {
  ssr: false,                    // Disable SSR for this route
  prerender: true,               // Prerender at build time
  cache: { maxAge: 120 },        // Cache-Control header
}

// Server-side data loading (optional)
export async function load(event) { ... }

// Form action handler (optional)
export async function action(event) { ... }

// API method handlers (optional)
export async function GET(event) { ... }
export async function POST(event) { ... }
export async function PUT(event) { ... }
export async function DELETE(event) { ... }
export async function PATCH(event) { ... }
```

Server-only exports (`load`, `action`, HTTP methods) are automatically tree-shaken from client bundles.

## Server Hooks

Create `src/hooks.server.ts` in your app root:

```ts
export async function handle(event, resolve) {
  // Middleware: runs before route handling
  const response = await resolve()
  return response
}

export function handleError(error, event) {
  console.error('Server error:', error)
}
```

## License

[MIT](../../LICENSE)
