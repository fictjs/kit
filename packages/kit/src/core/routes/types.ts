export interface Diagnostic {
  level: 'error' | 'warn'
  message: string
  file?: string
}

export type RouteSegment =
  | { kind: 'static'; value: string }
  | { kind: 'param'; name: string }
  | { kind: 'optional-param'; name: string }
  | { kind: 'rest'; name: string }

export interface RouteRecord {
  id: string
  file: string
  routePath: string
  segments: RouteSegment[]
  signature: string
  score: number
}

export interface ScanRoutesResult {
  routes: RouteRecord[]
  diagnostics: Diagnostic[]
}
