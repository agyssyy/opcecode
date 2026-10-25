import { describe, expect, it } from 'vitest'
import { isAbortError, ProviderError, type ProviderEvent } from '../src/providers/index.js'
import { createOpenAICompatibleProvider } from '../src/providers/openai.js'

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

async function collect(
  response: Response,
  signal = new AbortController().signal,
  requests: Array<Record<string, unknown>> = [],
): Promise<ProviderEvent[]> {
  const provider = createOpenAICompatibleProvider({
    id: 'mock',
    baseURL: 'https://example.test/v1',
    apiKey: 'test-key',
    fetchImpl: (async (_url: string | URL | Request, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      return response
    }) as typeof fetch,
  })

  const events: ProviderEvent[] = []
  for await (const event of provider.stream(
    {
      model: 'test-model',
      messages: [{ role: 'user', content: 'hi' }],
      tools: [
        {
          name: 'read',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} },
        },
      ],
    },
    signal,
  )) {
    events.push(event)
  }
  return events
}

describe('createOpenAICompatibleProvider', () => {
  it('parses text, usage, and a tool call split across chunks', async () => {
    const chunks = [
      'data: {"choices":[{"delta":{"content":"Hel',
      'lo"},"finish_reason":null}]}\r\n\r\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"re',
      'ad","arguments":"{\\"path\\":\\"a',
      '.txt\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n',
      'data: {"usage":{"prompt_tokens":11,"completion_tokens":5}}\n\n',
      'data: [DONE]\n\n',
    ]

    const events = await collect(sseResponse(chunks))
    expect(events).toEqual([
      { type: 'text', delta: 'Hello' },
      { type: 'usage', inputTokens: 11, outputTokens: 5 },
      {
        type: 'tool_call',
        call: { id: 'call_1', name: 'read', arguments: '{"path":"a.txt"}' },
      },
      { type: 'done', finishReason: 'tool_calls' },
    ])
  })

  it('parses a final data line without a trailing newline', async () => {
    const events = await collect(
      sseResponse(['data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}']),
    )
    expect(events).toEqual([
      { type: 'text', delta: 'ok' },
      { type: 'done', finishReason: 'stop' },
    ])
  })

  it('sends the model, tools, and bearer token', async () => {
    const requests: Array<Record<string, unknown>> = []
    await collect(
      sseResponse(['data: {"choices":[{"delta":{"content":"x"},"finish_reason":"stop"}]}\n\n']),
      new AbortController().signal,
      requests,
    )

    expect(requests).toHaveLength(1)
    const request = requests[0] ?? {}
    expect(request.model).toBe('test-model')
    expect(request.stream).toBe(true)
    expect(request.tools).toEqual([
      {
        type: 'function',
        function: {
          name: 'read',
          description: 'Read a file',
          parameters: { type: 'object', properties: {} },
        },
      },
    ])
  })

  it('reports HTTP errors with the status code', async () => {
    await expect(
      collect(sseResponse(['nope'], { status: 429, statusText: 'Too Many Requests' })),
    ).rejects.toMatchObject({ name: 'ProviderError', status: 429 })
  })

  it('reports invalid SSE payloads', async () => {
    await expect(collect(sseResponse(['data: not json\n\n']))).rejects.toBeInstanceOf(ProviderError)
  })

  it('throws an AbortError when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    try {
      await collect(sseResponse(['data: {"choices":[]}\n\n']), controller.signal)
      throw new Error('expected the stream to abort')
    } catch (error) {
      expect(isAbortError(error)).toBe(true)
    }
  })
})
