import type { ChatMessage, ToolCall } from './providers/types.js'

const MAX_SUMMARY_CHARS = 2000
const MAX_LISTED_PATHS = 20
const MAX_LISTED_REQUESTS = 6

/** Rough token estimate: ~4 characters per token. Deliberately cheap. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/** Estimate the transcript cost of a message list, including tool call arguments. */
export function estimateTokensForMessages(messages: ChatMessage[]): number {
  let chars = 0
  for (const message of messages) {
    chars += message.role.length + message.content.length + 4
    for (const call of message.toolCalls ?? []) {
      chars += call.name.length + call.arguments.length + 8
    }
  }
  return Math.ceil(chars / 4)
}

export interface CompactOptions {
  /** Estimated transcript tokens allowed before oldest turns are omitted. */
  maxTokens: number
  /** Most-recent turns always kept when possible. Defaults to 3. */
  keepTurns?: number
}

export interface CompactOutcome {
  /** Messages to send. Unchanged (same array) when `compacted` is false. */
  messages: ChatMessage[]
  compacted: boolean
  omittedMessages: number
  omittedTurns: number
  /** Text inserted as a system message in place of the omitted turns. */
  summary: string
  beforeTokens: number
  afterTokens: number
  /** True when the estimate still exceeds maxTokens after compaction. */
  overBudget: boolean
}

function firstLine(text: string, max: number): string {
  const line = (text.split(/\r?\n/, 1)[0] ?? '').trim()
  return line.length > max ? `${line.slice(0, max)}…` : line
}

function stringArgument(call: ToolCall, key: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(call.arguments)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined
    const value = (parsed as Record<string, unknown>)[key]
    return typeof value === 'string' && value !== '' ? value : undefined
  } catch {
    return undefined
  }
}

/**
 * Build a bounded summary of omitted messages: earlier summaries, user
 * requests, tool usage counts, and touched paths. The model can re-read any
 * file with the read/grep tools, so pointers beat full quotes.
 */
export function summarizeOmitted(omitted: ChatMessage[], omittedTurns: number): string {
  const toolCounts = new Map<string, number>()
  const paths = new Set<string>()
  const requests: string[] = []
  const priorSummaries: string[] = []

  for (const message of omitted) {
    if (message.role === 'system') {
      if (message.content.trim() !== '') priorSummaries.push(message.content)
      continue
    }
    if (message.role === 'user') {
      const line = firstLine(message.content, 120)
      if (line !== '') requests.push(line)
      continue
    }
    for (const call of message.toolCalls ?? []) {
      toolCounts.set(call.name, (toolCounts.get(call.name) ?? 0) + 1)
      const path = stringArgument(call, 'path') ?? stringArgument(call, 'pattern')
      if (path !== undefined) paths.add(path)
    }
  }

  const lines: string[] = [
    `[compacted] ${omittedMessagesLabel(omitted.length)} from ${omittedTurns} earlier turn${
      omittedTurns === 1 ? '' : 's'
    } were replaced by this summary. The most recent turns follow in full.`,
  ]
  lines.push(...priorSummaries)
  if (requests.length > 0) {
    const shown = requests.slice(-MAX_LISTED_REQUESTS)
    lines.push(`User requests: ${shown.map((request) => `"${request}"`).join('; ')}`)
  }
  if (toolCounts.size > 0) {
    const parts = [...toolCounts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([name, count]) => `${name} ×${count}`)
    lines.push(`Tools used: ${parts.join(', ')}.`)
  }
  if (paths.size > 0) {
    const shown = [...paths].slice(0, MAX_LISTED_PATHS)
    const suffix = paths.size > shown.length ? ` (+${paths.size - shown.length} more)` : ''
    lines.push(`Files/paths touched: ${shown.join(', ')}${suffix}.`)
  }
  lines.push('Use read and grep to re-inspect any file when you need its contents.')

  let text = lines.join('\n')
  if (text.length > MAX_SUMMARY_CHARS) text = `${text.slice(0, MAX_SUMMARY_CHARS)}…`
  return text
}

function omittedMessagesLabel(count: number): string {
  return `${count} message${count === 1 ? '' : 's'}`
}

/**
 * Compact a transcript so its estimated token cost fits `maxTokens`.
 *
 * Only whole turns are omitted: the transcript is cut at a user-message
 * boundary, and at least the current (last) turn is always kept. The omitted
 * span is replaced with one system message carrying a bounded summary.
 * Returns the input unchanged when it is already within budget or when there
 * is only a single turn to work with.
 */
export function compactMessages(messages: ChatMessage[], options: CompactOptions): CompactOutcome {
  const beforeTokens = estimateTokensForMessages(messages)
  const unchanged: CompactOutcome = {
    messages,
    compacted: false,
    omittedMessages: 0,
    omittedTurns: 0,
    summary: '',
    beforeTokens,
    afterTokens: beforeTokens,
    overBudget: beforeTokens > options.maxTokens,
  }
  if (beforeTokens <= options.maxTokens) return unchanged

  const userIndices: number[] = []
  messages.forEach((message, index) => {
    if (message.role === 'user') userIndices.push(index)
  })
  // A single turn (or none) cannot be compacted without losing the current ask.
  if (userIndices.length < 2) return unchanged

  const maxKeep = Math.min(options.keepTurns ?? 3, userIndices.length - 1)
  let fallback: CompactOutcome | undefined

  // Keep as many recent turns as fit; fall back to the smallest keep.
  for (let keep = maxKeep; keep >= 1; keep -= 1) {
    const boundary = userIndices[userIndices.length - keep]
    if (boundary === undefined) continue

    const omitted = messages.slice(0, boundary)
    const kept = messages.slice(boundary)
    const omittedTurns = userIndices.filter((index) => index < boundary).length
    const summary = summarizeOmitted(omitted, omittedTurns)
    const next: ChatMessage[] = [{ role: 'system', content: summary }, ...kept]
    const afterTokens = estimateTokensForMessages(next)

    const outcome: CompactOutcome = {
      messages: next,
      compacted: true,
      omittedMessages: omitted.length,
      omittedTurns,
      summary,
      beforeTokens,
      afterTokens,
      overBudget: afterTokens > options.maxTokens,
    }
    if (!outcome.overBudget) return outcome
    fallback = outcome
  }

  return fallback ?? unchanged
}
