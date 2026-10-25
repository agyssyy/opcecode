import { parseSseJson, postSSE } from './sse.js'
import {
  type ChatRequest,
  type Provider,
  ProviderError,
  type ProviderEvent,
  type ToolCall,
  type ToolSchema,
} from './types.js'

export interface AnthropicOptions {
  id: string
  apiKey: string
  baseURL?: string
  headers?: Record<string, string>
  maxTokens?: number
  /** Injected in tests. */
  fetchImpl?: typeof fetch
}

const DEFAULT_BASE_URL = 'https://api.anthropic.com/v1'
const DEFAULT_MAX_TOKENS = 4096
const ANTHROPIC_VERSION = '2023-06-01'

interface WireBlock {
  type: string
  text?: string
  id?: string
  name?: string
  input?: unknown
  partial_json?: string
  tool_use_id?: string
  content?: string | WireBlock[]
}

interface WireMessage {
  role: 'user' | 'assistant'
  content: string | WireBlock[]
}

interface WireStreamEvent {
  type?: string
  index?: number
  message?: { usage?: { input_tokens?: number; output_tokens?: number } }
  content_block?: { type?: string; id?: string; name?: string }
  delta?: {
    type?: string
    text?: string
    partial_json?: string
    stop_reason?: string | null
  }
  usage?: { input_tokens?: number; output_tokens?: number }
  error?: { type?: string; message?: string }
}

function toWireTool(tool: ToolSchema): Record<string, unknown> {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  }
}

function toolInput(argumentsText: string): unknown {
  try {
    return JSON.parse(argumentsText) as unknown
  } catch {
    return {}
  }
}

/**
 * Convert the shared chat transcript into Anthropic wire messages: system
 * prompts move to the top-level `system` field, tool results become
 * `tool_result` blocks inside user messages, and consecutive same-role
 * messages merge so the transcript stays valid.
 */
export function toAnthropicRequest(
  request: ChatRequest,
  maxTokens: number,
): Record<string, unknown> {
  const system: string[] = []
  const messages: WireMessage[] = []

  const pushUser = (block: WireBlock | string) => {
    const last = messages[messages.length - 1]
    if (last && last.role === 'user') {
      const blocks = Array.isArray(last.content)
        ? last.content
        : [{ type: 'text', text: last.content }]
      last.content = [
        ...blocks,
        ...(typeof block === 'string' ? [{ type: 'text', text: block }] : [block]),
      ]
      return
    }
    messages.push({ role: 'user', content: typeof block === 'string' ? block : [block] })
  }

  const pushAssistant = (message: WireMessage) => {
    const last = messages[messages.length - 1]
    if (last && last.role === 'assistant') {
      const blocks = Array.isArray(last.content)
        ? last.content
        : [{ type: 'text', text: last.content }]
      const incoming = Array.isArray(message.content)
        ? message.content
        : [{ type: 'text', text: message.content }]
      last.content = [...blocks, ...incoming]
      return
    }
    messages.push(message)
  }

  for (const message of request.messages) {
    if (message.role === 'system') {
      system.push(message.content)
      continue
    }

    if (message.role === 'tool') {
      pushUser({
        type: 'tool_result',
        tool_use_id: message.toolCallID ?? '',
        content: message.content,
      })
      continue
    }

    if (message.role === 'assistant') {
      const blocks: WireBlock[] = []
      if (message.content !== '') blocks.push({ type: 'text', text: message.content })
      for (const call of message.toolCalls ?? []) {
        blocks.push({
          type: 'tool_use',
          id: call.id,
          name: call.name,
          input: toolInput(call.arguments),
        })
      }
      if (blocks.length === 0) continue
      pushAssistant({ role: 'assistant', content: blocks })
      continue
    }

    if (message.content === '') continue
    pushUser(message.content)
  }

  const payload: Record<string, unknown> = {
    model: request.model,
    max_tokens: request.maxTokens ?? maxTokens,
    messages,
    stream: true,
  }
  if (system.length > 0) payload.system = system.join('\n\n')
  if (request.tools.length > 0) payload.tools = request.tools.map(toWireTool)
  if (request.temperature !== undefined) payload.temperature = request.temperature
  return payload
}

interface PendingTool {
  id: string
  name: string
  json: string
}

export function createAnthropicProvider(options: AnthropicOptions): Provider {
  const baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS

  return {
    id: options.id,
    async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        'anthropic-version': ANTHROPIC_VERSION,
        'x-api-key': options.apiKey,
        ...options.headers,
      }

      const payload = toAnthropicRequest(request, maxTokens)
      const pending = new Map<number, PendingTool>()
      let inputTokens = 0
      let outputTokens = 0
      let stopReason = 'end_turn'

      for await (const data of postSSE({
        url: `${baseURL}/messages`,
        headers,
        payload,
        signal,
        label: baseURL,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      })) {
        const event = parseSseJson<WireStreamEvent>(data)

        switch (event.type) {
          case 'message_start': {
            inputTokens = event.message?.usage?.input_tokens ?? 0
            outputTokens = event.message?.usage?.output_tokens ?? 0
            break
          }
          case 'content_block_start': {
            if (event.content_block?.type === 'tool_use') {
              pending.set(event.index ?? 0, {
                id: event.content_block.id ?? `tool_${event.index ?? 0}`,
                name: event.content_block.name ?? '',
                json: '',
              })
            }
            break
          }
          case 'content_block_delta': {
            if (event.delta?.type === 'text_delta' && event.delta.text) {
              yield { type: 'text', delta: event.delta.text }
            } else if (event.delta?.type === 'input_json_delta') {
              const tool = pending.get(event.index ?? 0)
              if (tool) tool.json += event.delta.partial_json ?? ''
            }
            break
          }
          case 'content_block_stop': {
            const tool = pending.get(event.index ?? 0)
            if (tool) {
              pending.delete(event.index ?? 0)
              const call: ToolCall = {
                id: tool.id,
                name: tool.name,
                arguments: tool.json === '' ? '{}' : tool.json,
              }
              yield { type: 'tool_call', call }
            }
            break
          }
          case 'message_delta': {
            if (event.delta?.stop_reason) stopReason = event.delta.stop_reason
            if (event.usage?.output_tokens !== undefined) outputTokens = event.usage.output_tokens
            break
          }
          case 'error': {
            const detail = event.error?.message ?? 'unknown error'
            throw new ProviderError(`Anthropic stream error: ${detail}`)
          }
          default:
            break
        }
      }

      yield { type: 'usage', inputTokens, outputTokens }
      // Map Anthropic stop reasons onto the OpenAI-style finish reasons.
      const finishReason =
        stopReason === 'tool_use' ? 'tool_calls' : stopReason === 'max_tokens' ? 'length' : 'stop'
      yield { type: 'done', finishReason }
    },
  }
}
