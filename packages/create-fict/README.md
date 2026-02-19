# create-fict

Scaffolder for [Fict Kit](https://github.com/fictjs/kit) projects. Creates a new Fict Kit application with file-based routing, SSR, and your choice of tooling.

## Usage

```bash
# npm
npm create fict@latest my-app

# pnpm
pnpm create fict my-app

# npx
npx create-fict my-app
```

Without flags, the CLI runs interactively, prompting you to select an adapter, ESLint, Vitest, Tailwind CSS, and Playwright.

## Options

```bash
create-fict [dir] [options]

Options:
  --template <name>     Template name (default: minimal)
  --adapter <adapter>   Deployment adapter: node or static (default: node)
  --eslint              Include ESLint config (default: true)
  --no-eslint           Exclude ESLint config
  --vitest              Include Vitest setup (default: true)
  --no-vitest           Exclude Vitest setup
  --tailwind            Include Tailwind CSS setup (default: false)
  --playwright          Include Playwright e2e setup (default: false)
  --force               Overwrite target directory if it exists
  --yes                 Skip confirmations and use defaults
```

## Examples

```bash
# Quick start with all defaults (node adapter, eslint, vitest)
pnpm create fict my-app --yes

# Static site with Tailwind
pnpm create fict my-blog --adapter static --tailwind --yes

# Disable Vitest in non-interactive mode
pnpm create fict my-app --no-vitest --yes

# Full setup with all tooling
pnpm create fict my-app --tailwind --playwright --yes
```

## Generated Project Structure

```
my-app/
  fict.config.ts          # Kit configuration with adapter
  index.html              # HTML shell
  tsconfig.json           # TypeScript config
  package.json            # Dependencies and scripts
  src/
    entry-client.ts       # Client entry point
    routes/
      index.tsx           # Home page with data loading
      about.tsx           # About page
      users/
        [id].tsx          # Dynamic route with params
  eslint.config.js        # (if --eslint)
  vitest.config.ts        # (if --vitest)
  test/
    app.test.ts           # (if --vitest)
  tailwind.config.ts      # (if --tailwind)
  postcss.config.cjs      # (if --tailwind)
  src/styles.css          # (if --tailwind)
  playwright.config.ts    # (if --playwright)
  e2e/
    app.spec.ts           # (if --playwright)
```

## Scripts

The generated project includes:

```bash
pnpm dev       # Start dev server with HMR
pnpm build     # Build for production
pnpm preview   # Preview production build
pnpm sync      # Generate route type declarations
pnpm inspect   # Print config and diagnostics
pnpm lint      # Lint with ESLint (if enabled)
pnpm test      # Run tests with Vitest (if enabled)
pnpm test:e2e  # Run e2e tests with Playwright (if enabled)
```

## Programmatic API

```ts
import { scaffoldProject } from 'create-fict'

const result = await scaffoldProject('/path/to/my-app', {
  adapter: 'node',
  eslint: true,
  vitest: true,
  tailwind: false,
  playwright: false,
})
```

## License

[MIT](../../LICENSE)
