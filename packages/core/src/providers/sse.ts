import { createAbortError, isAbortError, ProviderError } from './types.js'

export function dataLine(line: string): string | undefined {
  if (!line.startsWith('data:')) return undefined
  const data = line.slice(5).trim()
  return data === '' ? undefined : data
}

/**
 * Yield each `data:` payload from an SSE body. Buffers partial lines across
 * chunks and flushes a final line that arrives without a trailing newline.
 */
export async function* sseEvents(
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

export interface OpenSSEOptions {
  url: string
  headers: Record<string, string>
  payload: unknown
  signal: AbortSignal
  fetchImpl?: typeof fetch
  /** Used in error messages, e.g. "https://api.example.com/v1". */
  label: string
}

/** POST JSON and return the SSE data payloads, mapping failures to ProviderError. */
export async function* postSSE(options: OpenSSEOptions): AsyncGenerator<string> {
  const fetchImpl = options.fetchImpl ?? fetch

  let response: Response
  try {
    response = await fetchImpl(options.url, {
      method: 'POST',
      headers: options.headers,
      body: JSON.stringify(options.payload),
      signal: options.signal,
    })
  } catch (error) {
    if (isAbortError(error)) throw error
    const message = error instanceof Error ? error.message : String(error)
    throw new ProviderError(`Could not reach ${options.label}: ${message}`)
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

  yield* sseEvents(response.body, options.signal)
}

/** Parse an SSE payload, reporting the provider detail on malformed JSON. */
export function parseSseJson<T>(data: string): T {
  try {
    return JSON.parse(data) as T
  } catch {
    const detail = data.length > 200 ? `${data.slice(0, 200)}…` : data
    throw new ProviderError(`Invalid SSE payload from provider: ${detail}`)
  }
}
