import { writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DEFAULT_CONFIG, getPreset, parseModelReference, presetIds } from '@opcecode/config'
import { UsageError } from '../args.js'
import { createStyler } from '../theme.js'

export interface InitOptions {
  cwd: string
  preset?: string
  model?: string
  force?: boolean
  color?: boolean
}

export interface InitOutcome {
  path: string
  presetID: string
  model: string
  envVars: string[]
}

function requiredEnvVars(config: unknown): string[] {
  const text = JSON.stringify(config)
  const found = new Set<string>()
  for (const match of text.matchAll(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g)) {
    const name = match[1]
    if (name) found.add(name)
  }
  return [...found]
}

function buildConfig(options: InitOptions) {
  const presetID = options.preset ?? 'openrouter-free'
  const preset = getPreset(presetID)
  if (!preset) {
    throw new UsageError(`Unknown preset "${presetID}". Available: ${presetIds().join(', ')}`)
  }

  const providers = preset.config.providers ?? {}
  let model = preset.config.model ?? ''
  if (options.model) {
    const reference = parseModelReference(options.model)
    if (!reference) {
      throw new UsageError(`--model must be "provider/model", got "${options.model}"`)
    }
    if (!providers[reference.providerID]) {
      throw new UsageError(
        `Preset "${preset.id}" configures provider "${Object.keys(providers).join(', ') || 'none'}", not "${reference.providerID}"`,
      )
    }
    model = options.model
  }

  const config = {
    model,
    providers,
    permissions: DEFAULT_CONFIG.permissions,
  }

  return { config, preset, presetID, model }
}

export function writePresetConfig(options: InitOptions): InitOutcome {
  const { config, presetID, model } = buildConfig(options)
  const path = join(resolve(options.cwd), 'opcecode.json')

  try {
    writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, {
      encoding: 'utf8',
      flag: options.force ? 'w' : 'wx',
    })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new UsageError(`${path} already exists. Use --force to overwrite it.`)
    }
    throw error
  }

  return { path, presetID, model, envVars: requiredEnvVars(config) }
}

export function runInit(options: InitOptions): number {
  const outcome = writePresetConfig(options)
  const styles = createStyler(options.color ?? false)

  const lines: string[] = [
    styles.green('Created opcecode.json'),
    styles.dim(`  ${outcome.path}`),
    '',
    `Preset: ${outcome.presetID}`,
    `Model:  ${outcome.model}`,
    '',
    'Next:',
  ]

  if (outcome.envVars.length > 0) {
    lines.push(`  1. Set ${outcome.envVars.join(', ')} in your environment.`)
    lines.push('  2. Run: opcecode doctor')
  } else {
    lines.push('  1. Start your local OpenAI-compatible server (LM Studio or vLLM).')
    lines.push('  2. Run: opcecode doctor')
  }
  lines.push('  Edit opcecode.json any time to change the model or provider.')

  console.log(lines.join('\n'))
  return 0
}
