import { promises as fs } from 'node:fs'
import path from 'node:path'

import type { Adapter, AdapterContext } from '@fictjs/kit'

export interface AdapterStaticOptions {
  outDir?: string
  fallback?: string
}

export function adapterStatic(options: AdapterStaticOptions = {}): Adapter {
  return {
    name: '@fictjs/adapter-static',
    async adapt(context) {
      const targetDir = resolveTargetDir(context, options.outDir)

      await fs.rm(targetDir, { recursive: true, force: true })
      await copyDirectory(context.clientDir, targetDir)

      const fallbackTarget = options.fallback ?? '404.html'
      const indexHtml = path.join(targetDir, 'index.html')
      const fallbackHtml = path.join(targetDir, fallbackTarget)

      if (await pathExists(indexHtml) && !(await pathExists(fallbackHtml))) {
        await fs.copyFile(indexHtml, fallbackHtml)
      }

      const metadata = {
        adapter: '@fictjs/adapter-static',
        generatedAt: new Date().toISOString(),
        sourceClientDir: context.clientDir,
      }

      await fs.writeFile(path.join(targetDir, '.fict-adapter-static.json'), `${JSON.stringify(metadata, null, 2)}\n`)
    },
  }
}

export default adapterStatic

function resolveTargetDir(context: AdapterContext, outDir?: string): string {
  if (!outDir) {
    return path.join(context.outDir, 'static')
  }

  return path.isAbsolute(outDir) ? outDir : path.join(context.outDir, outDir)
}

async function copyDirectory(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true })
  const entries = await fs.readdir(from, { withFileTypes: true })

  for (const entry of entries) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)

    if (entry.isDirectory()) {
      await copyDirectory(source, target)
    } else if (entry.isFile()) {
      await fs.mkdir(path.dirname(target), { recursive: true })
      await fs.copyFile(source, target)
    }
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
