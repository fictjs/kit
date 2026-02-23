import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'

import { cac } from 'cac'
import pc from 'picocolors'

type AdapterChoice = 'node' | 'static'
const ADAPTER_CHOICES: AdapterChoice[] = ['node', 'static']

interface ResolvedFeatures {
  adapter: AdapterChoice
  eslint: boolean
  vitest: boolean
  tailwind: boolean
  playwright: boolean
}

export interface CreateFictOptions {
  template?: string
  force?: boolean
  yes?: boolean
  adapter?: AdapterChoice
  eslint?: boolean
  vitest?: boolean
  tailwind?: boolean
  playwright?: boolean
}

export async function runCreateFict(argv: string[] = process.argv): Promise<void> {
  const cli = cac('create-fict')

  cli
    .command('[dir]', 'Create a new Fict Kit app')
    .option('--template <name>', 'Template name', { default: 'minimal' })
    .option('--adapter <adapter>', 'Deployment adapter: node or static')
    .option('--eslint', 'Include ESLint config')
    .option('--no-eslint', 'Exclude ESLint config')
    .option('--vitest', 'Include Vitest setup')
    .option('--no-vitest', 'Exclude Vitest setup')
    .option('--tailwind', 'Include Tailwind CSS setup')
    .option('--playwright', 'Include Playwright e2e setup')
    .option('--force', 'Overwrite target directory if it exists')
    .option('--yes', 'Skip confirmations and use defaults')
    .action(async (dir = 'fict-app', options: CreateFictOptions) => {
      const targetDir = path.resolve(process.cwd(), dir)
      const interactive = !options.yes && input.isTTY && output.isTTY
      const features = await resolveFeatures(options, interactive)

      const createOptions: CreateFictOptions = { ...features }
      if (options.template !== undefined) createOptions.template = options.template
      if (options.force !== undefined) createOptions.force = options.force
      if (options.yes !== undefined) createOptions.yes = options.yes

      const result = await scaffoldProject(targetDir, createOptions)

      const relative = path.relative(process.cwd(), result.targetDir) || '.'
      console.log(pc.green(`\n✔ Created ${relative}`))
      console.log(
        pc.dim(
          `  adapter: ${features.adapter}, eslint: ${features.eslint}, vitest: ${features.vitest}, tailwind: ${features.tailwind}, playwright: ${features.playwright}`,
        ),
      )
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
  if (existing.length > 0) {
    const canOverwrite = await shouldOverwriteDirectory(targetDir, options)
    if (!canOverwrite) {
      throw new Error(
        `[create-fict] Target directory is not empty: ${targetDir}. Use --force or --yes to overwrite.`,
      )
    }

    await fs.rm(targetDir, { recursive: true, force: true })
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

  const features = normalizeFeatureOptions(options)
  await applyFeatureSelections(targetDir, features)

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
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-._~]/g, '-')
      .replace(/^-+/, '')
      .replace(/-+$/, '') || 'fict-app'
  )
}

