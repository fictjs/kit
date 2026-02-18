import {
  installResumableLoader,
  type PrefetchStrategy,
  type ResumableLoaderOptions,
} from '@fictjs/runtime/loader'

export interface ClientRuntimeOptions {
  document?: Document
  snapshotScriptId?: string
  manifestPath?: string
  events?: string[]
  prefetch?: PrefetchStrategy | false
  devManifestProxy?: boolean
}

export async function setupClientRuntime(options: ClientRuntimeOptions = {}): Promise<void> {
  if (typeof window === 'undefined') {
    return
  }

  if (options.devManifestProxy === true) {
    installDevManifestProxy()
  } else {
    const loaded = await loadManifest(options.manifestPath ?? '/fict.manifest.json')
    if (!loaded && options.devManifestProxy !== false) {
      installDevManifestProxy()
    }
  }

  const loaderOptions: ResumableLoaderOptions = {}
  if (options.document) loaderOptions.document = options.document
  if (options.snapshotScriptId) loaderOptions.snapshotScriptId = options.snapshotScriptId
  if (options.events) loaderOptions.events = options.events
  if (options.prefetch !== undefined) loaderOptions.prefetch = options.prefetch

  installResumableLoader(loaderOptions)
}

function installDevManifestProxy(): void {
  const globalState = globalThis as Record<string, unknown>
  const current = globalState.__FICT_MANIFEST__

  if (current && typeof current === 'object') {
    return
  }

  globalState.__FICT_MANIFEST__ = new Proxy(
    {},
    {
      get(_target, key) {
        if (typeof key !== 'string') return undefined
        if (key.startsWith('virtual:fict-handler:')) {
          return `/@id/${key}`
        }
        return undefined
      },
    },
  )
}

async function loadManifest(manifestPath: string): Promise<boolean> {
  const globalState = globalThis as Record<string, unknown>
  if (globalState.__FICT_MANIFEST__ && typeof globalState.__FICT_MANIFEST__ === 'object') {
    return true
  }

  try {
    const response = await fetch(manifestPath)
    if (!response.ok) {
      return false
    }

    const manifest = (await response.json()) as unknown
    if (manifest && typeof manifest === 'object') {
      globalState.__FICT_MANIFEST__ = manifest
      return true
    }
    return false
  } catch {
    // Ignore manifest loading errors in non-browser/proxy environments.
    return false
  }
}
