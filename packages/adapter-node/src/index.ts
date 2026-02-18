import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { Adapter, AdapterContext } from '@fictjs/kit'

export interface AdapterNodeOptions {
  outFile?: string
  host?: string
  port?: number
  serverEntry?: string
}

export function adapterNode(options: AdapterNodeOptions = {}): Adapter {
  return {
    name: '@fictjs/adapter-node',
    async adapt(context) {
      const outFile = resolveOutFile(context, options.outFile)
      const serverEntry = await resolveServerEntry(context, options.serverEntry)

      const outDir = path.dirname(outFile)
      const clientDirRelative = toImportPath(path.relative(outDir, context.clientDir))
      const templateRelative = toImportPath(path.relative(outDir, path.join(context.clientDir, 'index.html')))
      const serverEntryRelative = toImportPath(path.relative(outDir, serverEntry))

      const source = createNodeServerSource({
        clientDirRelative,
        templateRelative,
        serverEntryRelative,
        host: options.host ?? '0.0.0.0',
        port: options.port ?? 3000,
      })

      await fs.mkdir(path.dirname(outFile), { recursive: true })
      await fs.writeFile(outFile, source)
    },
  }
}

export default adapterNode

function resolveOutFile(context: AdapterContext, outFile?: string): string {
  if (!outFile) {
    return path.join(context.outDir, 'index.js')
  }

  return path.isAbsolute(outFile) ? outFile : path.join(context.outDir, outFile)
}

async function resolveServerEntry(context: AdapterContext, requested?: string): Promise<string> {
  if (requested) {
    const absolute = path.isAbsolute(requested) ? requested : path.join(context.outDir, requested)
    return absolute
  }

  const expected = path.join(context.serverDir, 'entry-server.js')
  if (await pathExists(expected)) {
    return expected
  }

  const entries = await fs.readdir(context.serverDir)
  const jsEntry = entries.find(entry => entry.endsWith('.js'))
  if (!jsEntry) {
    throw new Error(`[adapter-node] Could not find server entry in ${context.serverDir}`)
  }

  return path.join(context.serverDir, jsEntry)
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function toImportPath(input: string): string {
  const normalized = input.replace(/\\/g, '/')
  if (normalized.startsWith('.')) {
    return normalized
  }
  return `./${normalized}`
}

interface NodeServerSourceOptions {
  clientDirRelative: string
  templateRelative: string
  serverEntryRelative: string
  host: string
  port: number
}

function createNodeServerSource(options: NodeServerSourceOptions): string {
  return `import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createRequestHandler } from '@fictjs/kit/server'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const clientDir = path.resolve(__dirname, ${JSON.stringify(options.clientDirRelative)})
const templatePath = path.resolve(__dirname, ${JSON.stringify(options.templateRelative)})
const serverEntryPath = path.resolve(__dirname, ${JSON.stringify(options.serverEntryRelative)})

const manifestPath = path.join(clientDir, 'fict.manifest.json')
if (existsSync(manifestPath)) {
  try {
    globalThis.__FICT_MANIFEST__ = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    // ignore malformed manifest
  }
}

const serverEntry = await import(pathToFileURL(serverEntryPath).href)
if (!serverEntry.routes || !serverEntry.render) {
  throw new Error('[adapter-node] server entry must export { routes, render }')
}

const hooks = normalizeHooks(serverEntry.hooks)

const handler = createRequestHandler({
  mode: 'prod',
  routes: serverEntry.routes,
  getTemplate: () => readFileSync(templatePath, 'utf8'),
  render: serverEntry.render,
  hooks,
})

const server = createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url || '/', 'http://fict.local')

    const staticResponse = await tryServeStatic(req, requestUrl)
    if (staticResponse) {
      sendResponse(res, staticResponse)
      return
    }

    const request = await toRequest(req, requestUrl)
    const response = await handler(request)
    await sendResponse(res, response)
  } catch (error) {
    res.statusCode = 500
    res.setHeader('content-type', 'text/plain; charset=utf-8')
    res.end(String(error))
  }
})

const port = Number(process.env.PORT || ${options.port})
const host = process.env.HOST || ${JSON.stringify(options.host)}

server.listen(port, host, () => {
  console.log('[fict-kit] Node server running at http://' + host + ':' + port)
})

async function tryServeStatic(req, requestUrl) {
  const method = (req.method || 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    return null
  }

  const pathname = decodeURIComponent(requestUrl.pathname)
  const base = path.posix.basename(pathname)
  if (!base.includes('.')) {
    return null
  }

  const candidate = path.join(clientDir, pathname)
  if (!candidate.startsWith(clientDir)) {
    return new Response('Forbidden', { status: 403 })
  }

  if (!existsSync(candidate)) {
    return null
  }

  const file = readFileSync(candidate)
  const stat = statSync(candidate)

  const headers = new Headers()
  headers.set('content-length', String(stat.size))
  headers.set('content-type', getContentType(candidate))

  return new Response(file, { status: 200, headers })
}

async function toRequest(req, requestUrl) {
  const method = (req.method || 'GET').toUpperCase()
  const headers = new Headers()

  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      headers.set(key, value.join(', '))
    } else {
      headers.set(key, value)
    }
  }

  if (method === 'GET' || method === 'HEAD') {
    return new Request(requestUrl.href, { method, headers })
  }

  const chunks = []
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : Buffer.from(chunk))
  }
  const bodyBuffer = Buffer.concat(chunks)
  const body = bodyBuffer.buffer.slice(
    bodyBuffer.byteOffset,
    bodyBuffer.byteOffset + bodyBuffer.byteLength,
  )

  return new Request(requestUrl.href, { method, headers, body })
}

async function sendResponse(res, response) {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  if (!response.body) {
    res.end()
    return
  }

  const body = Buffer.from(await response.arrayBuffer())
  res.end(body)
}

function getContentType(filePath) {
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8'
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8'
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8'
  if (filePath.endsWith('.svg')) return 'image/svg+xml'
  if (filePath.endsWith('.png')) return 'image/png'
  if (filePath.endsWith('.jpg') || filePath.endsWith('.jpeg')) return 'image/jpeg'
  if (filePath.endsWith('.woff2')) return 'font/woff2'
  if (filePath.endsWith('.woff')) return 'font/woff'
  return 'application/octet-stream'
}

function normalizeHooks(value) {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const hooks = {}
  if (typeof value.handle === 'function') {
    hooks.handle = value.handle
  }
  if (typeof value.handleError === 'function') {
    hooks.handleError = value.handleError
  }

  if (hooks.handle || hooks.handleError) {
    return hooks
  }

  return undefined
}
`
}