async function shouldOverwriteDirectory(
  targetDir: string,
  options: CreateFictOptions,
): Promise<boolean> {
  if (options.force || options.yes) {
    return true
  }

  if (!input.isTTY || !output.isTTY) {
    return false
  }

  const rl = createInterface({ input, output })
  try {
    const answer = await rl.question(
      pc.yellow(`Target directory ${targetDir} is not empty. Overwrite? [y/N] `),
    )
    const normalized = answer.trim().toLowerCase()
    return normalized === 'y' || normalized === 'yes'
  } finally {
    rl.close()
  }
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

function normalizeFeatureOptions(options: CreateFictOptions): ResolvedFeatures {
  return {
    adapter: resolveAdapterChoice(options.adapter),
    eslint: options.eslint ?? true,
    vitest: options.vitest ?? true,
    tailwind: options.tailwind ?? false,
    playwright: options.playwright ?? false,
  }
}

function resolveAdapterChoice(input: unknown): AdapterChoice {
  if (input === undefined || input === null || input === '') {
    return 'node'
  }

  if (typeof input !== 'string') {
    throw new Error(
      `[create-fict] Invalid adapter "${String(input)}". Supported adapters: ${ADAPTER_CHOICES.join(', ')}.`,
    )
  }

  const normalized = input.trim().toLowerCase()
  if (normalized === 'node' || normalized === 'static') {
    return normalized
  }

  throw new Error(
    `[create-fict] Invalid adapter "${input}". Supported adapters: ${ADAPTER_CHOICES.join(', ')}.`,
  )
}

async function resolveFeatures(
  options: CreateFictOptions,
  interactive: boolean,
): Promise<ResolvedFeatures> {
  const resolved = normalizeFeatureOptions(options)
  if (!interactive) {
    return resolved
  }

  const rl = createInterface({ input, output })
  try {
    if (!options.adapter) {
      const adapterAnswer = await rl.question(
        pc.cyan('Select adapter [node/static] (default: node): '),
      )
      const normalized = adapterAnswer.trim().toLowerCase()
      if (normalized === 'static') {
        resolved.adapter = 'static'
      }
    }

    if (options.eslint === undefined) {
      resolved.eslint = await askYesNo(rl, 'Include ESLint?', true)
    }

    if (options.vitest === undefined) {
      resolved.vitest = await askYesNo(rl, 'Include Vitest?', true)
    }

    if (options.tailwind === undefined) {
      resolved.tailwind = await askYesNo(rl, 'Include Tailwind CSS?', false)
    }

    if (options.playwright === undefined) {
      resolved.playwright = await askYesNo(rl, 'Include Playwright?', false)
    }
  } finally {
    rl.close()
  }

  return resolved
}

async function askYesNo(
  rl: ReturnType<typeof createInterface>,
  message: string,
  defaultValue: boolean,
): Promise<boolean> {
  const suffix = defaultValue ? '[Y/n]' : '[y/N]'
  const answer = await rl.question(`${message} ${suffix} `)
  const normalized = answer.trim().toLowerCase()

  if (normalized === '') return defaultValue
  if (normalized === 'y' || normalized === 'yes') return true
  if (normalized === 'n' || normalized === 'no') return false
  return defaultValue
}

async function applyFeatureSelections(targetDir: string, features: ResolvedFeatures): Promise<void> {
  const packageJsonPath = path.join(targetDir, 'package.json')
  const packageJson = JSON.parse(await fs.readFile(packageJsonPath, 'utf8')) as {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }

  const scripts = packageJson.scripts ?? {}
  const dependencies = packageJson.dependencies ?? {}
  const devDependencies = packageJson.devDependencies ?? {}

  scripts.dev = 'fict-kit dev'
  scripts.build = 'fict-kit build'
  scripts.preview = 'fict-kit preview'
  scripts.sync = 'fict-kit sync'
  scripts.inspect = 'fict-kit inspect'

  dependencies.fict = '^0.10.0'
  dependencies['@fictjs/kit'] = '^0.1.0'
  dependencies['@fictjs/router'] = '^0.10.0'

  if (features.adapter === 'static') {
    dependencies['@fictjs/adapter-static'] = '^0.1.0'
    delete dependencies['@fictjs/adapter-node']
  } else {
    dependencies['@fictjs/adapter-node'] = '^0.1.0'
    delete dependencies['@fictjs/adapter-static']
  }

  if (features.eslint) {
    scripts.lint = 'eslint .'
    devDependencies.eslint = '^9.39.2'
    devDependencies['@eslint/js'] = '^9.39.2'
    devDependencies['typescript-eslint'] = '^8.56.0'
    devDependencies['eslint-config-prettier'] = '^10.1.8'
    await fs.writeFile(path.join(targetDir, 'eslint.config.js'), ESLINT_CONFIG_SOURCE)
  } else {
    delete scripts.lint
    delete devDependencies.eslint
    delete devDependencies['@eslint/js']
    delete devDependencies['typescript-eslint']
    delete devDependencies['eslint-config-prettier']
    await removeIfExists(path.join(targetDir, 'eslint.config.js'))
  }

  if (features.vitest) {
    scripts.test = 'vitest run'
    scripts['test:watch'] = 'vitest'
    devDependencies.vitest = '^4.0.18'
    await fs.writeFile(path.join(targetDir, 'vitest.config.ts'), VITEST_CONFIG_SOURCE)
    await fs.mkdir(path.join(targetDir, 'test'), { recursive: true })
    await fs.writeFile(path.join(targetDir, 'test/app.test.ts'), TEST_SOURCE)
  } else {
    delete scripts.test
    delete scripts['test:watch']
    delete devDependencies.vitest
    await removeIfExists(path.join(targetDir, 'vitest.config.ts'))
    await fs.rm(path.join(targetDir, 'test'), { recursive: true, force: true })
  }

  if (features.tailwind) {
    devDependencies.tailwindcss = '^3.4.17'
    devDependencies.postcss = '^8.5.6'
    devDependencies.autoprefixer = '^10.4.21'
    await fs.writeFile(path.join(targetDir, 'tailwind.config.ts'), TAILWIND_CONFIG_SOURCE)
    await fs.writeFile(path.join(targetDir, 'postcss.config.cjs'), POSTCSS_CONFIG_SOURCE)
    await fs.writeFile(path.join(targetDir, 'src/styles.css'), TAILWIND_STYLES_SOURCE)
    await ensureLineInFile(path.join(targetDir, 'src/entry-client.ts'), "import './styles.css'")
  } else {
    delete devDependencies.tailwindcss
    delete devDependencies.postcss
    delete devDependencies.autoprefixer
    await removeIfExists(path.join(targetDir, 'tailwind.config.ts'))
    await removeIfExists(path.join(targetDir, 'postcss.config.cjs'))
    await removeIfExists(path.join(targetDir, 'src/styles.css'))
    await removeLineFromFile(path.join(targetDir, 'src/entry-client.ts'), "import './styles.css'")
  }

  if (features.playwright) {
    scripts['test:e2e'] = 'playwright test'
    devDependencies['@playwright/test'] = '^1.58.2'
    await fs.writeFile(path.join(targetDir, 'playwright.config.ts'), PLAYWRIGHT_CONFIG_SOURCE)
    await fs.mkdir(path.join(targetDir, 'e2e'), { recursive: true })
    await fs.writeFile(path.join(targetDir, 'e2e/app.spec.ts'), PLAYWRIGHT_TEST_SOURCE)
  } else {
    delete scripts['test:e2e']
    delete devDependencies['@playwright/test']
    await removeIfExists(path.join(targetDir, 'playwright.config.ts'))
    await fs.rm(path.join(targetDir, 'e2e'), { recursive: true, force: true })
  }

  packageJson.scripts = sortKeys(scripts)
  packageJson.dependencies = sortKeys(dependencies)
  packageJson.devDependencies = sortKeys(devDependencies)

  await fs.writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)
  await writeFictConfig(targetDir, features.adapter)
}

