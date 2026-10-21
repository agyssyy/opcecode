const ENV_REFERENCE = /\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Replace `${env:NAME}` references anywhere in a config document.
 *
 * Missing variables become empty strings and produce a warning instead of a
 * hard failure: `opcecode doctor` must stay runnable before a key is set, and
 * the doctor reports the missing key as its own check.
 */
export function interpolateEnv<T>(
  value: T,
  env: NodeJS.ProcessEnv,
  file: string,
  warnings: string[],
): T {
  if (typeof value === 'string') {
    return value.replace(ENV_REFERENCE, (_match, name: string) => {
      const resolved = env[name]
      if (resolved === undefined) {
        warnings.push(`Environment variable "${name}" is not set (referenced in ${file})`)
        return ''
      }
      return resolved
    }) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateEnv(item, env, file, warnings)) as T
  }

  if (isRecord(value)) {
    const result: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      result[key] = interpolateEnv(item, env, file, warnings)
    }
    return result as T
  }

  return value
}
