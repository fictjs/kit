import { promises as fs } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { loadConfig } from './config'
import { scanRoutes } from './core/routes/scan'

export type DoctorCheckStatus = 'ok' | 'warn' | 'error'

export interface DoctorCheck {
  id: string
  status: DoctorCheckStatus
  message: string
  detail: string
}

export interface DoctorReport {
  checks: DoctorCheck[]
  summary: {
    ok: number
    warn: number
    error: number
  }
}

export interface CollectDoctorReportOptions {
  cwd?: string
  configFile?: string
}

export async function collectDoctorReport(
  options: CollectDoctorReportOptions = {},
): Promise<DoctorReport> {
  const cwd = path.resolve(options.cwd ?? process.cwd())
  const checks: DoctorCheck[] = []

  const nodeVersion = process.versions.node
  const nodeMajor = Number.parseInt(nodeVersion.split('.')[0] ?? '0', 10)
  if (nodeMajor >= 20) {
    checks.push({
      id: 'node_version',
      status: 'ok',
      message: 'Node.js version',
      detail: nodeVersion,
    })
  } else {
    checks.push({
      id: 'node_version',
      status: 'error',
      message: 'Node.js version',
      detail: `${nodeVersion} (requires >= 20)`,
    })
  }

  const viteVersion = resolveViteVersion()
  checks.push({
    id: 'vite_version',
    status: viteVersion ? 'ok' : 'warn',
    message: 'Vite version',
    detail: viteVersion ?? 'Could not resolve vite/package.json',
  })

  const packageJson = await readPackageJson(cwd)
  if (packageJson) {
    const deps = {
      ...(packageJson.dependencies ?? {}),
      ...(packageJson.devDependencies ?? {}),
    } as Record<string, string>

    checks.push({
      id: 'dep_kit',
      status: deps['@fictjs/kit'] ? 'ok' : 'warn',
      message: '@fictjs/kit dependency',
      detail: deps['@fictjs/kit'] ?? 'Missing from package.json',
    })

    checks.push({
      id: 'dep_fict',
      status: deps.fict ? 'ok' : 'warn',
      message: 'fict dependency',
      detail: deps.fict ?? 'Missing from package.json',
    })
  } else {
    checks.push({
      id: 'package_json',
      status: 'warn',
      message: 'package.json',
      detail: `Not found in ${cwd}`,
    })
  }

  let resolvedConfig
  try {
    resolvedConfig = await loadConfig(cwd, options.configFile)
  } catch (error) {
    checks.push({
      id: 'config_load',
      status: 'error',
      message: 'Load fict config',
      detail: error instanceof Error ? error.message : String(error),
    })
    return finalizeReport(checks)
  }

  checks.push({
    id: 'config_file',
    status: resolvedConfig.configFile ? 'ok' : 'warn',
    message: 'Config file',
    detail: resolvedConfig.configFile ?? 'Using implicit defaults',
  })

  const scan = await scanRoutes({ routesDir: resolvedConfig.routesDir })
  checks.push({
    id: 'routes_count',
    status: scan.routes.length > 0 ? 'ok' : 'warn',
    message: 'Route files',
    detail: `${scan.routes.length} route(s) in ${resolvedConfig.routesDir}`,
  })

  for (const [index, diagnostic] of scan.diagnostics.entries()) {
    checks.push({
      id: `route_diag_${index}`,
      status: diagnostic.level === 'error' ? 'error' : 'warn',
      message: 'Route diagnostics',
      detail: diagnostic.message,
    })
  }

  const outDir = resolvedConfig.outDir
  const clientDir = path.join(outDir, 'client')
  const serverDir = path.join(outDir, 'server')
  const manifestFile = path.join(clientDir, 'fict.manifest.json')
  const adapterEntry = path.join(outDir, 'index.js')

  checks.push(await makePathCheck('out_dir', 'Build outDir', outDir))
  checks.push(await makePathCheck('client_dir', 'Client output dir', clientDir))
  checks.push(await makePathCheck('server_dir', 'Server output dir', serverDir))
  checks.push(await makePathCheck('manifest_file', 'Client manifest', manifestFile))

  if (resolvedConfig.adapter?.name === '@fictjs/adapter-node') {
    checks.push(await makePathCheck('adapter_entry', 'Adapter node entry', adapterEntry))
  } else {
    const hasAdapterEntry = await pathExists(adapterEntry)
    checks.push({
      id: 'adapter_entry',
      status: hasAdapterEntry ? 'ok' : 'warn',
      message: 'Adapter entry',
      detail: hasAdapterEntry
        ? adapterEntry
        : 'No adapter runtime entry found at dist/index.js',
    })
  }

  return finalizeReport(checks)
}

export function formatDoctorReport(report: DoctorReport): string {
  const lines = [
    '[fict-kit] doctor report',
    `summary: ${report.summary.ok} ok, ${report.summary.warn} warn, ${report.summary.error} error`,
  ]

  for (const check of report.checks) {
    lines.push(`- [${check.status.toUpperCase()}] ${check.message}: ${check.detail}`)
  }

  return lines.join('\n')
}

async function makePathCheck(id: string, message: string, filePath: string): Promise<DoctorCheck> {
  const exists = await pathExists(filePath)
  return {
    id,
    status: exists ? 'ok' : 'warn',
    message,
    detail: exists ? filePath : `Missing: ${filePath}`,
  }
}

function finalizeReport(checks: DoctorCheck[]): DoctorReport {
  const summary = {
    ok: 0,
    warn: 0,
    error: 0,
  }

  for (const check of checks) {
    if (check.status === 'ok') summary.ok += 1
    if (check.status === 'warn') summary.warn += 1
    if (check.status === 'error') summary.error += 1
  }

  return { checks, summary }
}

async function readPackageJson(cwd: string): Promise<Record<string, unknown> | null> {
  const filePath = path.join(cwd, 'package.json')
  try {
    const source = await fs.readFile(filePath, 'utf8')
    return JSON.parse(source) as Record<string, unknown>
  } catch {
    return null
  }
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

function resolveViteVersion(): string | null {
  try {
    const require = createRequire(import.meta.url)
    const pkg = require('vite/package.json') as { version?: string }
    return pkg.version ?? null
  } catch {
    return null
  }
}
