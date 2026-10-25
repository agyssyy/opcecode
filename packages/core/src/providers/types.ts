export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ToolCall {
  id: string
  name: string
  /** Raw JSON string from the model. Parsed by the agent before execution. */
  arguments: string
}

export interface ChatMessage {
  role: ChatRole
  content: string
  toolCalls?: ToolCall[]
  toolCallID?: string
  name?: string
}

export interface ToolSchema {
  name: string
  description: string
  parameters: Record<string, unknown>
}

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  tools: ToolSchema[]
  temperature?: number
  maxTokens?: number
}

export type ProviderEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool_call'; call: ToolCall }
  | { type: 'usage'; inputTokens: number; outputTokens: number }
  | { type: 'done'; finishReason: string }

export interface Provider {
  id: string
  stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>
}

export class ProviderError extends Error {
  readonly status: number | undefined

  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ProviderError'
    this.status = status
  }
}

export function createAbortError(message = 'The operation was aborted'): Error {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

export function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  if (error.name === 'AbortError') return true
  const code = (error as NodeJS.ErrnoException).code
  return code === 'ABORT_ERR'
}
