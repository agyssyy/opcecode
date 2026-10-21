import { spawnSync } from 'node:child_process'
import { accessSync, constants, mkdirSync, statSync } from 'node:fs'
import { arch, platform } from 'node:os'
import { resolve } from 'node:path'
import {
  ConfigError,
  configHome,
  type LoadedConfig,
  loadConfig,
  resolveApiKey,
  resolveModel,
} from '@opcecode/config'
import { createStyler } from '../theme.js'

export type CheckStatus = 'ok' | 'warn' | 'fail'

export interface Check {
  id: string
  label: string
  status: CheckStatus
  detail: string
  fix?: string
}

export interface CommandResult {
  ok: boolean
  stdout: string
  stderr: string
}

export type CommandRunner = (command: string, args: string[]) => CommandResult

export interface CollectOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  run?: CommandRunner
  load?: (cwd: string) => LoadedConfig
  ensureHome?: (path: string) => void
}

export interface DoctorOptions extends CollectOptions {
  json: boolean
  color: boolean
}

const MIN_NODE_MAJOR = 20
const MIN_PYTHON: [number, number] = [3, 11]

function defaultRun(command: string, args: string[]): CommandResult {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  })
  if (result.error) {
    return { ok: false, stdout: '', stderr: result.error.message }
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

function firstLine(text: string): string {
  const line = text.split(/\r?\n/).find((entry) => entry.trim() !== '')
  return line?.trim() ?? ''
}

function truncate(text: string, limit = 160): string {
  return text.length <= limit ? text : `${text.slice(0, limit - 1)}…`
}

function checkNode(): Check {
  const version = process.versions.node
  const major = Number.parseInt(version.split('.')[0] ?? '0', 10)
  if (major >= MIN_NODE_MAJOR) {
    return { id: 'node', label: 'Node.js', status: 'ok', detail: version }
  }
  return {
    id: 'node',
    label: 'Node.js',
    status: 'fail',
    detail: `${version} is too old`,
    fix: `Install Node.js ${MIN_NODE_MAJOR}.19 or newer from https://nodejs.org`,
  }
}

function checkPlatform(): Check {
  return {
    id: 'platform',
    label: 'Platform',
    status: 'ok',
    detail: `${platform()} ${arch()}`,
  }
}

function checkShell(run: CommandRunner, env: NodeJS.ProcessEnv): Check {
  if (platform() === 'win32') {
    const pwsh = run('pwsh', ['--version'])
    if (pwsh.ok) {
      return {
        id: 'shell',
        label: 'Shell',
        status: 'ok',
        detail: firstLine(pwsh.stdout) || 'PowerShell 7',
      }
    }
    const windowsPowerShell = run('powershell', [
      '-NoProfile',
      '-Command',
      '$PSVersionTable.PSVersion.ToString()',
    ])
    if (windowsPowerShell.ok) {
      return {
        id: 'shell',
        label: 'Shell',
        status: 'ok',
        detail: `Windows PowerShell ${firstLine(windowsPowerShell.stdout)}`,
      }
    }
    return {
      id: 'shell',
      label: 'Shell',
      status: 'warn',
      detail: 'No PowerShell found; the bash tool will fall back to cmd.exe',
      fix: 'Install PowerShell 7: https://github.com/PowerShell/PowerShell',
    }
  }

  const shell = env.SHELL ?? 'bash'
  const result = run(shell, ['--version'])
  return result.ok
    ? { id: 'shell', label: 'Shell', status: 'ok', detail: firstLine(result.stdout) || shell }
    : {
        id: 'shell',
        label: 'Shell',
        status: 'warn',
        detail: `${shell} not available`,
        fix: 'Install bash or set SHELL to your preferred shell',
      }
}

function checkGit(run: CommandRunner): Check {
  const result = run('git', ['--version'])
  return result.ok
    ? { id: 'git', label: 'git', status: 'ok', detail: firstLine(result.stdout) }
    : {
        id: 'git',
        label: 'git',
        status: 'warn',
        detail: 'not found',
        fix: 'Install git: https://git-scm.com',
      }
}

function checkPython(run: CommandRunner): Check {
  const result = run('python', ['--version'])
  const output = firstLine(result.stdout) || firstLine(result.stderr)
  if (!result.ok) {
    return {
      id: 'python',
      label: 'Python',
      status: 'warn',
      detail: 'not found; the py tool and evals will be disabled',
      fix: 'Install Python 3.11+: https://python.org (optional)',
    }
  }

  const match = /(\d+)\.(\d+)/.exec(output)
  if (!match) {
    return { id: 'python', label: 'Python', status: 'ok', detail: output }
  }

  const major = Number.parseInt(match[1] ?? '0', 10)
  const minor = Number.parseInt(match[2] ?? '0', 10)
  const supported = major > MIN_PYTHON[0] || (major === MIN_PYTHON[0] && minor >= MIN_PYTHON[1])
  if (supported) {
    return { id: 'python', label: 'Python', status: 'ok', detail: output }
  }
  return {
    id: 'python',
    label: 'Python',
    status: 'warn',
    detail: `${output} is older than ${MIN_PYTHON.join('.')}; the py tool will be disabled`,
    fix: `Upgrade Python to ${MIN_PYTHON.join('.')}+ (optional)`,
  }
}

function checkWorkspace(cwd: string): Check {
  const root = resolve(cwd)
  try {
    if (!statSync(root).isDirectory()) {
      return {
        id: 'workspace',
        label: 'Workspace',
        status: 'fail',
        detail: `${root} is not a directory`,
        fix: 'Pass --cwd with a directory that exists',
      }
    }
    accessSync(root, constants.W_OK)
    return { id: 'workspace', label: 'Workspace', status: 'ok', detail: root }
  } catch (error) {
    return {
      id: 'workspace',
      label: 'Workspace',
      status: 'fail',
      detail: truncate(error instanceof Error ? error.message : String(error)),
      fix: 'Choose a writable directory with --cwd',
    }
  }
}

function checkHome(env: NodeJS.ProcessEnv, ensureHome: (path: string) => void): Check {
  const home = configHome(env)
  try {
    ensureHome(home)
    return { id: 'home', label: 'Config home', status: 'ok', detail: home }
  } catch (error) {
    return {
      id: 'home',
      label: 'Config home',
      status: 'fail',
      detail: truncate(error instanceof Error ? error.message : String(error)),
      fix: `Make ${home} writable or set OPCECODE_HOME`,
    }
  }
}

/**
 * Warnings already surfaced by the model/API-key checks are dropped here so
 * doctor does not say the same thing twice.
 */
function relevantConfigNotes(loaded: LoadedConfig, env: NodeJS.ProcessEnv): string[] {
  const selection = resolveModel(loaded.config)
  const apiKey = selection
    ? resolveApiKey(selection.providerID, selection.provider, env)
    : undefined
  const missingEnvVar = apiKey?.status === 'missing' ? apiKey.envVar : undefined

  return loaded.warnings.filter((warning) => {
    if (warning.startsWith('No model configured')) return false
    if (warning.startsWith('Model "')) return false
    if (missingEnvVar && warning.includes(`"${missingEnvVar}" is not set`)) return false
    return true
  })
}

/**
 * Collect diagnostics without printing. Tests inject `run` and `load` so this
 * stays fast and offline.
 */
export function collectChecks(options: CollectOptions): Check[] {
  const env = options.env ?? process.env
  const run = options.run ?? defaultRun
  const load = options.load ?? ((cwd: string) => loadConfig({ cwd, env }))
  const ensureHome =
    options.ensureHome ??
    ((path: string) => {
      mkdirSync(path, { recursive: true })
      accessSync(path, constants.W_OK)
    })

  const checks: Check[] = [
    checkNode(),
    checkPlatform(),
    checkShell(run, env),
    checkGit(run),
    checkPython(run),
    checkWorkspace(options.cwd),
  ]

  let loaded: LoadedConfig | undefined
  try {
    loaded = load(resolve(options.cwd))
    const files = loaded.sources.filter((source) => source.found)
    if (files.length === 0) {
      checks.push({
        id: 'config',
        label: 'Config',
        status: 'warn',
        detail: 'no config file found; using defaults',
        fix: 'Run `opcecode init --preset openrouter-free`',
      })
    } else {
      checks.push({
        id: 'config',
        label: 'Config',
        status: 'ok',
        detail: files.map((source) => `${source.kind}: ${source.path}`).join(', '),
      })
    }
    const notes = relevantConfigNotes(loaded, env)
    if (notes.length > 0) {
      checks.push({
        id: 'config-warnings',
        label: 'Config notes',
        status: 'warn',
        detail: truncate(notes.join('; '), 200),
        fix: 'Fix the warnings above, or rerun `opcecode init --force`',
      })
    }
  } catch (error) {
    const message =
      error instanceof ConfigError
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error)
    checks.push({
      id: 'config',
      label: 'Config',
      status: 'fail',
      detail: truncate(message, 200),
      fix: 'Fix the JSON, then rerun `opcecode doctor`',
    })
  }

  if (loaded) {
    checkModel(loaded, checks, env)
  }

  checks.push(checkHome(env, ensureHome))
  return checks
}

