import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { DEFAULT_CONFIG } from './defaults.js'
import { interpolateEnv } from './env.js'
import { ConfigError } from './errors.js'
import { mergeConfig } from './merge.js'
import { parseConfig } from './parse.js'
import { parseModelReference } from './providers.js'
import type { ConfigPatch, ConfigSource, LoadedConfig } from './types.js'

export interface LoadConfigOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  home?: string
  cli?: ConfigPatch
  /** Injected in tests; return undefined when the file does not exist. */
  readFile?: (path: string) => string | undefined
}

function defaultReadFile(path: string): string | undefined {
  try {
    return readFileSync(path, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function readConfigFile(
  path: string,
  env: NodeJS.ProcessEnv,
  warnings: string[],
  readFile: (path: string) => string | undefined,
): ConfigPatch | undefined {
  const text = readFile(path)
  if (text === undefined) return undefined

  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new ConfigError(`invalid JSON: ${message}`, path)
  }

  const parsed = parseConfig(raw, path)
  warnings.push(...parsed.warnings)
  return interpolateEnv(parsed.value, env, path, warnings)
}

function applyEnvOverrides(env: NodeJS.ProcessEnv, warnings: string[]): ConfigPatch {
  const patch: ConfigPatch = {}

  if (env.OPCECODE_MODEL && env.OPCECODE_MODEL.trim() !== '') {
    patch.model = env.OPCECODE_MODEL.trim()
  }

  if (env.OPCECODE_MAX_STEPS && env.OPCECODE_MAX_STEPS.trim() !== '') {
    const maxSteps = Number(env.OPCECODE_MAX_STEPS)
    if (Number.isInteger(maxSteps) && maxSteps > 0) {
      patch.context = { maxSteps }
    } else {
      warnings.push(
        `Ignoring OPCECODE_MAX_STEPS="${env.OPCECODE_MAX_STEPS}": expected a positive integer`,
      )
    }
  }

  return patch
}

/**
 * Load configuration with this precedence, lowest to highest:
 * defaults < global < project < environment < CLI flags.
 *
 * Arrays replace; objects merge. The returned `sources` list is used by
 * `opcecode doctor` to show exactly which files were read.
 */
export function loadConfig(options: LoadConfigOptions): LoadedConfig {
  const env = options.env ?? process.env
  const cwd = resolve(options.cwd)
  const home = options.home ?? env.OPCECODE_HOME ?? join(homedir(), '.opcecode')
  const readFile = options.readFile ?? defaultReadFile
  const warnings: string[] = []

  const globalPath = join(home, 'config.json')
  const projectPath = env.OPCECODE_CONFIG
    ? resolve(cwd, env.OPCECODE_CONFIG)
    : join(cwd, 'opcecode.json')

  const sources: ConfigSource[] = [
    { path: globalPath, kind: 'global', found: false },
    { path: projectPath, kind: 'project', found: false },
  ]

  let config = DEFAULT_CONFIG

  for (const source of sources) {
    const patch = readConfigFile(source.path, env, warnings, readFile)
    if (patch === undefined) continue
    source.found = true
    config = mergeConfig(config, patch)
  }

  config = mergeConfig(config, applyEnvOverrides(env, warnings))
  if (options.cli) config = mergeConfig(config, options.cli)

  if (config.model.trim() === '') {
    warnings.push(
      'No model configured. Run `opcecode init --preset openrouter-free` or set OPCECODE_MODEL.',
    )
  } else {
    const reference = parseModelReference(config.model)
    if (!reference) {
      warnings.push(
        `Model "${config.model}" must be in "provider/model" form, for example "openrouter/openrouter/free".`,
      )
    } else if (!config.providers[reference.providerID]) {
      const known = Object.keys(config.providers).join(', ') || 'none'
      warnings.push(
        `Model "${config.model}" uses provider "${reference.providerID}", which is not configured (configured: ${known}).`,
      )
    }
  }

  return { config, sources, warnings }
}

export function configHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.OPCECODE_HOME ?? join(homedir(), '.opcecode')
}
