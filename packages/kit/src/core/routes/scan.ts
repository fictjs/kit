import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { Diagnostic, RouteRecord, RouteSegment, ScanRoutesResult } from './types'

export interface ScanRoutesOptions {
  routesDir: string
  extensions?: string[]
  ignore?: (absFile: string) => boolean
}

const DEFAULT_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx']

export async function scanRoutes(options: ScanRoutesOptions): Promise<ScanRoutesResult> {
  const routesDir = path.resolve(options.routesDir)
  const exts = options.extensions?.length ? options.extensions : DEFAULT_EXTENSIONS
  const diagnostics: Diagnostic[] = []

  if (!(await pathExists(routesDir))) {
    diagnostics.push({
      level: 'warn',
      message: `Routes directory does not exist: ${routesDir}`,
    })
    return { routes: [], diagnostics }
  }

  const files = await walk(routesDir)
  const routeFiles = files
    .filter(file => exts.includes(path.extname(file)))
    .filter(file => !isIgnoredRouteFile(file))
    .filter(file => (options.ignore ? !options.ignore(file) : true))

  const routes: RouteRecord[] = []
  const bySignature = new Map<string, RouteRecord[]>()
  const byRoutePath = new Map<string, RouteRecord[]>()

  for (const file of routeFiles) {
    const relative = normalizeSlashes(path.relative(routesDir, file))
    const withoutExt = relative.slice(0, -path.extname(relative).length)
    const id = withoutExt
    const segments = toSegments(withoutExt)
    const routePath = toRoutePath(segments)
    const signature = toSignature(segments)
    const score = computeScore(segments)

    const record: RouteRecord = {
      id,
      file,
      routePath,
      segments,
      signature,
      score,
    }

    routes.push(record)
    appendMap(bySignature, signature, record)
    appendMap(byRoutePath, routePath, record)
  }

  for (const [signature, records] of bySignature) {
    if (records.length < 2) continue
    diagnostics.push({
      level: 'error',
      message:
        `Route signature conflict "${signature}".\n` +
        records.map(record => `- ${record.id} (${record.routePath})`).join('\n'),
    })
  }

  for (const [routePath, records] of byRoutePath) {
    if (records.length < 2) continue
    diagnostics.push({
      level: 'error',
      message:
        `Duplicate route path "${routePath}".\n` +
        records.map(record => `- ${record.id}`).join('\n'),
    })
  }

  routes.sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))

  return { routes, diagnostics }
}

export function assertNoRouteErrors(diagnostics: Diagnostic[]): void {
  const errors = diagnostics.filter(d => d.level === 'error')
  if (errors.length === 0) return
  const message = errors.map(error => error.message).join('\n\n')
  throw new Error(`[fict-kit] Route scan failed:\n${message}`)
}

function toSegments(routeId: string): RouteSegment[] {
  const parts = routeId.split('/')
  const leaf = parts[parts.length - 1]
  const pathParts = leaf === 'index' ? parts.slice(0, -1) : parts

  return pathParts.filter(Boolean).map(parseSegment)
}

function parseSegment(segment: string): RouteSegment {
  const restMatch = segment.match(/^\[\.\.\.([^\]]+)\]$/)
  if (restMatch?.[1]) {
    return { kind: 'rest', name: restMatch[1] }
  }

  const optionalMatch = segment.match(/^\[\[([^\]]+)\]\]$/)
  if (optionalMatch?.[1]) {
    return { kind: 'optional-param', name: optionalMatch[1] }
  }

  const paramMatch = segment.match(/^\[([^\]]+)\]$/)
  if (paramMatch?.[1]) {
    return { kind: 'param', name: paramMatch[1] }
  }

  return { kind: 'static', value: segment }
}

function toRoutePath(segments: RouteSegment[]): string {
  if (segments.length === 0) {
    return '/'
  }

  const joined = segments.map(segmentToPathToken).filter(Boolean).join('/')
  const normalized = `/${joined}`.replace(/\/+/g, '/').replace(/\/$/, '')
  return normalized || '/'
}

function segmentToPathToken(segment: RouteSegment): string {
  if (segment.kind === 'static') return encodePathSegment(segment.value)
  if (segment.kind === 'param') return `:${segment.name}`
  if (segment.kind === 'optional-param') return `:${segment.name}?`
  return `*${segment.name}`
}

function toSignature(segments: RouteSegment[]): string {
  return segments
    .map(segment => {
      if (segment.kind === 'static') return `s:${segment.value}`
      if (segment.kind === 'param') return 'p'
      if (segment.kind === 'optional-param') return 'o'
      return 'r'
    })
    .join('/')
}

function computeScore(segments: RouteSegment[]): number {
  let score = segments.length

  for (const segment of segments) {
    if (segment.kind === 'static') {
      score += 100
    } else if (segment.kind === 'param') {
      score += 10
    } else if (segment.kind === 'optional-param') {
      score += 9
    } else {
      score += 1
    }
  }

  return score
}

function isIgnoredRouteFile(absPath: string): boolean {
  const base = path.basename(absPath)
  return base.startsWith('_') || base.startsWith('.')
}

function appendMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const current = map.get(key)
  if (current) {
    current.push(value)
  } else {
    map.set(key, [value])
  }
}

function encodePathSegment(segment: string): string {
  return segment
}

async function walk(start: string): Promise<string[]> {
  const output: string[] = []
  const queue = [start]

  while (queue.length > 0) {
    const current = queue.pop()
    if (!current) continue

    const entries = await fs.readdir(current, { withFileTypes: true })
    for (const entry of entries) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        queue.push(absolute)
      } else if (entry.isFile()) {
        output.push(absolute)
      }
    }
  }

  return output
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function normalizeSlashes(input: string): string {
  return input.replace(/\\/g, '/')
}
