import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { cac } from 'cac'
import pc from 'picocolors'

export interface CreateFictOptions {
  template?: string
  force?: boolean
  yes?: boolean
}

export async function runCreateFict(argv: string[] = process.argv): Promise<void> {
  const cli = cac('create-fict')

  cli
    .command('[dir]', 'Create a new Fict Kit app')
    .option('--template <name>', 'Template name', { default: 'minimal' })
    .option('--force', 'Overwrite target directory if it exists')
    .option('--yes', 'Skip confirmations')
    .action(async (dir = 'fict-app', options: CreateFictOptions) => {
      const targetDir = path.resolve(process.cwd(), dir)
      const createOptions: CreateFictOptions = {}
      if (options.template !== undefined) createOptions.template = options.template
      if (options.force !== undefined) createOptions.force = options.force
      if (options.yes !== undefined) createOptions.yes = options.yes

      const result = await scaffoldProject(targetDir, createOptions)

      const relative = path.relative(process.cwd(), result.targetDir) || '.'
      console.log(pc.green(`\n✔ Created ${relative}`))
      console.log('\nNext steps:')
      console.log(`  cd ${relative}`)
      console.log('  pnpm install')
      console.log('  pnpm dev')
    })

  cli.help()
  cli.version('0.1.0')
  cli.parse(argv)
}

export interface ScaffoldProjectResult {
  targetDir: string
  templateDir: string
}

export async function scaffoldProject(
  targetDir: string,
  options: CreateFictOptions = {},
): Promise<ScaffoldProjectResult> {
  const templateName = options.template ?? 'minimal'
  const templateDir = resolveTemplateDir(templateName)

  const existing = await readDirSafe(targetDir)
  if (existing.length > 0 && !options.force) {
    throw new Error(
      `[create-fict] Target directory is not empty: ${targetDir}. Use --force to overwrite.`,
    )
  }

  await fs.mkdir(targetDir, { recursive: true })
  await copyDirectory(templateDir, targetDir)

  const packageJsonPath = path.join(targetDir, 'package.json')
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
    name?: string
    [key: string]: unknown
  }

  packageJson.name = normalizePackageName(path.basename(targetDir))
  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

  return { targetDir, templateDir }
}

function resolveTemplateDir(templateName: string): string {
  const currentFile = fileURLToPath(import.meta.url)
  const packageRoot = path.resolve(path.dirname(currentFile), '..')
  const templateDir = path.join(packageRoot, 'templates', templateName)

  if (!existsSync(templateDir)) {
    throw new Error(`[create-fict] Unknown template "${templateName}".`)
  }

  return templateDir
}

function normalizePackageName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-._~]/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '') || 'fict-app'
}

async function copyDirectory(from: string, to: string): Promise<void> {
  const entries = await fs.readdir(from, { withFileTypes: true })

  for (const entry of entries) {
    const source = path.join(from, entry.name)
    const target = path.join(to, entry.name)

    if (entry.isDirectory()) {
      await fs.mkdir(target, { recursive: true })
      await copyDirectory(source, target)
    } else if (entry.isFile()) {
      await fs.copyFile(source, target)
    }
  }
}

async function readDirSafe(targetDir: string): Promise<string[]> {
  try {
    return await fs.readdir(targetDir)
  } catch {
    return []
  }
}
