import type { PluginOption } from 'vite'

export interface FictKitPluginOptions {
  config?: string
}

export function fictKit(_options: FictKitPluginOptions = {}): PluginOption[] {
  return []
}
