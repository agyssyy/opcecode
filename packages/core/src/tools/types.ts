import type { RiskLevel } from '../permissions.js'
import type { TodoList } from '../todo.js'

export interface ToolContext {
  cwd: string
  signal: AbortSignal
  readLimit: number
  bashTimeoutMs: number
  /** Session task list shared by all todo tool calls. */
  todo: TodoList
}

export interface ToolResult {
  output: string
  isError?: boolean
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
  risk: RiskLevel
  /** Short human-readable target shown in approval prompts and audit logs. */
  subject(args: Record<string, unknown>): string
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolResult>
}

export class ToolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolError'
  }
}

export class ToolAbortError extends Error {
  constructor(message = 'Tool aborted') {
    super(message)
    this.name = 'AbortError'
  }
}

export function requireString(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ToolError(`Missing or invalid "${key}" argument: expected a non-empty string.`)
  }
  return value
}

export function optionalString(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'string') {
    throw new ToolError(`Invalid "${key}" argument: expected a string.`)
  }
  return value
}

export function optionalInteger(
  args: Record<string, unknown>,
  key: string,
  minimum = 1,
): number | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum) {
    throw new ToolError(`Invalid "${key}" argument: expected an integer >= ${minimum}.`)
  }
  return value
}

export function optionalBoolean(args: Record<string, unknown>, key: string): boolean | undefined {
  const value = args[key]
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') {
    throw new ToolError(`Invalid "${key}" argument: expected a boolean.`)
  }
  return value
}

export function truncateText(text: string, limit: number, note?: string): string {
  if (text.length <= limit) return text
  const suffix = note ?? `\n… truncated at ${limit} characters`
  return text.slice(0, limit) + suffix
}
