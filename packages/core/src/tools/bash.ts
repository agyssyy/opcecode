import { type ChildProcess, spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import {
  optionalInteger,
  requireString,
  ToolAbortError,
  type ToolDefinition,
  ToolError,
  type ToolResult,
} from './types.js'

export type ShellKind = 'powershell' | 'cmd' | 'posix'

export interface ShellInfo {
  command: string
  label: string
  kind: ShellKind
  baseArgs: string[]
}

const HEAD_CHARS = 20_000
const TAIL_CHARS = 20_000
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are the point
const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g

const SCRUBBED_ENV = new Set([
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'ANTHROPIC_API_KEY',
  'GROQ_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
])

let cachedShell: ShellInfo | undefined

function windowsShell(): ShellInfo {
  for (const candidate of ['pwsh', 'powershell']) {
    const probe = spawnSync(candidate, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    if (!probe.error && probe.status === 0) {
      return { command: candidate, label: candidate, kind: 'powershell', baseArgs: [] }
    }
  }
  const comSpec = process.env.ComSpec ?? 'cmd.exe'
  return { command: comSpec, label: basename(comSpec), kind: 'cmd', baseArgs: [] }
}

/** Detect a usable shell once per process. Windows prefers PowerShell. */
export function detectShell(): ShellInfo {
  if (cachedShell) return cachedShell
  if (process.platform === 'win32') {
    cachedShell = windowsShell()
  } else {
    const candidate = process.env.SHELL
    const command = candidate && existsSync(candidate) ? candidate : '/bin/sh'
    cachedShell = { command, label: basename(command), kind: 'posix', baseArgs: ['-lc'] }
  }
  return cachedShell
}

/**
 * PowerShell `-Command` turns any non-zero native exit code into 1 and writes
 * CLIXML to stderr when redirected, so commands run from a script with an
 * explicit exit-code epilogue instead.
 */
function powershellWrapper(command: string): string {
  return [
    "$PSStyle.OutputRendering = 'PlainText'",
    command,
    '$__opcecodeOk = $?',
    '$__opcecodeCode = $LASTEXITCODE',
    'if ($null -ne $__opcecodeCode -and $__opcecodeCode -ne 0) { exit $__opcecodeCode }',
    'if (-not $__opcecodeOk) { exit 1 }',
    'exit 0',
    '',
  ].join('\r\n')
}

interface PreparedCommand {
  args: string[]
  cleanup(): void
}

function prepareCommand(shell: ShellInfo, command: string): PreparedCommand {
  if (shell.kind === 'posix') {
    return { args: [...shell.baseArgs, command], cleanup() {} }
  }

  const dir = mkdtempSync(join(tmpdir(), 'opcecode-shell-'))
  const cleanup = () => rmSync(dir, { recursive: true, force: true })

  if (shell.kind === 'powershell') {
    const path = join(dir, 'command.ps1')
    writeFileSync(path, `\uFEFF${powershellWrapper(command)}`, 'utf8')
    return {
      args: [
        ...shell.baseArgs,
        '-NoProfile',
        '-NonInteractive',
        '-OutputFormat',
        'Text',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path,
      ],
      cleanup,
    }
  }

  const path = join(dir, 'command.cmd')
  writeFileSync(path, `@echo off\r\n${command}\r\n`, 'utf8')
  return { args: [...shell.baseArgs, '/d', '/s', '/c', 'call', path], cleanup }
}

/** Copy the environment without the agent's own credentials. */
export function scrubEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const result: NodeJS.ProcessEnv = {}
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('OPCECODE_') || SCRUBBED_ENV.has(key)) continue
    result[key] = value
  }
  return result
}

class OutputCollector {
  private head = ''
  private tail = ''
  private total = 0

  push(chunk: string): void {
    const text = chunk.replace(ANSI_PATTERN, '')
    this.total += text.length
    let rest = text
    if (this.head.length < HEAD_CHARS) {
      const room = HEAD_CHARS - this.head.length
      this.head += rest.slice(0, room)
      rest = rest.slice(room)
    }
    if (rest !== '') {
      this.tail = (this.tail + rest).slice(-TAIL_CHARS)
    }
  }

  render(): { text: string; truncated: boolean } {
    const truncated = this.total > this.head.length + this.tail.length
    if (!truncated) return { text: this.head, truncated: false }
    return {
      text: `${this.head}\n… output truncated (${this.total} characters) …\n${this.tail}`,
      truncated: true,
    }
  }
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
      stdio: 'ignore',
      windowsHide: true,
    })
    return
  }

  child.kill('SIGTERM')
  const timer = setTimeout(() => {
    if (child.exitCode === null) child.kill('SIGKILL')
  }, 2000)
  timer.unref()
}