function checkModel(loaded: LoadedConfig, checks: Check[], env: NodeJS.ProcessEnv): void {
  const selection = resolveModel(loaded.config)
  if (loaded.config.model.trim() === '') {
    checks.push({
      id: 'model',
      label: 'Model',
      status: 'warn',
      detail: 'not configured',
      fix: 'Run `opcecode init --preset openrouter-free` or set OPCECODE_MODEL',
    })
    return
  }

  if (!selection) {
    checks.push({
      id: 'model',
      label: 'Model',
      status: 'warn',
      detail: `"${loaded.config.model}" has no matching provider`,
      fix: 'Use "provider/model" and configure that provider in opcecode.json',
    })
    return
  }

  checks.push({
    id: 'model',
    label: 'Model',
    status: 'ok',
    detail: `${selection.providerID} / ${selection.modelID}`,
  })

  const key = resolveApiKey(selection.providerID, selection.provider, env)
  if (key.status === 'present') {
    checks.push({
      id: 'api-key',
      label: 'API key',
      status: 'ok',
      detail: key.source === 'config' ? 'from config' : `from ${key.envVar}`,
    })
    return
  }
  if (key.status === 'not-required') {
    checks.push({ id: 'api-key', label: 'API key', status: 'ok', detail: 'local endpoint' })
    return
  }
  checks.push({
    id: 'api-key',
    label: 'API key',
    status: 'warn',
    detail: `missing ${key.envVar ?? 'provider key'}`,
    fix: `Set ${key.envVar ?? 'the provider key'} in your environment`,
  })
}

