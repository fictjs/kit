# @fictjs/adapter-static

[![CI](https://github.com/fictjs/kit/actions/workflows/ci.yml/badge.svg)](https://github.com/fictjs/kit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/@fictjs/adapter-static.svg)](https://www.npmjs.com/package/@fictjs/adapter-static)
![license](https://img.shields.io/npm/l/@fictjs/adapter-static)

Static site generation adapter for [Fict Kit](https://github.com/fictjs/kit). Copies client assets to a static output directory, prerenders static routes, and generates a fallback page for SPA navigation.

## Installation

```bash
npm install @fictjs/adapter-static
# or
pnpm add @fictjs/adapter-static
```

## Usage

```ts
// fict.config.ts
import staticAdapter from '@fictjs/adapter-static'
import { defineConfig } from '@fictjs/kit/config'

export default defineConfig({
  adapter: staticAdapter(),
})
```

Build and deploy:

```bash
fict-kit build
# Deploy dist/static/ to any static hosting provider
```

## Options

```ts
staticAdapter({
  outDir: 'dist/static', // Output directory (default: 'dist/static')
  fallback: '404.html', // Fallback HTML file name (default: '404.html')
  prerender: true, // Prerender static routes (default: true)
  serverEntry: undefined, // Custom server entry path (auto-detected by default)
})
```

## Prerendering

When `prerender` is enabled (the default), the adapter automatically prerenders all static routes -- routes without dynamic parameters (`:id`), optional parameters (`:lang?`), or catch-all segments (`*slug`).

You can opt individual routes out of prerendering:

```tsx
// src/routes/dashboard.tsx
export const route = {
  prerender: false,
}
```

## What It Produces

```
dist/static/
  index.html          # Prerendered home page
  about/
    index.html        # Prerendered /about
  404.html            # Fallback for client-side routing
  assets/             # Vite-built static assets (JS, CSS, images)
  .fict-adapter-static.json  # Build metadata
```

## Deployment

The output directory can be deployed to any static hosting provider:

- Netlify, Vercel, Cloudflare Pages
- GitHub Pages
- AWS S3 + CloudFront
- nginx, Apache, or any file server

Configure your hosting provider to serve `404.html` as the fallback for unknown routes to enable client-side routing.

## License

[MIT](../../LICENSE)