export interface CommandResult {
  output: string
  exitCode: number | null
  signal: NodeJS.Signals | null
  timedOut: boolean
  aborted: boolean
  truncated: boolean
}

export interface RunCommandOptions {
  command: string
  cwd: string
  timeoutMs: number
  signal: AbortSignal
}

export function runCommand(options: RunCommandOptions): Promise<CommandResult> {
  if (options.signal.aborted) return Promise.reject(new ToolAbortError())
  const shell = detectShell()
  const prepared = prepareCommand(shell, options.command)
  const collector = new OutputCollector()

  return new Promise<CommandResult>((resolvePromise, reject) => {
    let child: ChildProcess
    try {
      child = spawn(shell.command, prepared.args, {
        cwd: options.cwd,
        env: scrubEnv(process.env),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (error) {
      prepared.cleanup()
      reject(new ToolError(`Could not start shell "${shell.label}": ${String(error)}`))
      return
    }

    let timedOut = false
    let aborted = false
    let settled = false
    let killFallback: NodeJS.Timeout | undefined

    const finish = (result: CommandResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killFallback) clearTimeout(killFallback)
      options.signal.removeEventListener('abort', onAbort)
      prepared.cleanup()
      resolvePromise(result)
    }

    /** Resolve even if a killed process tree keeps its stdio pipes open. */
    const afterKill = () => {
      if (killFallback) return
      killFallback = setTimeout(() => {
        child.stdout?.destroy()
        child.stderr?.destroy()
        const { text, truncated } = collector.render()
        finish({
          output: text,
          exitCode: child.exitCode,
          signal: child.signalCode,
          timedOut,
          aborted,
          truncated,
        })
      }, 1500)
      killFallback.unref()
    }

    const timer = setTimeout(() => {
      timedOut = true
      killTree(child)
      afterKill()
    }, options.timeoutMs)

    const onAbort = () => {
      aborted = true
      killTree(child)
      afterKill()
    }
    options.signal.addEventListener('abort', onAbort, { once: true })

    child.stdout?.on('data', (chunk: Buffer) => collector.push(chunk.toString('utf8')))
    child.stderr?.on('data', (chunk: Buffer) => collector.push(chunk.toString('utf8')))

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killFallback) clearTimeout(killFallback)
      options.signal.removeEventListener('abort', onAbort)
      prepared.cleanup()
      reject(new ToolError(`Shell failed: ${error.message}`))
    })

    child.on('close', (exitCode, signal) => {
      const { text, truncated } = collector.render()
      finish({ output: text, exitCode, signal, timedOut, aborted, truncated })
    })
  })
}

export const bashTool: ToolDefinition = {
  name: 'bash',
  description:
    'Run a shell command in the workspace and return its combined output. Use non-interactive commands.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command line to run.' },
      timeoutMs: {
        type: 'integer',
        minimum: 100,
        description: 'Optional timeout in milliseconds, capped by configuration.',
      },
    },
    required: ['command'],
    additionalProperties: false,
  },
  risk: 'high',
  subject(args) {
    return typeof args.command === 'string' ? args.command : '(missing command)'
  },
  async execute(args, context): Promise<ToolResult> {
    const command = requireString(args, 'command')
    const ceiling = Math.max(context.bashTimeoutMs, 1000)
    const requested = optionalInteger(args, 'timeoutMs', 100) ?? ceiling
    const timeoutMs = Math.min(Math.max(requested, 100), ceiling)

    const result = await runCommand({
      command,
      cwd: context.cwd,
      timeoutMs,
      signal: context.signal,
    })

    if (result.aborted) throw new ToolAbortError()

    const body = result.output.trimEnd() === '' ? '(no output)' : result.output.trimEnd()
    const notes: string[] = []
    if (result.timedOut) notes.push(`timed out after ${timeoutMs}ms`)
    if (result.exitCode !== null) notes.push(`exit code: ${result.exitCode}`)
    else if (result.signal) notes.push(`terminated by ${result.signal}`)

    const output = [`$ ${command}`, body, ...notes.map((note) => `[${note}]`)].join('\n')
    return {
      output,
      isError: result.timedOut || (result.exitCode !== null && result.exitCode !== 0),
    }
  },
}
