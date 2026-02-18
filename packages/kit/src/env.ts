export function getPublicEnv(prefix = 'PUBLIC_'): Record<string, string> {
  const out: Record<string, string> = {}

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(prefix) && typeof value === 'string') {
      out[key] = value
    }
  }

  return out
}