async function writeFictConfig(targetDir: string, adapter: AdapterChoice): Promise<void> {
  const source =
    adapter === 'static'
      ? `import staticAdapter from '@fictjs/adapter-static'\nimport { defineConfig } from '@fictjs/kit/config'\n\nexport default defineConfig({\n  appRoot: 'src',\n  routesDir: 'src/routes',\n  adapter: staticAdapter(),\n})\n`
      : `import node from '@fictjs/adapter-node'\nimport { defineConfig } from '@fictjs/kit/config'\n\nexport default defineConfig({\n  appRoot: 'src',\n  routesDir: 'src/routes',\n  adapter: node(),\n})\n`

  await fs.writeFile(path.join(targetDir, 'fict.config.ts'), source)
}

async function removeIfExists(filePath: string): Promise<void> {
  if (existsSync(filePath)) {
    await fs.rm(filePath, { force: true })
  }
}

async function ensureLineInFile(filePath: string, line: string): Promise<void> {
  const source = await fs.readFile(filePath, 'utf8')
  if (source.includes(line)) {
    return
  }
  await fs.writeFile(filePath, `${line}\n${source}`)
}

async function removeLineFromFile(filePath: string, line: string): Promise<void> {
  if (!existsSync(filePath)) return
  const source = await fs.readFile(filePath, 'utf8')
  const next = source
    .split('\n')
    .filter(item => item.trim() !== line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
  await fs.writeFile(filePath, next.endsWith('\n') ? next : `${next}\n`)
}

function sortKeys<T extends Record<string, string>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) as T
}

const ESLINT_CONFIG_SOURCE = `import eslint from '@eslint/js'\nimport prettier from 'eslint-config-prettier'\nimport tseslint from 'typescript-eslint'\n\nexport default tseslint.config(\n  {\n    ignores: ['dist/**', 'node_modules/**'],\n  },\n  eslint.configs.recommended,\n  ...tseslint.configs.recommended,\n  prettier,\n)\n`

const VITEST_CONFIG_SOURCE = `import { defineConfig } from 'vitest/config'\n\nexport default defineConfig({\n  test: {\n    environment: 'node',\n    include: ['test/**/*.test.ts'],\n  },\n})\n`

const TEST_SOURCE = `import { describe, expect, it } from 'vitest'\n\ndescribe('app', () => {\n  it('works', () => {\n    expect(1 + 1).toBe(2)\n  })\n})\n`

const TAILWIND_CONFIG_SOURCE = `import type { Config } from 'tailwindcss'\n\nconst config: Config = {\n  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n}\n\nexport default config\n`

const POSTCSS_CONFIG_SOURCE = `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n}\n`

const TAILWIND_STYLES_SOURCE = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`

const PLAYWRIGHT_CONFIG_SOURCE = `import { defineConfig } from '@playwright/test'\n\nexport default defineConfig({\n  testDir: './e2e',\n  use: {\n    baseURL: 'http://127.0.0.1:5173',\n    headless: true,\n  },\n  webServer: {\n    command: 'pnpm dev',\n    url: 'http://127.0.0.1:5173',\n    reuseExistingServer: !process.env.CI,\n  },\n})\n`

const PLAYWRIGHT_TEST_SOURCE = `import { expect, test } from '@playwright/test'\n\ntest('home page renders', async ({ page }) => {\n  await page.goto('/')\n  await expect(page.getByRole('heading', { name: 'Fict Kit' })).toBeVisible()\n})\n`
