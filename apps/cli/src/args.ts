import { parseArgs } from 'node:util'

export class UsageError extends Error {
  readonly exitCode = 2

  constructor(message: string) {
    super(message)
    this.name = 'UsageError'
  }
}

export type CommandName = 'doctor' | 'init' | 'help' | 'version'

export interface ParsedArgs {
  command: CommandName
  flags: {
    cwd: string | undefined
    json: boolean
    color: boolean
    force: boolean
    preset: string | undefined
    model: string | undefined
  }
}

const COMMANDS = new Set<string>(['doctor', 'init', 'help', 'version'])

interface ParseArgsResult {
  values: {
    help?: boolean
    version?: boolean
    json?: boolean
    'no-color'?: boolean
    cwd?: string
    force?: boolean
    preset?: string
    model?: string
  }
  positionals: string[]
}

const OPTIONS = {
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
  json: { type: 'boolean' },
  'no-color': { type: 'boolean' },
  cwd: { type: 'string' },
  force: { type: 'boolean' },
  preset: { type: 'string' },
  model: { type: 'string' },
} as const

export function parseCommandLine(argv: string[]): ParsedArgs {
  let parsed: ParseArgsResult
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: OPTIONS,
    }) as unknown as ParseArgsResult
  } catch (error) {
    throw new UsageError(error instanceof Error ? error.message : String(error))
  }

  let command: CommandName = 'help'
  if (parsed.values.version) {
    command = 'version'
  } else if (parsed.values.help) {
    command = 'help'
  } else {
    const first = parsed.positionals[0]
    if (first !== undefined) {
      if (!COMMANDS.has(first)) {
        throw new UsageError(`Unknown command "${first}". Run "opcecode help".`)
      }
      command = first as CommandName
    }
    if (parsed.positionals.length > 1) {
      throw new UsageError(`Unexpected argument "${parsed.positionals[1]}".`)
    }
  }

  return {
    command,
    flags: {
      cwd: parsed.values.cwd,
      json: parsed.values.json ?? false,
      color: !(parsed.values['no-color'] ?? false),
      force: parsed.values.force ?? false,
      preset: parsed.values.preset,
      model: parsed.values.model,
    },
  }
}
