import {
  type ChatMessage,
  type ChatRequest,
  createAbortError,
  isAbortError,
  type Provider,
  ProviderError,
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

function dataLine(line: string): string | undefined {
  if (!line.startsWith('data:')) return undefined
  const data = line.slice(5).trim()
  return data === '' ? undefined : data
}

async function* sseEvents(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal,
): AsyncGenerator<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      if (signal.aborted) throw createAbortError()
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newline = buffer.indexOf('\n')
      while (newline !== -1) {
        let line = buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        if (line.endsWith('\r')) line = line.slice(0, -1)
        const data = dataLine(line)
        if (data !== undefined) yield data
        newline = buffer.indexOf('\n')
      }
    }

    buffer += decoder.decode()
    const tail = dataLine(buffer.trim())
    if (tail !== undefined) yield tail
  } finally {
    reader.releaseLock()
  }
}

export function createOpenAICompatibleProvider(options: OpenAICompatibleOptions): Provider {
  const baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, '')
  const fetchImpl = options.fetchImpl ?? fetch

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

      let response: Response
      try {
        response = await fetchImpl(`${baseURL}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal,
        })
      } catch (error) {
        if (isAbortError(error)) throw error
        const message = error instanceof Error ? error.message : String(error)
        throw new ProviderError(`Could not reach ${baseURL}: ${message}`)
      }

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        const detail = text.length > 500 ? `${text.slice(0, 500)}…` : text
        throw new ProviderError(
          `Provider request failed (${response.status} ${response.statusText})${detail ? `: ${detail}` : ''}`,
          response.status,
        )
      }

      if (!response.body) {
        throw new ProviderError('Provider returned an empty response body')
      }

      const calls = new Map<number, { id: string; name: string; arguments: string }>()
      let finishReason = 'stop'

      for await (const data of sseEvents(response.body, signal)) {
        if (data === '[DONE]') break

        let chunk: WireChunk
        try {
          chunk = JSON.parse(data) as WireChunk
        } catch {
          const detail = data.length > 200 ? `${data.slice(0, 200)}…` : data
          throw new ProviderError(`Invalid SSE payload from provider: ${detail}`)
        }

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
