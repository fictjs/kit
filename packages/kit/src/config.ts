export interface FictKitConfig {
  appRoot?: string
  routesDir?: string
  outDir?: string
}

export function defineConfig(config: FictKitConfig): FictKitConfig {
  return config
}

export function mergeConfigDefaults(config: FictKitConfig): Required<FictKitConfig> {
  return {
    appRoot: config.appRoot ?? 'src',
    routesDir: config.routesDir ?? 'src/routes',
    outDir: config.outDir ?? 'dist',
  }
}

export async function loadConfig(_cwd: string = process.cwd()): Promise<Required<FictKitConfig>> {
  return mergeConfigDefaults({})
}
