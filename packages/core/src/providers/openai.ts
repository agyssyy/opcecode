import { parseSseJson, postSSE } from './sse.js'
import {
  type ChatMessage,
  type ChatRequest,
  createAbortError,
  type Provider,
  type ProviderEvent,
  type ToolSchema,
} from './types.js'

export interface OpenAICompatibleOptions {
  id: string
  baseURL?: string
  apiKey?: string
  headers?: Record<string, string>
  /** Injected in tests. */
  fetchImpl?: typeof fetch
}

interface WireToolCall {
  index?: number
  id?: string
  type?: string
  function?: { name?: string; arguments?: string }
}

interface WireDelta {
  content?: string | null
  tool_calls?: WireToolCall[]
}

interface WireChoice {
  delta?: WireDelta
  finish_reason?: string | null
}

interface WireChunk {
  choices?: WireChoice[]
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1'

function toWireTool(tool: ToolSchema): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  if (message.role === 'tool') {
    return {
      role: 'tool',
      tool_call_id: message.toolCallID,
      content: message.content,
    }
  }

  if (message.role === 'assistant' && message.toolCalls && message.toolCalls.length > 0) {
    return {
      role: 'assistant',
      content: message.content === '' ? null : message.content,
      tool_calls: message.toolCalls.map((call) => ({
        id: call.id,
        type: 'function',
        function: { name: call.name, arguments: call.arguments },
      })),
    }
  }

  return { role: message.role, content: message.content }
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): Provider {
  const baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

  return {
    id: options.id,
    async *stream(request: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent> {
      const headers: Record<string, string> = {
        'content-type': 'application/json',
        accept: 'text/event-stream',
        ...options.headers,
      }
      if (options.apiKey) headers.authorization = `Bearer ${options.apiKey}`

      const payload: Record<string, unknown> = {
        model: request.model,
        messages: request.messages.map(toWireMessage),
        stream: true,
      }
      if (request.tools.length > 0) payload.tools = request.tools.map(toWireTool)
      if (request.temperature !== undefined) payload.temperature = request.temperature
      if (request.maxTokens !== undefined) payload.max_tokens = request.maxTokens

      const calls = new Map<number, { id: string; name: string; arguments: string }>()
      let finishReason = 'stop'

      for await (const data of postSSE({
        url: `${baseURL}/chat/completions`,
        headers,
        payload,
        signal,
        label: baseURL,
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      })) {
        if (data === '[DONE]') break

        const chunk = parseSseJson<WireChunk>(data)
        const choice = chunk.choices?.[0]
        const delta = choice?.delta

        if (typeof delta?.content === 'string' && delta.content !== '') {
          yield { type: 'text', delta: delta.content }
        }

        for (const wireCall of delta?.tool_calls ?? []) {
          const index = wireCall.index ?? 0
          const current = calls.get(index) ?? { id: '', name: '', arguments: '' }
          if (wireCall.id) current.id = wireCall.id
          if (wireCall.function?.name) current.name += wireCall.function.name
          if (wireCall.function?.arguments) current.arguments += wireCall.function.arguments
          calls.set(index, current)
        }

        if (choice?.finish_reason) finishReason = choice.finish_reason

        if (chunk.usage) {
          yield {
            type: 'usage',
            inputTokens: chunk.usage.prompt_tokens ?? 0,
            outputTokens: chunk.usage.completion_tokens ?? 0,
          }
        }
      }

      if (signal.aborted) throw createAbortError()

      for (const [index, call] of [...calls.entries()].sort(([a], [b]) => a - b)) {
        if (call.name === '') continue
        yield {
          type: 'tool_call',
          call: {
            id: call.id || `call_${index}`,
            name: call.name,
            arguments: call.arguments === '' ? '{}' : call.arguments,
          },
        }
      }

      yield { type: 'done', finishReason }
    },
  }
}
