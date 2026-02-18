import { existsSync } from 'node:fs'
import path from 'node:path'

import { loadConfigFromFile } from 'vite'

export interface AdapterContext {
  kitConfig: ResolvedFictKitConfig
  clientDir: string
  serverDir: string
  outDir: string
}

export interface Adapter {
  name: string
  adapt: (ctx: AdapterContext) => Promise<void> | void
}

export interface SSRConfig {
  enabled: boolean
  stream: boolean
  resumable: boolean
}

export interface ResumabilityPrefetchConfig {
  visibility: boolean
  visibilityMargin: string
  hover: boolean
  hoverDelay: number
}

export interface ResumabilityConfig {
  events: string[]
  prefetch: ResumabilityPrefetchConfig
}

export interface FictKitConfig {
  appRoot?: string
  routesDir?: string
  outDir?: string
  ssr?: boolean | Partial<SSRConfig>
  compiler?: Record<string, unknown>
  devtools?: boolean
  resumability?: Partial<ResumabilityConfig> & {
    prefetch?: Partial<ResumabilityPrefetchConfig>
  }
  adapter?: Adapter
}

export interface ResolvedFictKitConfig {
  root: string
  appRoot: string
  routesDir: string
  outDir: string
  ssr: SSRConfig
  compiler: Record<string, unknown>
  devtools: boolean
  resumability: ResumabilityConfig
  adapter?: Adapter
  configFile?: string
}

const DEFAULT_CONFIG_PATHS = [
  'fict.config.ts',
  'fict.config.mts',
  'fict.config.js',
  'fict.config.mjs',
  'fict.config.cjs',
  'fict.config.cts',
]

const DEFAULT_SSR: SSRConfig = {
  enabled: true,
  stream: false,
  resumable: true,
}

const DEFAULT_RESUMABILITY: ResumabilityConfig = {
  events: ['click', 'input', 'change', 'submit'],
  prefetch: {
    visibility: true,
    visibilityMargin: '200px',
    hover: true,
    hoverDelay: 50,
  },
}

export function defineConfig(config: FictKitConfig): FictKitConfig {
  return config
}

export function mergeConfigDefaults(
  config: FictKitConfig,
  cwd: string = process.cwd(),
): ResolvedFictKitConfig {
  const root = path.resolve(cwd)
  const appRootRel = config.appRoot ?? 'src'
  const routesDirRel = config.routesDir ?? path.posix.join(appRootRel, 'routes')
  const outDirRel = config.outDir ?? 'dist'

  const resolved: ResolvedFictKitConfig = {
    root,
    appRoot: path.resolve(root, appRootRel),
    routesDir: path.resolve(root, routesDirRel),
    outDir: path.resolve(root, outDirRel),
    ssr: normalizeSSRConfig(config.ssr),
    compiler: config.compiler ?? {},
    devtools: config.devtools ?? true,
    resumability: normalizeResumabilityConfig(config.resumability),
  }

  if (config.adapter) {
    resolved.adapter = config.adapter
  }

  return resolved
}

export async function loadConfig(
  cwd: string = process.cwd(),
  configFile?: string,
): Promise<ResolvedFictKitConfig> {
  const root = path.resolve(cwd)
  const resolvedPath = resolveConfigPath(root, configFile)

  if (configFile && !resolvedPath) {
    const requested = path.resolve(root, configFile)
    throw new Error(`[fict-kit] Config file not found: ${requested}`)
  }

  if (!resolvedPath) {
    return mergeConfigDefaults({}, root)
  }

  const command = process.env.NODE_ENV === 'production' ? 'build' : 'serve'
  const env = {
    command: command as 'build' | 'serve',
    mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
    isSsrBuild: false,
    isPreview: false,
  }

  const loaded = await loadConfigFromFile(env, resolvedPath, root)
  const userConfig = (loaded?.config ?? {}) as unknown as FictKitConfig
  const merged = mergeConfigDefaults(userConfig, root)

  return {
    ...merged,
    configFile: resolvedPath,
  }
}

export function resolveConfigPath(cwd: string, explicit?: string): string | undefined {
  if (explicit) {
    const absolute = path.resolve(cwd, explicit)
    return existsSync(absolute) ? absolute : undefined
  }

  for (const candidate of DEFAULT_CONFIG_PATHS) {
    const absolute = path.resolve(cwd, candidate)
    if (existsSync(absolute)) {
      return absolute
    }
  }

  return undefined
}

function normalizeSSRConfig(input: FictKitConfig['ssr']): SSRConfig {
  if (input === undefined) return { ...DEFAULT_SSR }
  if (typeof input === 'boolean') {
    return {
      enabled: input,
      stream: false,
      resumable: input,
    }
  }

  return {
    enabled: input.enabled ?? DEFAULT_SSR.enabled,
    stream: input.stream ?? DEFAULT_SSR.stream,
    resumable: input.resumable ?? DEFAULT_SSR.resumable,
  }
}

function normalizeResumabilityConfig(input?: FictKitConfig['resumability']): ResumabilityConfig {
  return {
    events: input?.events ?? DEFAULT_RESUMABILITY.events,
    prefetch: {
      visibility: input?.prefetch?.visibility ?? DEFAULT_RESUMABILITY.prefetch.visibility,
      visibilityMargin:
        input?.prefetch?.visibilityMargin ?? DEFAULT_RESUMABILITY.prefetch.visibilityMargin,
      hover: input?.prefetch?.hover ?? DEFAULT_RESUMABILITY.prefetch.hover,
      hoverDelay: input?.prefetch?.hoverDelay ?? DEFAULT_RESUMABILITY.prefetch.hoverDelay,
    },
  }
}
