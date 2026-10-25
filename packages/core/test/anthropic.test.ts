import { describe, expect, it } from 'vitest'
import { createAnthropicProvider, toAnthropicRequest } from '../src/providers/anthropic.js'
import { type ChatRequest, ProviderError, type ProviderEvent } from '../src/providers/index.js'

function sseResponse(chunks: string[], init?: ResponseInit): Response {
  const encoder = new TextEncoder()
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  return new Response(body, init)
}

interface Captured {
  url: string
  headers: Record<string, string>
  payload: Record<string, unknown>
}

async function collect(
  chunks: string[],
  request?: ChatRequest,
): Promise<{ events: ProviderEvent[]; captured: Captured[] }> {
  const captured: Captured[] = []
  const provider = createAnthropicProvider({
    id: 'anthropic',
    apiKey: 'test-key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      captured.push({
        url: String(url),
        headers: (init?.headers ?? {}) as Record<string, string>,
        payload: JSON.parse(String(init?.body)) as Record<string, unknown>,
      })
      return sseResponse(chunks)
    }) as typeof fetch,
  })

  const events: ProviderEvent[] = []
  for await (const event of provider.stream(
    request ?? { model: 'claude-test', messages: [{ role: 'user', content: 'hi' }], tools: [] },
    new AbortController().signal,
  )) {
    events.push(event)
  }
  return { events, captured }
}

describe('createAnthropicProvider', () => {
  it('parses text deltas, usage, and the stop reason', async () => {
    const chunks = [
      'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":12}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]

    const { events } = await collect(chunks)
    expect(events).toEqual([
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo' },
      { type: 'usage', inputTokens: 25, outputTokens: 12 },
      { type: 'done', finishReason: 'stop' },
    ])
  })

  it('assembles a tool call from input_json_delta chunks', async () => {
    const chunks = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":30,"output_tokens":1}}}\n\n',
      'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"toolu_1","name":"read"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\":\\"a"}}\n\n',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":".txt\\"}"}}\n\n',
      'data: {"type":"content_block_stop","index":0}\n\n',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]

    const { events } = await collect(chunks)
    expect(events).toEqual([
      {
        type: 'tool_call',
        call: { id: 'toolu_1', name: 'read', arguments: '{"path":"a.txt"}' },
      },
      { type: 'usage', inputTokens: 30, outputTokens: 1 },
      { type: 'done', finishReason: 'tool_calls' },
    ])
  })

  it('maps max_tokens onto a length finish reason', async () => {
    const chunks = [
      'data: {"type":"message_delta","delta":{"stop_reason":"max_tokens"},"usage":{"output_tokens":7}}\n\n',
      'data: {"type":"message_stop"}\n\n',
    ]

    const { events } = await collect(chunks)
    expect(events.at(-1)).toEqual({ type: 'done', finishReason: 'length' })
  })

  it('sends the version header, key, and max_tokens', async () => {
    const chunks = ['data: {"type":"message_stop"}\n\n']
    const { captured } = await collect(chunks)

    expect(captured[0]?.url).toBe('https://api.anthropic.com/v1/messages')
    expect(captured[0]?.headers['x-api-key']).toBe('test-key')
    expect(captured[0]?.headers['anthropic-version']).toBe('2023-06-01')
    expect(captured[0]?.payload.max_tokens).toBe(4096)
    expect(captured[0]?.payload.stream).toBe(true)
  })

  it('reports stream error events as ProviderError', async () => {
    const chunks = [
      'data: {"type":"error","error":{"type":"overloaded_error","message":"busy"}}\n\n',
    ]
    await expect(collect(chunks)).rejects.toBeInstanceOf(ProviderError)
  })
})

describe('toAnthropicRequest', () => {
  it('moves system prompts, tool results, and tool calls into wire format', () => {
    const payload = toAnthropicRequest(
      {
        model: 'claude-test',
        maxTokens: 512,
        messages: [
          { role: 'system', content: 'be nice' },
          { role: 'system', content: 'be brief' },
          { role: 'user', content: 'read a.txt' },
          {
            role: 'assistant',
            content: '',
            toolCalls: [{ id: 'toolu_1', name: 'read', arguments: '{"path":"a.txt"}' }],
          },
          { role: 'tool', content: 'contents', toolCallID: 'toolu_1', name: 'read' },
          { role: 'user', content: 'thanks' },
        ],
        tools: [{ name: 'read', description: 'Read', parameters: { type: 'object' } }],
      },
      4096,
    )

    expect(payload.system).toBe('be nice\n\nbe brief')
    expect(payload.max_tokens).toBe(512)
    expect(payload.messages).toEqual([
      { role: 'user', content: 'read a.txt' },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'read', input: { path: 'a.txt' } }],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_1', content: 'contents' },
          { type: 'text', text: 'thanks' },
        ],
      },
    ])
    expect(payload.tools).toEqual([
      { name: 'read', description: 'Read', input_schema: { type: 'object' } },
    ])
  })

  it('falls back to the default max_tokens', () => {
    const payload = toAnthropicRequest(
      { model: 'claude-test', messages: [{ role: 'user', content: 'hi' }], tools: [] },
      4096,
    )
    expect(payload.max_tokens).toBe(4096)
  })
})
