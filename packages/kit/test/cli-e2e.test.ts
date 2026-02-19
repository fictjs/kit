import { spawn, type ChildProcess } from 'node:child_process'
import { promises as fs } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { scaffoldProject } from '../../create-fict/src/index'

const dirs: string[] = []
const childProcesses: ChildProcess[] = []

const kitPackageRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)))
const repoRoot = path.resolve(kitPackageRoot, '..', '..')
const adapterNodePackageRoot = path.join(repoRoot, 'packages', 'adapter-node')
const fixtureRootBase = path.join(kitPackageRoot, '.tmp-tests')
const cliBinPath = path.join(kitPackageRoot, 'bin', 'fict-kit.js')

afterEach(async () => {
  await Promise.allSettled(childProcesses.map(child => stopChildProcess(child)))
  childProcesses.length = 0

  await Promise.allSettled(dirs.map(dir => fs.rm(dir, { recursive: true, force: true })))
  dirs.length = 0
})

describe('cli e2e', () => {
  it(
    'runs build and preview commands for a scaffolded app',
    async () => {
      await ensurePackageBuilt({
        packageName: '@fictjs/kit',
        artifact: path.join(kitPackageRoot, 'dist', 'cli.js'),
      })
      await ensurePackageBuilt({
        packageName: '@fictjs/adapter-node',
        artifact: path.join(adapterNodePackageRoot, 'dist', 'index.js'),
      })

      const fixtureRoot = await createFixture('cli-e2e')
      await linkWorkspacePackage(fixtureRoot, '@fictjs/kit', kitPackageRoot)
      await linkWorkspacePackage(fixtureRoot, '@fictjs/adapter-node', adapterNodePackageRoot)

      await runCliCommand(['build'], fixtureRoot)

      await expect(fs.stat(path.join(fixtureRoot, 'dist', 'client', 'index.html'))).resolves.toBeDefined()
      await expect(fs.stat(path.join(fixtureRoot, 'dist', 'server', 'entry-server.js'))).resolves.toBeDefined()
      await expect(fs.stat(path.join(fixtureRoot, 'dist', 'index.js'))).resolves.toBeDefined()

      const port = await getAvailablePort()
      const previewProcess = spawn(
        process.execPath,
        [cliBinPath, 'preview', '--host', '127.0.0.1', '--port', String(port)],
        {
          cwd: fixtureRoot,
          env: process.env,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      childProcesses.push(previewProcess)

      let logs = ''
      previewProcess.stdout?.on('data', chunk => {
        logs += chunk.toString()
      })
      previewProcess.stderr?.on('data', chunk => {
        logs += chunk.toString()
      })

      const baseUrl = `http://127.0.0.1:${port}`
      await waitForHttpReady(`${baseUrl}/`, previewProcess, () => logs)

      const homeResponse = await fetch(`${baseUrl}/`)
      expect(homeResponse.status).toBe(200)
      const homeHtml = await homeResponse.text()
      expect(homeHtml).toContain('id="__FICT_SNAPSHOT__"')
      expect(homeHtml).toContain('"pathname":"/"')

      const aboutResponse = await fetch(`${baseUrl}/about`)
      expect(aboutResponse.status).toBe(200)
      const aboutHtml = await aboutResponse.text()
      expect(aboutHtml).toContain('"pathname":"/about"')

      expect(logs).toContain('Node server running')
    },
    180_000,
  )
})

async function createFixture(prefix: string): Promise<string> {
  await fs.mkdir(fixtureRootBase, { recursive: true })
  const fixtureRoot = await fs.mkdtemp(path.join(fixtureRootBase, `${prefix}-`))
  dirs.push(fixtureRoot)

  await scaffoldProject(fixtureRoot, { template: 'minimal', yes: true })
  return fixtureRoot
}

async function ensurePackageBuilt(args: { packageName: string; artifact: string }): Promise<void> {
  if (await pathExists(args.artifact)) {
    return
  }

  await runCommand('pnpm', ['--filter', args.packageName, 'build'], repoRoot)
}

async function linkWorkspacePackage(
  fixtureRoot: string,
  packageName: string,
  packageRoot: string,
): Promise<void> {
  const [scope, name] = packageName.split('/')
  if (!scope || !name) {
    throw new Error(`Invalid package name: ${packageName}`)
  }

  const scopeDir = path.join(fixtureRoot, 'node_modules', scope)
  await fs.mkdir(scopeDir, { recursive: true })

  const linkPath = path.join(scopeDir, name)
  try {
    await fs.symlink(packageRoot, linkPath, 'dir')
  } catch (error) {
    const maybeErr = error as NodeJS.ErrnoException
    if (maybeErr.code !== 'EEXIST') {
      throw error
    }
  }
}

async function runCliCommand(args: string[], cwd: string): Promise<void> {
  await runCommand(process.execPath, [cliBinPath, ...args], cwd)
}

async function runCommand(command: string, args: string[], cwd: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let output = ''
    child.stdout?.on('data', chunk => {
      output += chunk.toString()
    })
    child.stderr?.on('data', chunk => {
      output += chunk.toString()
    })

    child.on('error', reject)
    child.on('close', code => {
      if (code === 0) {
        resolve()
        return
      }

      reject(new Error(`Command failed: ${command} ${args.join(' ')}\n${output}`))
    })
  })
}

async function getAvailablePort(): Promise<number> {
  return await new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to resolve an ephemeral port'))
        return
      }

      const port = address.port
      server.close(error => {
        if (error) {
          reject(error)
          return
        }
        resolve(port)
      })
    })
  })
}

async function waitForHttpReady(
  url: string,
  child: ChildProcess,
  getLogs: () => string,
): Promise<void> {
  const start = Date.now()
  const timeoutMs = 15_000

  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(
        `Preview server exited before becoming ready (code: ${child.exitCode}).\n${getLogs()}`,
      )
    }

    try {
      const response = await fetch(url)
      if (response.status < 500) {
        return
      }
    } catch {
      // Server not listening yet.
    }

    await sleep(150)
  }

  throw new Error(`Timed out waiting for ${url}.\n${getLogs()}`)
}

async function stopChildProcess(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) {
    return
  }

  child.kill('SIGTERM')
  await waitForChildExit(child, 3_000)

  if (child.exitCode === null) {
    child.kill('SIGKILL')
    await waitForChildExit(child, 3_000)
  }
}

async function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      return
    }
    await sleep(50)
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}
