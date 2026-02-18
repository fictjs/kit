import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

export type AddFeature =
  | 'adapter-node'
  | 'adapter-static'
  | 'eslint'
  | 'vitest'
  | 'tailwind'
  | 'playwright'

export interface AddFeaturesOptions {
  cwd?: string
  configFile?: string
  features: string[]
}

export interface AddFeaturesResult {
  cwd: string
  applied: AddFeature[]
  files: string[]
}

const FEATURE_ALIASES: Record<string, AddFeature> = {
  node: 'adapter-node',
  'adapter-node': 'adapter-node',
  static: 'adapter-static',
  'adapter-static': 'adapter-static',
  eslint: 'eslint',
  vitest: 'vitest',
  tailwind: 'tailwind',
  playwright: 'playwright',
}

const ADAPTER_FEATURES: AddFeature[] = ['adapter-node', 'adapter-static']

export function listSupportedAddFeatures(): AddFeature[] {
  return ['adapter-node', 'adapter-static', 'eslint', 'vitest', 'tailwind', 'playwright']
}

export async function addFeatures(options: AddFeaturesOptions): Promise<AddFeaturesResult> {
  if (options.features.length === 0) {
    throw new Error('[fict-kit] No features provided. Try: fict-kit add tailwind vitest')
  }

  const cwd = path.resolve(options.cwd ?? process.cwd())
  const configFilePath = options.configFile
    ? path.resolve(cwd, options.configFile)
    : path.join(cwd, 'fict.config.ts')

  const resolvedFeatures = resolveAddFeatures(options.features)
  const files = new Set<string>()
  const packageJsonPath = path.join(cwd, 'package.json')
  const packageJson = await readPackageJson(packageJsonPath)

  const scripts = packageJson.scripts ?? {}
  const dependencies = packageJson.dependencies ?? {}
  const devDependencies = packageJson.devDependencies ?? {}

  const adapterFeature = findAdapterFeature(resolvedFeatures)
  if (adapterFeature === 'adapter-static') {
    dependencies['@fictjs/adapter-static'] = '^0.1.0'
    delete dependencies['@fictjs/adapter-node']
    await updateAdapterConfig(configFilePath, 'static')
    files.add(path.relative(cwd, configFilePath))
  } else if (adapterFeature === 'adapter-node') {
    dependencies['@fictjs/adapter-node'] = '^0.1.0'
    delete dependencies['@fictjs/adapter-static']
    await updateAdapterConfig(configFilePath, 'node')
    files.add(path.relative(cwd, configFilePath))
  }

  if (resolvedFeatures.includes('eslint')) {
    scripts.lint = 'eslint .'
    devDependencies.eslint = '^9.39.2'
    devDependencies['@eslint/js'] = '^9.39.2'
    devDependencies['typescript-eslint'] = '^8.56.0'
    devDependencies['eslint-config-prettier'] = '^10.1.8'

    await writeFile(path.join(cwd, 'eslint.config.js'), ESLINT_CONFIG_SOURCE)
    files.add('eslint.config.js')
  }

  if (resolvedFeatures.includes('vitest')) {
    scripts.test = 'vitest run'
    scripts['test:watch'] = 'vitest'
    devDependencies.vitest = '^4.0.18'

    await writeFile(path.join(cwd, 'vitest.config.ts'), VITEST_CONFIG_SOURCE)
    await fs.mkdir(path.join(cwd, 'test'), { recursive: true })
    await writeFile(path.join(cwd, 'test/app.test.ts'), TEST_SOURCE)
    files.add('vitest.config.ts')
    files.add('test/app.test.ts')
  }

  if (resolvedFeatures.includes('tailwind')) {
    devDependencies.tailwindcss = '^3.4.17'
    devDependencies.postcss = '^8.5.6'
    devDependencies.autoprefixer = '^10.4.21'

    await writeFile(path.join(cwd, 'tailwind.config.ts'), TAILWIND_CONFIG_SOURCE)
    await writeFile(path.join(cwd, 'postcss.config.cjs'), POSTCSS_CONFIG_SOURCE)
    await writeFile(path.join(cwd, 'src/styles.css'), TAILWIND_STYLES_SOURCE)
    await ensureLineInFile(path.join(cwd, 'src/entry-client.ts'), "import './styles.css'")
    files.add('tailwind.config.ts')
    files.add('postcss.config.cjs')
    files.add('src/styles.css')
    files.add('src/entry-client.ts')
  }

  if (resolvedFeatures.includes('playwright')) {
    scripts['test:e2e'] = 'playwright test'
    devDependencies['@playwright/test'] = '^1.58.2'

    await writeFile(path.join(cwd, 'playwright.config.ts'), PLAYWRIGHT_CONFIG_SOURCE)
    await fs.mkdir(path.join(cwd, 'e2e'), { recursive: true })
    await writeFile(path.join(cwd, 'e2e/app.spec.ts'), PLAYWRIGHT_TEST_SOURCE)
    files.add('playwright.config.ts')
    files.add('e2e/app.spec.ts')
  }

  packageJson.scripts = sortKeys(scripts)
  packageJson.dependencies = sortKeys(dependencies)
  packageJson.devDependencies = sortKeys(devDependencies)
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`)

  return {
    cwd,
    applied: resolvedFeatures,
    files: [...files].sort((left, right) => left.localeCompare(right)),
  }
}

function resolveAddFeatures(rawFeatures: string[]): AddFeature[] {
  const tokens = rawFeatures.flatMap(feature => feature.split(','))
  const resolved: AddFeature[] = []

  for (const token of tokens) {
    const normalized = token.trim().toLowerCase()
    if (!normalized) continue

    const feature = FEATURE_ALIASES[normalized]
    if (!feature) {
      const supported = listSupportedAddFeatures().join(', ')
      throw new Error(`[fict-kit] Unknown add feature "${token}". Supported: ${supported}`)
    }

    if (!resolved.includes(feature)) {
      resolved.push(feature)
    }
  }

  const adapter = findAdapterFeature(resolved)
  if (!adapter) {
    return resolved
  }

  return [adapter, ...resolved.filter(item => !ADAPTER_FEATURES.includes(item))]
}

function findAdapterFeature(features: AddFeature[]): AddFeature | undefined {
  let adapter: AddFeature | undefined
  for (const feature of features) {
    if (ADAPTER_FEATURES.includes(feature)) {
      adapter = feature
    }
  }
  return adapter
}

async function updateAdapterConfig(configFilePath: string, adapter: 'node' | 'static'): Promise<void> {
  const defaultSource = buildDefaultAdapterConfig(adapter)

  if (!existsSync(configFilePath)) {
    await writeFile(configFilePath, defaultSource)
    return
  }

  const source = await fs.readFile(configFilePath, 'utf8')
  if (!source.includes('defineConfig(')) {
    throw new Error(
      `[fict-kit] Could not safely update ${configFilePath}. Please set adapter manually in your config.`,
    )
  }

  const adapterImport =
    adapter === 'static'
      ? "import staticAdapter from '@fictjs/adapter-static'"
      : "import node from '@fictjs/adapter-node'"
  const adapterCall = adapter === 'static' ? 'staticAdapter()' : 'node()'

  const withoutAdapterImports = source
    .split('\n')
    .filter(line => !line.includes('@fictjs/adapter-node') && !line.includes('@fictjs/adapter-static'))
    .join('\n')

  const withAdapterImport = `${adapterImport}\n${withoutAdapterImports}`.replace(/\n{3,}/g, '\n\n')
  const withAdapterProperty = withAdapterImport.includes('adapter:')
    ? withAdapterImport.replace(/adapter:\s*[^,\n]+/g, `adapter: ${adapterCall}`)
    : injectAdapterProperty(withAdapterImport, adapterCall, configFilePath)

  await writeFile(configFilePath, normalizeTrailingNewline(withAdapterProperty))
}

function buildDefaultAdapterConfig(adapter: 'node' | 'static'): string {
  if (adapter === 'static') {
    return `import staticAdapter from '@fictjs/adapter-static'\nimport { defineConfig } from '@fictjs/kit/config'\n\nexport default defineConfig({\n  appRoot: 'src',\n  routesDir: 'src/routes',\n  adapter: staticAdapter(),\n})\n`
  }

  return `import node from '@fictjs/adapter-node'\nimport { defineConfig } from '@fictjs/kit/config'\n\nexport default defineConfig({\n  appRoot: 'src',\n  routesDir: 'src/routes',\n  adapter: node(),\n})\n`
}

async function readPackageJson(packageJsonPath: string): Promise<{
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
}> {
  if (!existsSync(packageJsonPath)) {
    throw new Error(`[fict-kit] package.json not found: ${packageJsonPath}`)
  }

  const source = await fs.readFile(packageJsonPath, 'utf8')
  return JSON.parse(source) as {
    scripts?: Record<string, string>
    dependencies?: Record<string, string>
    devDependencies?: Record<string, string>
  }
}

async function ensureLineInFile(filePath: string, line: string): Promise<void> {
  if (!existsSync(filePath)) {
    await writeFile(filePath, `${line}\nimport 'virtual:fict-kit/entry-client'\n`)
    return
  }

  const source = await fs.readFile(filePath, 'utf8')
  if (source.includes(line)) {
    return
  }

  await writeFile(filePath, `${line}\n${source}`)
}

async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, content)
}

function normalizeTrailingNewline(source: string): string {
  return source.endsWith('\n') ? source : `${source}\n`
}

function sortKeys<T extends Record<string, string>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) as T
}

function injectAdapterProperty(source: string, adapterCall: string, configFilePath: string): string {
  const pattern = /defineConfig\(\s*\{/
  if (!pattern.test(source)) {
    throw new Error(
      `[fict-kit] Could not safely update ${configFilePath}. Please set adapter manually in your config.`,
    )
  }

  return source.replace(pattern, match => `${match}\n  adapter: ${adapterCall},`)
}

const ESLINT_CONFIG_SOURCE = `import eslint from '@eslint/js'\nimport prettier from 'eslint-config-prettier'\nimport tseslint from 'typescript-eslint'\n\nexport default tseslint.config(\n  {\n    ignores: ['dist/**', 'node_modules/**'],\n  },\n  eslint.configs.recommended,\n  ...tseslint.configs.recommended,\n  prettier,\n)\n`

const VITEST_CONFIG_SOURCE = `import { defineConfig } from 'vitest/config'\n\nexport default defineConfig({\n  test: {\n    environment: 'node',\n    include: ['test/**/*.test.ts'],\n  },\n})\n`

const TEST_SOURCE = `import { describe, expect, it } from 'vitest'\n\ndescribe('app', () => {\n  it('works', () => {\n    expect(1 + 1).toBe(2)\n  })\n})\n`

const TAILWIND_CONFIG_SOURCE = `import type { Config } from 'tailwindcss'\n\nconst config: Config = {\n  content: ['./index.html', './src/**/*.{ts,tsx,js,jsx}'],\n  theme: {\n    extend: {},\n  },\n  plugins: [],\n}\n\nexport default config\n`

const POSTCSS_CONFIG_SOURCE = `module.exports = {\n  plugins: {\n    tailwindcss: {},\n    autoprefixer: {},\n  },\n}\n`

const TAILWIND_STYLES_SOURCE = `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`

const PLAYWRIGHT_CONFIG_SOURCE = `import { defineConfig } from '@playwright/test'\n\nexport default defineConfig({\n  testDir: './e2e',\n  use: {\n    baseURL: 'http://127.0.0.1:5173',\n    headless: true,\n  },\n  webServer: {\n    command: 'pnpm dev',\n    url: 'http://127.0.0.1:5173',\n    reuseExistingServer: !process.env.CI,\n  },\n})\n`

const PLAYWRIGHT_TEST_SOURCE = `import { expect, test } from '@playwright/test'\n\ntest('home page renders', async ({ page }) => {\n  await page.goto('/')\n  await expect(page.getByRole('heading', { name: 'Fict Kit' })).toBeVisible()\n})\n`
