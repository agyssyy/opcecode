import { createInterface } from 'node:readline'
import {
  ConfigError,
  configHome,
  type LoadedConfig,
  loadConfig,
  type ModelSelection,
  resolveModel,
} from '@opcecode/config'
import {
  Agent,
  type AgentEvent,
  loadProjectInstructions,
  PermissionEngine,
  SessionRecorder,
  type TurnResult,
} from '@opcecode/core'
import { createApprovalPrompt } from '../approval.js'
import { createProviderForSelection } from '../provider.js'
import { createStyler, type Styler } from '../theme.js'
import { VERSION } from '../version.js'

export interface ChatOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  color?: boolean
  model?: string
  home?: string
}

interface Totals {
  inputTokens: number
  outputTokens: number
  turns: number
  estimatedTurns: number
}

function formatTokens(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

function readLine(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  })
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close()
      resolve(answer)
    })
  })
}

function renderTurnEnd(
  styles: Styler,
  result: TurnResult,
  writeLine: (text?: string) => void,
): void {
  if (result.reason === 'aborted') {
    writeLine(styles.yellow('aborted'))
  } else if (result.reason === 'max-steps') {
    writeLine(styles.yellow(result.error ?? 'Reached the maximum number of steps.'))
  } else if (result.reason === 'error') {
    writeLine(styles.red(result.error ?? 'Turn failed.'))
  }

  if (result.usage.inputTokens > 0 || result.usage.outputTokens > 0) {
    const suffix = result.usage.estimated ? ' (estimated)' : ''
    writeLine(
      styles.dim(
        `${result.usage.estimated ? '~' : ''}${formatTokens(result.usage.inputTokens)} in / ${
          result.usage.estimated ? '~' : ''
        }${formatTokens(result.usage.outputTokens)} out${suffix}`,
      ),
    )
  }
}

const HELP = [
  '/help      Show this help',
  '/model     Show the current model',
  '/usage     Show session token totals',
  '/session   Show the session log path',
  '/exit      Leave the chat (Ctrl+C also works when idle)',
].join('\n')

