import { describe, expect, it } from 'vitest'
import { compactMessages, estimateTokensForMessages } from '../src/compact.js'
import type { ChatMessage } from '../src/providers/types.js'

function text(role: 'user' | 'assistant', content: string): ChatMessage {
  return { role, content }
}

describe('estimateTokensForMessages', () => {
  it('grows with content and counts tool call arguments', () => {
    const small = estimateTokensForMessages([text('user', 'hi')])
    const big = estimateTokensForMessages([text('user', 'x'.repeat(4000))])
    expect(big).toBeGreaterThan(small + 900)

    const withCall = estimateTokensForMessages([
      {
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'c1', name: 'read', arguments: JSON.stringify({ path: 'x'.repeat(400) }) },
        ],
      },
    ])
    expect(withCall).toBeGreaterThan(100)
  })
})

describe('compactMessages', () => {
  it('returns the input unchanged when within budget', () => {
    const messages = [text('user', 'hi'), text('assistant', 'hello')]
    const outcome = compactMessages(messages, { maxTokens: 1000 })
    expect(outcome.compacted).toBe(false)
    expect(outcome.messages).toBe(messages)
    expect(outcome.overBudget).toBe(false)
  })

  it('keeps a large single turn and flags the overflow', () => {
    const messages = [text('user', 'x'.repeat(8000)), text('assistant', 'y'.repeat(8000))]
    const outcome = compactMessages(messages, { maxTokens: 100 })
    expect(outcome.compacted).toBe(false)
    expect(outcome.messages).toBe(messages)
    expect(outcome.overBudget).toBe(true)
  })

  it('drops whole oldest turns and inserts a summary system message', () => {
    const messages: ChatMessage[] = [
      text('user', 'first question'),
      {
        role: 'assistant',
        content: 'x'.repeat(4000),
        toolCalls: [{ id: 'c1', name: 'read', arguments: '{"path":"src/app.ts"}' }],
      },
      { role: 'tool', content: 'y'.repeat(4000), toolCallID: 'c1', name: 'read' },
      text('user', 'second question'),
      text('assistant', 'z'.repeat(5000)),
      text('user', 'third question'),
      text('assistant', 'short answer'),
    ]

    const outcome = compactMessages(messages, { maxTokens: 1100, keepTurns: 2 })
    expect(outcome.compacted).toBe(true)
    expect(outcome.omittedTurns).toBe(2)
    expect(outcome.omittedMessages).toBe(5)
    expect(outcome.messages[0]?.role).toBe('system')
    expect(outcome.messages[0]?.content).toContain('[compacted]')
    expect(outcome.messages[0]?.content).toContain('read ×1')
    expect(outcome.messages[0]?.content).toContain('src/app.ts')
    expect(outcome.afterTokens).toBeLessThanOrEqual(1100)
    expect(outcome.messages.at(-1)?.content).toBe('short answer')
  })

  it('carries a previous summary into the new one', () => {
    const messages: ChatMessage[] = [
      { role: 'system', content: '[compacted] old stuff happened' },
      text('user', 'u1'),
      text('assistant', 'x'.repeat(4000)),
      text('user', 'u2'),
      text('assistant', 'y'.repeat(4000)),
      text('user', 'u3'),
    ]

    const outcome = compactMessages(messages, { maxTokens: 1200, keepTurns: 1 })
    expect(outcome.compacted).toBe(true)
    expect(outcome.messages[0]?.content).toContain('[compacted] old stuff happened')
    expect(outcome.messages.at(-1)?.content).toBe('u3')
  })
})
