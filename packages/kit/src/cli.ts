import { spawn } from 'node:child_process'
import { promises as fs } from 'node:fs'
import path from 'node:path'

import { cac } from 'cac'
import pc from 'picocolors'
import { build, createServer, preview } from 'vite'

import { addFeatures } from './add'
import { loadConfig, type ResolvedFictKitConfig } from './config'
import { assertNoRouteErrors, scanRoutes } from './core/routes/scan'
import { collectDoctorReport, formatDoctorReport } from './doctor'
import { fictKit, type FictKitPluginOptions } from './plugin/fict-kit'
import { syncGeneratedFiles } from './sync/generate'

interface CommonCliOptions {
  config?: string
}

interface ServerCliOptions extends CommonCliOptions {
  host?: string
  port?: string
  open?: boolean
}

interface AddCliOptions extends CommonCliOptions {
  cwd?: string
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

  cli
    .command('add <features...>', 'Add optional features to an existing app')
    .option('--config <file>', 'Path to fict.config.ts')
    .option('--cwd <dir>', 'Target app directory')
    .action(async (features: string[], options: AddCliOptions) => {
      await runAdd(features, options)
    })

  cli
    .command('doctor', 'Run environment and build diagnostics')
    .option('--config <file>', 'Path to fict.config.ts')
    .action(async (options: CommonCliOptions) => {
      await runDoctor(options)
    })

  cli.help()
  cli.version('0.1.0')

  cli.parse(argv)
}

async function runDev(options: ServerCliOptions): Promise<void> {
  const cwd = process.cwd()
  const resolved = await loadConfig(cwd, options.config)
  const plugins = fictKit(toPluginOptions(options.config, resolved))
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
  const plugins = fictKit(toPluginOptions(options.config, resolved))

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
  const host = options.host ?? process.env.HOST
  const port = options.port ? toNumber(options.port) : undefined

  const nodeEntry = path.join(resolved.outDir, 'index.js')
  if (await pathExists(nodeEntry)) {
    const nodePreviewOptions: { host?: string; port?: number } = {}
    if (host !== undefined) nodePreviewOptions.host = host
    if (port !== undefined) nodePreviewOptions.port = port
    await runNodePreview(nodeEntry, nodePreviewOptions)
    return
  }

  const previewOutDir = await resolvePreviewOutDir(resolved)
  const plugins = fictKit(toPluginOptions(options.config, resolved))
  const previewOptions: NonNullable<Parameters<typeof preview>[0]>['preview'] = {}
  if (host) previewOptions.host = host
  if (port !== undefined) previewOptions.port = port
  if (options.open !== undefined) previewOptions.open = options.open

  const previewServer = await preview({
    root: cwd,
    configFile: false,
    plugins,
    build: {
      outDir: previewOutDir,
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
  const doctorOptions: { cwd: string; configFile?: string } = { cwd }
  if (options.config !== undefined) {
    doctorOptions.configFile = options.config
  }
  const doctor = await collectDoctorReport(doctorOptions)

  const clientOutDir = path.join(resolved.outDir, 'client')
  const serverOutDir = path.join(resolved.outDir, 'server')

  const payload = {
    environment: {
      node: process.versions.node,
      platform: process.platform,
      arch: process.arch,
    },
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
    build: {
      outDir: resolved.outDir,
      clientDir: clientOutDir,
      serverDir: serverOutDir,
      manifestFile: path.join(clientOutDir, 'fict.manifest.json'),
      adapterEntryFile: path.join(resolved.outDir, 'index.js'),
      exists: {
        outDir: await pathExists(resolved.outDir),
        clientDir: await pathExists(clientOutDir),
        serverDir: await pathExists(serverOutDir),
        manifestFile: await pathExists(path.join(clientOutDir, 'fict.manifest.json')),
        adapterEntryFile: await pathExists(path.join(resolved.outDir, 'index.js')),
      },
      clientFiles: await readDirSafe(clientOutDir),
      serverFiles: await readDirSafe(serverOutDir),
    },
    routes: scan.routes.map(route => ({
      id: route.id,
      path: route.routePath,
      file: route.file,
      signature: route.signature,
      score: route.score,
    })),
    diagnostics: scan.diagnostics,
    doctor,
  }

  console.log(JSON.stringify(payload, null, 2))
}

async function runDoctor(options: CommonCliOptions): Promise<void> {
  const doctorOptions: { cwd: string; configFile?: string } = { cwd: process.cwd() }
  if (options.config !== undefined) {
    doctorOptions.configFile = options.config
  }

  const report = await collectDoctorReport(doctorOptions)

  console.log(formatDoctorReport(report))
  if (report.summary.error > 0) {
    process.exitCode = 1
  }
}

async function runAdd(features: string[], options: AddCliOptions): Promise<void> {
  const cwd = options.cwd ? path.resolve(process.cwd(), options.cwd) : process.cwd()
  const addOptions: { cwd: string; features: string[]; configFile?: string } = { cwd, features }
  if (options.config !== undefined) {
    addOptions.configFile = options.config
  }

  const result = await addFeatures(addOptions)

  console.log(pc.green(`[fict-kit] added ${result.applied.length} feature(s)`))
  console.log(`  project: ${result.cwd}`)
  console.log(`  features: ${result.applied.join(', ')}`)

  if (result.files.length > 0) {
    console.log('  updated files:')
    for (const file of result.files) {
      console.log(`    - ${file}`)
    }
  }

  console.log('\nNext steps:')
  console.log('  pnpm install')
  console.log('  pnpm dev')
}

function toNumber(input?: string): number | undefined {
  if (!input) return undefined
  const parsed = Number.parseInt(input, 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function toPluginOptions(
  config?: string,
  resolved?: Pick<ResolvedFictKitConfig, 'compiler' | 'ssr'>,
): FictKitPluginOptions {
  const pluginOptions: FictKitPluginOptions = {}
  if (config) {
    pluginOptions.config = config
  }
  if (resolved) {
    pluginOptions.compiler = resolved.compiler
    pluginOptions.resumable = resolved.ssr.resumable
  }
  return pluginOptions
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

async function resolvePreviewOutDir(config: ResolvedFictKitConfig): Promise<string> {
  const staticDir = path.join(config.outDir, 'static')
  const staticMetadata = path.join(staticDir, '.fict-adapter-static.json')

  if ((await pathExists(staticMetadata)) || config.adapter?.name === '@fictjs/adapter-static') {
    return staticDir
  }

  return path.join(config.outDir, 'client')
}

async function readDirSafe(dirPath: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dirPath)
    return entries.sort((left, right) => left.localeCompare(right))
  } catch {
    return []
  }
}

async function runNodePreview(
  entryFile: string,
  options: { host?: string; port?: number },
): Promise<void> {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (options.host) env.HOST = options.host
  if (options.port !== undefined) env.PORT = String(options.port)

  console.log(pc.cyan(`[fict-kit] preview using adapter output: ${entryFile}`))

  const child = spawn(process.execPath, [entryFile], {
    stdio: 'inherit',
    env,
  })

  const stop = () => {
    child.kill('SIGTERM')
  }

  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)

  await new Promise<void>((resolve, reject) => {
    child.once('exit', code => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      if (code === 0 || code === null) {
        resolve()
      } else {
        reject(new Error(`[fict-kit] preview server exited with code ${code}`))
      }
    })
    child.once('error', reject)
  })
}
