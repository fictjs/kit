# @fictjs/adapter-node

[![CI](https://github.com/fictjs/kit/actions/workflows/ci.yml/badge.svg)](https://github.com/fictjs/kit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@fictjs/adapter-node.svg)](https://www.npmjs.com/package/@fictjs/adapter-node)
![license](https://img.shields.io/npm/l/@fictjs/adapter-node)

Node.js deployment adapter for [Fict Kit](https://github.com/fictjs/kit). Generates a standalone HTTP server entry file that serves your Fict Kit application.

## Installation

```bash
npm install @fictjs/adapter-node
# or
pnpm add @fictjs/adapter-node
```

## Usage

```ts
// fict.config.ts
import node from '@fictjs/adapter-node'
import { defineConfig } from '@fictjs/kit/config'

export default defineConfig({
  adapter: node(),
})
```

Build and run:

```bash
fict-kit build
node dist/index.js
```

## Options

```ts
node({
  outFile: 'dist/index.js', // Output file path (default: 'dist/index.js')
  host: '0.0.0.0', // Host to bind (default: '0.0.0.0')
  port: 3000, // Port to listen on (default: 3000)
  serverEntry: undefined, // Custom server entry path (auto-detected by default)
})
```

## Environment Variables

The generated server respects the following environment variables at runtime:

| Variable | Description       | Default                         |
| -------- | ----------------- | ------------------------------- |
| `PORT`   | Port to listen on | `3000` (or configured value)    |
| `HOST`   | Host to bind to   | `0.0.0.0` (or configured value) |

## What It Generates

The adapter produces a single `dist/index.js` file that:

1. Imports the server entry module (SSR render function + route definitions)
2. Sets up a Node.js `http.createServer`
3. Serves static assets from the client build directory
4. Handles SSR, data loading, actions, and API routes via `createRequestHandler`
5. Supports server hooks (`handle`, `handleError`) from `hooks.server.ts`

## License

[MIT](../../LICENSE)