export async function runChat(options: ChatOptions): Promise<number> {
  const env = options.env ?? process.env
  const color = options.color ?? false
  const styles = createStyler(color)
  const home = options.home ?? configHome(env)
  const stdout = process.stdout

  if (!process.stdin.isTTY || !stdout.isTTY) {
    console.error(
      'Interactive mode needs a terminal. Headless `opcecode -p` lands in a later milestone.',
    )
    return 1
  }

  let loaded: LoadedConfig
  try {
    loaded = loadConfig({
      cwd: options.cwd,
      env,
      home,
      ...(options.model ? { cli: { model: options.model } } : {}),
    })
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error(styles.red(`Config error: ${error.message}`))
      return 1
    }
    throw error
  }

  for (const warning of loaded.warnings) {
    console.error(styles.yellow(`warning: ${warning}`))
  }

  const selection: ModelSelection | null = resolveModel(loaded.config)
  if (!selection) {
    console.error('')
    console.error('No model is configured yet. Run:')
    console.error(styles.cyan('  opcecode init --preset openrouter-free'))
    return 1
  }

  let provider: ReturnType<typeof createProviderForSelection>
  try {
    provider = createProviderForSelection(selection, env)
  } catch (error) {
    console.error(styles.red(error instanceof Error ? error.message : String(error)))
    return 1
  }

  const session = SessionRecorder.create({
    cwd: options.cwd,
    provider: selection.providerID,
    model: selection.modelID,
    home,
  })
  const permissions = new PermissionEngine(loaded.config.permissions)
  const approve = createApprovalPrompt({ styles, stdin: process.stdin, stdout })
  const instructions = loadProjectInstructions(options.cwd, loaded.config.projectInstructions)

  let needsNewline = false
  const writeLine = (text = '') => {
    if (needsNewline) {
      stdout.write('\n')
      needsNewline = false
    }
    stdout.write(`${text}\n`)
  }

  const totals: Totals = { inputTokens: 0, outputTokens: 0, turns: 0, estimatedTurns: 0 }
  let contextTokens = 0
  let contextBudget = loaded.config.context.maxContextTokens
  const handleEvent = (event: AgentEvent) => {
    switch (event.type) {
      case 'text':
        stdout.write(event.delta)
        needsNewline = !event.delta.endsWith('\n')
        break
      case 'tool.start':
        writeLine(
          `${styles.yellow('●')} ${styles.bold(event.call.name)} ${styles.dim(event.subject)}`,
        )
        break
      case 'tool.end': {
        const mark =
          event.status === 'ok'
            ? styles.green('✓')
            : event.status === 'denied'
              ? styles.yellow('⊘')
              : styles.red('✗')
        const label = event.status === 'denied' ? 'denied' : event.status
        writeLine(`${mark} ${event.call.name} ${styles.dim(`${label} · ${event.durationMs}ms`)}`)
        if (event.status !== 'ok') {
          const first = event.output.split(/\r?\n/, 1)[0] ?? ''
          if (first !== '') writeLine(styles.dim(`  ${first}`))
        }
        break
      }
      case 'notice':
        writeLine(event.level === 'warn' ? styles.yellow(event.message) : event.message)
        break
      case 'turn.end':
        renderTurnEnd(styles, event.result, writeLine)
        break
    }
  }

  const agent = new Agent({
    config: loaded.config,
    cwd: options.cwd,
    model: selection.modelID,
    provider,
    session,
    permissions,
    approve,
    onEvent: handleEvent,
    ...(instructions.text !== '' ? { instructions: instructions.text } : {}),
  })

  let active: AbortController | null = null
  const onSigint = () => {
    if (active && !active.signal.aborted) {
      active.abort()
      return
    }
    stdout.write('\n')
    process.exit(0)
  }
  process.on('SIGINT', onSigint)

  try {
    stdout.write(
      `${styles.bold(`OpceCode! v${VERSION}`)} ${styles.dim('— open code, your code')}\n`,
    )
    stdout.write(`${styles.dim('  model   ')}${selection.providerID}/${selection.modelID}\n`)
    stdout.write(`${styles.dim('  cwd     ')}${options.cwd}\n`)
    stdout.write(`${styles.dim('  session ')}${session.dir}\n`)
    if (instructions.files.length > 0) {
      stdout.write(
        `${styles.dim('  rules   ')}${instructions.files.join(', ')} ${styles.dim('(project instructions)')}\n`,
      )
    }
    stdout.write(
      `${styles.dim('  tools   ')}read, list, glob, grep, edit, write, bash, todo ${styles.dim(
        '(edit, write, and bash ask first)',
      )}\n`,
    )
    stdout.write(
      `${styles.dim('  context ')}~${formatTokens(loaded.config.context.maxContextTokens)} tokens ${styles.dim(
        '(compaction budget, estimated)',
      )}\n`,
    )
    stdout.write(`\nType ${styles.cyan('/help')} for commands. Ctrl+C aborts a running turn.\n\n`)

    while (true) {
      const line = await readLine(styles.cyan('› '))
      const input = line.trim()
      if (input === '') continue

      if (input.startsWith('/')) {
        const command = input.split(/\s+/, 1)[0]?.toLowerCase()
        if (command === '/exit' || command === '/quit') break
        if (command === '/help') {
          writeLine(HELP)
        } else if (command === '/model') {
          writeLine(`${selection.providerID}/${selection.modelID}`)
        } else if (command === '/session') {
          writeLine(session.dir)
        } else if (command === '/usage') {
          const exact = totals.estimatedTurns === 0
          const mark = exact ? '' : '~'
          writeLine(
            `${totals.turns} turn${totals.turns === 1 ? '' : 's'}, ${mark}${formatTokens(
              totals.inputTokens,
            )} in / ${mark}${formatTokens(totals.outputTokens)} out`,
          )
          if (!exact) {
            writeLine(
              styles.dim(
                `estimated for ${totals.estimatedTurns} of ${totals.turns} turn${
                  totals.turns === 1 ? '' : 's'
                } (the provider did not report usage)`,
              ),
            )
          }
          if (contextTokens > 0) {
            writeLine(
              styles.dim(
                `context ~${formatTokens(contextTokens)} / ${formatTokens(contextBudget)} tokens (estimated from characters)`,
              ),
            )
          }
        } else {
          writeLine(styles.yellow(`Unknown command "${command}". Type /help.`))
        }
        continue
      }

      active = new AbortController()
      const result = await agent.send(input, active.signal)
      active = null
      totals.turns += 1
      totals.inputTokens += result.usage.inputTokens
      totals.outputTokens += result.usage.outputTokens
      if (result.usage.estimated) totals.estimatedTurns += 1
      contextTokens = result.contextTokens
      contextBudget = result.contextBudget
    }

    session.touch()
    return 0
  } finally {
    process.off('SIGINT', onSigint)
  }
}
