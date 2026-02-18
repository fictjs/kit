import path from 'node:path'

import { cac } from 'cac'
import pc from 'picocolors'
import { build, createServer, preview } from 'vite'

import { loadConfig } from './config'
import { assertNoRouteErrors, scanRoutes } from './core/routes/scan'
import { fictKit } from './plugin/fict-kit'
import { syncGeneratedFiles } from './sync/generate'

interface CommonCliOptions {
  config?: string
}

interface ServerCliOptions extends CommonCliOptions {
  host?: string
  port?: string
  open?: boolean
}

export function runCli(argv: string[] = process.argv): void {
  const cli = cac('fict-kit')

  cli
    .command('dev', 'Start Fict Kit dev server')
    .option('--config <file>', 'Path to fict.config.ts')
    .option('--host <host>', 'Host to listen on')
    .option('--port <port>', 'Port to listen on')
    .option('--open', 'Open browser on start')
    .action(async (options: ServerCliOptions) => {
      await runDev(options)
    })

  cli
    .command('build', 'Build client and server bundles')
    .option('--config <file>', 'Path to fict.config.ts')
    .action(async (options: CommonCliOptions) => {
      await runBuild(options)
    })

  cli
    .command('preview', 'Preview production build')
    .option('--config <file>', 'Path to fict.config.ts')
    .option('--host <host>', 'Host to listen on')
    .option('--port <port>', 'Port to listen on')
    .option('--open', 'Open browser on start')
    .action(async (options: ServerCliOptions) => {
      await runPreview(options)
    })

  cli
    .command('sync', 'Generate route and virtual module types')
    .option('--config <file>', 'Path to fict.config.ts')
    .action(async (options: CommonCliOptions) => {
      await runSync(options)
    })

  cli
    .command('inspect', 'Print resolved config and route manifest')
    .option('--config <file>', 'Path to fict.config.ts')
    .action(async (options: CommonCliOptions) => {
      await runInspect(options)
    })

  cli.help()
  cli.version('0.1.0')

  cli.parse(argv)
}

async function runDev(options: ServerCliOptions): Promise<void> {
  const cwd = process.cwd()
  const plugins = fictKit(toPluginOptions(options.config))
  const serverOptions: NonNullable<Parameters<typeof createServer>[0]>['server'] = {}
  if (options.host) serverOptions.host = options.host
  if (options.port) {
    const port = toNumber(options.port)
    if (port !== undefined) serverOptions.port = port
  }
  if (options.open !== undefined) serverOptions.open = options.open

  const server = await createServer({
    root: cwd,
    configFile: false,
    appType: 'custom',
    plugins,
    server: serverOptions,
  })

  await server.listen()
  server.printUrls()
  server.bindCLIShortcuts({ print: true })
}

async function runBuild(options: CommonCliOptions): Promise<void> {
  const cwd = process.cwd()
  const resolved = await loadConfig(cwd, options.config)
  const plugins = fictKit(toPluginOptions(options.config))

  const clientOutDir = path.join(resolved.outDir, 'client')
  const serverOutDir = path.join(resolved.outDir, 'server')

  await build({
    root: cwd,
    configFile: false,
    plugins,
    build: {
      outDir: clientOutDir,
      emptyOutDir: true,
      manifest: true,
      minify: false,
    },
  })

  await build({
    root: cwd,
    configFile: false,
    plugins,
    build: {
      outDir: serverOutDir,
      emptyOutDir: false,
      ssr: 'virtual:fict-kit/entry-server',
      rollupOptions: {
        input: 'virtual:fict-kit/entry-server',
      },
      minify: false,
    },
  })

  if (resolved.adapter) {
    await resolved.adapter.adapt({
      kitConfig: resolved,
      clientDir: clientOutDir,
      serverDir: serverOutDir,
      outDir: resolved.outDir,
    })
  }

  console.log(pc.green('[fict-kit] build complete'))
  console.log(`  client: ${clientOutDir}`)
  console.log(`  server: ${serverOutDir}`)
}

async function runPreview(options: ServerCliOptions): Promise<void> {
  const cwd = process.cwd()
  const resolved = await loadConfig(cwd, options.config)
  const plugins = fictKit(toPluginOptions(options.config))
  const previewOptions: NonNullable<Parameters<typeof preview>[0]>['preview'] = {}
  if (options.host) previewOptions.host = options.host
  if (options.port) {
    const port = toNumber(options.port)
    if (port !== undefined) previewOptions.port = port
  }
  if (options.open !== undefined) previewOptions.open = options.open

  const previewServer = await preview({
    root: cwd,
    configFile: false,
    plugins,
    build: {
      outDir: path.join(resolved.outDir, 'client'),
    },
    preview: previewOptions,
  })

  previewServer.printUrls()
}

async function runSync(options: CommonCliOptions): Promise<void> {
  const cwd = process.cwd()
  const resolved = await loadConfig(cwd, options.config)
  const scan = await scanRoutes({ routesDir: resolved.routesDir })
  assertNoRouteErrors(scan.diagnostics)

  const result = await syncGeneratedFiles({
    routes: scan.routes,
    outDir: path.join(cwd, '.fict/generated'),
  })

  console.log(pc.green(`[fict-kit] sync generated ${result.files.length} files`))
  for (const file of result.files) {
    console.log(`  - ${file}`)
  }
}

async function runInspect(options: CommonCliOptions): Promise<void> {
  const cwd = process.cwd()
  const resolved = await loadConfig(cwd, options.config)
  const scan = await scanRoutes({ routesDir: resolved.routesDir })

  const payload = {
    config: {
      root: resolved.root,
      appRoot: resolved.appRoot,
      routesDir: resolved.routesDir,
      outDir: resolved.outDir,
      ssr: resolved.ssr,
      devtools: resolved.devtools,
      resumability: resolved.resumability,
      adapter: resolved.adapter?.name,
    },
    routes: scan.routes.map(route => ({
      id: route.id,
      path: route.routePath,
      file: route.file,
      signature: route.signature,
      score: route.score,
    })),
    diagnostics: scan.diagnostics,
  }

  console.log(JSON.stringify(payload, null, 2))
}

function toNumber(input?: string): number | undefined {
  if (!input) return undefined
  const parsed = Number.parseInt(input, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function toPluginOptions(config?: string): CommonCliOptions {
  if (!config) return {}
  return { config }
}