function statusTag(status: CheckStatus, color: boolean): string {
  const styles = createStyler(color)
  if (status === 'ok') return styles.green(' ok ')
  if (status === 'warn') return styles.yellow('warn')
  return styles.red('FAIL')
}

function summarize(checks: Check[]): string {
  const failures = checks.filter((check) => check.status === 'fail').length
  const warnings = checks.filter((check) => check.status === 'warn').length
  if (failures === 0 && warnings === 0) return 'All checks passed.'
  const parts: string[] = []
  if (failures > 0) parts.push(`${failures} failure${failures === 1 ? '' : 's'}`)
  if (warnings > 0) parts.push(`${warnings} warning${warnings === 1 ? '' : 's'}`)
  return `${parts.join(', ')}.`
}

export function runDoctor(options: DoctorOptions): number {
  const checks = collectChecks(options)
  const ok = checks.every((check) => check.status !== 'fail')

  if (options.json) {
    console.log(JSON.stringify({ ok, cwd: resolve(options.cwd), checks }, null, 2))
    return ok ? 0 : 1
  }

  const styles = createStyler(options.color)
  const lines: string[] = [
    styles.bold(`OpceCode! doctor`),
    styles.dim(`  ${resolve(options.cwd)}`),
    '',
  ]

  for (const check of checks) {
    lines.push(
      `  ${statusTag(check.status, options.color)} ${check.label.padEnd(12)} ${check.detail}`,
    )
    if (check.fix && check.status !== 'ok') {
      lines.push(`       ${styles.dim(`fix: ${check.fix}`)}`)
    }
  }

  lines.push('', `  ${summarize(checks)}`)
  console.log(lines.join('\n'))
  return ok ? 0 : 1
}
