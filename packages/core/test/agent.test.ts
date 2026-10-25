import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { OpceCodeConfig } from '@opcecode/config'
import { afterEach, describe, expect, it } from 'vitest'
import { Agent } from '../src/agent.js'
import { type ApprovalRequest, PermissionEngine } from '../src/permissions.js'
import { type Provider, ProviderError, type ProviderEvent } from '../src/providers/index.js'
import { SessionRecorder } from '../src/session.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opcecode-agent-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function testConfig(maxSteps = 25, maxContextTokens = 24_000): OpceCodeConfig {
  return {
    model: 'mock/mock-model',
    providers: {},
    permissions: [],
    context: { maxSteps, readLimit: 200, bashTimeoutMs: 5000, maxContextTokens },
    projectInstructions: [],
  }
}

interface ScriptedProvider extends Provider {
  requests: Array<{ messages: unknown[]; tools: unknown[] }>
}

function scriptedProvider(scripts: ProviderEvent[][]): ScriptedProvider {
  let index = 0
  const requests: ScriptedProvider['requests'] = []
  return {
    id: 'mock',
    requests,
    async *stream(request) {
      requests.push({ messages: request.messages, tools: request.tools })
      const script = scripts[Math.min(index, scripts.length - 1)] ?? []
      index += 1
      for (const event of script) yield event
    },
  }
}

function done(): ProviderEvent[] {
  return [{ type: 'done', finishReason: 'stop' }]
}

interface Harness {
  agent: Agent
  provider: ScriptedProvider
  session: SessionRecorder
  approvals: ApprovalRequest[]
  events: string[]
}

function harness(options: {
  scripts: ProviderEvent[][]
  rules?: ConstructorParameters<typeof PermissionEngine>[0]
  decision?: 'allow-once' | 'allow-session' | 'deny'
  maxSteps?: number
  maxContextTokens?: number
  cwd?: string
  instructions?: string
}): Harness {
  const home = tempDir()
  const cwd = options.cwd ?? tempDir()
  const session = SessionRecorder.create({ cwd, provider: 'mock', model: 'mock-model', home })
  const provider = scriptedProvider(options.scripts)
  const approvals: ApprovalRequest[] = []
  const events: string[] = []

  const agent = new Agent({
    config: testConfig(options.maxSteps, options.maxContextTokens),
    cwd,
    model: 'mock-model',
    provider,
    session,
    permissions: new PermissionEngine(
      options.rules ?? [
        { tool: 'read', decision: 'allow' },
        { tool: 'write', decision: 'ask' },
      ],
    ),
    approve: async (request) => {
      approvals.push(request)
      return options.decision ?? 'allow-once'
    },
    onEvent: (event) => events.push(event.type),
    ...(options.instructions !== undefined ? { instructions: options.instructions } : {}),
  })

  return { agent, provider, session, approvals, events }
}

describe('Agent', () => {
  it('completes a plain text turn and logs it', async () => {
    const { agent, provider, session, events } = harness({
      scripts: [[{ type: 'text', delta: 'Hello!' }, ...done()]],
    })

    const result = await agent.send('hi', new AbortController().signal)
    expect(result.reason).toBe('complete')
    expect(result.steps).toBe(1)
    expect(result.usage.estimated).toBe(true)
    expect(events).toContain('turn.end')

    expect(session.events().map((event) => event.type)).toEqual([
      'session.created',
      'user.message',
      'assistant.message',
      'usage',
    ])
    expect(session.transcript()).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hello!' },
    ])
    expect(provider.requests[0]?.tools).toHaveLength(8)
  })

  it('executes an allowed tool and feeds the result back to the model', async () => {
    const cwd = tempDir()
    writeFileSync(join(cwd, 'a.txt'), 'hello world\n')

    const { agent, session, approvals } = harness({
      cwd,
      scripts: [
        [
          {
            type: 'tool_call',
            call: { id: 'call_1', name: 'read', arguments: '{"path":"a.txt"}' },
          },
          ...done(),
        ],
        [{ type: 'text', delta: 'It says hello.' }, ...done()],
      ],
    })

    const result = await agent.send('read a.txt', new AbortController().signal)
    expect(result.reason).toBe('complete')
    expect(approvals).toHaveLength(0)

    const toolEnd = session.events().find((event) => event.type === 'tool.end')
    expect(toolEnd).toMatchObject({ status: 'ok', name: 'read' })
    expect((toolEnd as { output: string }).output).toContain('hello world')

    expect(session.transcript()).toEqual([
      { role: 'user', content: 'read a.txt' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'read', arguments: '{"path":"a.txt"}' }],
      },
      expect.objectContaining({ role: 'tool', toolCallID: 'call_1', name: 'read' }),
      { role: 'assistant', content: 'It says hello.' },
    ])
  })

  it('marks a denied approval and still answers the tool call', async () => {
    const cwd = tempDir()
    const { agent, session, approvals } = harness({
      cwd,
      decision: 'deny',
      scripts: [
        [
          {
            type: 'tool_call',
            call: { id: 'call_1', name: 'write', arguments: '{"path":"out.txt","content":"x"}' },
          },
          ...done(),
        ],
        [{ type: 'text', delta: 'Skipped.' }, ...done()],
      ],
    })

    const result = await agent.send('write out.txt', new AbortController().signal)
    expect(result.reason).toBe('complete')
    expect(approvals).toHaveLength(1)
    expect(approvals[0]).toMatchObject({ tool: 'write', subject: 'out.txt', risk: 'medium' })

    const toolEnd = session.events().find((event) => event.type === 'tool.end')
    expect(toolEnd).toMatchObject({ status: 'denied' })
  })

  it('remembers session approvals for identical tool calls', async () => {
    const cwd = tempDir()
    const call = {
      type: 'tool_call' as const,
      call: { id: 'call_1', name: 'write', arguments: '{"path":"out.txt","content":"x"}' },
    }

    const { agent, approvals } = harness({
      cwd,
      decision: 'allow-session',
      scripts: [
        [call, ...done()],
        [{ ...call, call: { ...call.call, id: 'call_2' } }, ...done()],
        [{ type: 'text', delta: 'Done.' }, ...done()],
      ],
    })

    const result = await agent.send('write out.txt twice', new AbortController().signal)
    expect(result.reason).toBe('complete')
    expect(approvals).toHaveLength(1)
  })

  it('stops at maxSteps', async () => {
    const cwd = tempDir()
    writeFileSync(join(cwd, 'a.txt'), 'x')
    const { agent, session } = harness({
      cwd,
      maxSteps: 1,
      scripts: [
        [
          {
            type: 'tool_call',
            call: { id: 'call_1', name: 'read', arguments: '{"path":"a.txt"}' },
          },
          ...done(),
        ],
      ],
    })

    const result = await agent.send('loop', new AbortController().signal)
    expect(result.reason).toBe('max-steps')
    expect(session.events().some((event) => event.type === 'error')).toBe(true)
  })

  it('reports provider errors as a failed turn', async () => {
    const home = tempDir()
    const cwd = tempDir()
    const session = SessionRecorder.create({ cwd, provider: 'mock', model: 'm', home })
    const provider: Provider = {
      id: 'mock',
      // biome-ignore lint/correctness/useYield: this generator throws before yielding on purpose
      async *stream() {
        throw new ProviderError('boom')
      },
    }
    const agent = new Agent({
      config: testConfig(),
      cwd,
      model: 'm',
      provider,
      session,
      permissions: new PermissionEngine([]),
      approve: async () => 'deny',
      onEvent: () => {},
    })

    const result = await agent.send('hi', new AbortController().signal)
    expect(result).toMatchObject({ reason: 'error', error: 'boom' })
    expect(session.events().some((event) => event.type === 'error')).toBe(true)
  })

  it('returns aborted when the signal is already aborted', async () => {
    const { agent, session } = harness({ scripts: [[...done()]] })
    const controller = new AbortController()
    controller.abort()

    const result = await agent.send('hi', controller.signal)
    expect(result.reason).toBe('aborted')
    expect(
      session.events().some((event) => event.type === 'error' && event.message.includes('aborted')),
    ).toBe(true)
  })

  it('includes project instructions in the system prompt', async () => {
    const { agent, provider } = harness({
      scripts: [[{ type: 'text', delta: 'ok' }, ...done()]],
      instructions: 'Always run the formatter.',
    })

    await agent.send('hi', new AbortController().signal)
    const messages = provider.requests[0]?.messages as Array<{ role: string; content: string }>
    expect(messages[0]?.role).toBe('system')
    expect(messages[0]?.content).toContain('Always run the formatter.')
  })

  it('compacts old turns and logs session.compact', async () => {
    const { agent, provider, session, events } = harness({
      scripts: [
        [{ type: 'text', delta: 'a'.repeat(6000) }, ...done()],
        [{ type: 'text', delta: 'b'.repeat(6000) }, ...done()],
        [{ type: 'text', delta: 'c' }, ...done()],
      ],
      maxContextTokens: 2000,
    })

    await agent.send('first', new AbortController().signal)
    await agent.send('second', new AbortController().signal)
    const result = await agent.send('third', new AbortController().signal)

    const compact = session.events().find((event) => event.type === 'session.compact')
    expect(compact).toMatchObject({ type: 'session.compact' })
    expect(result.contextBudget).toBe(2000)
    expect(result.contextTokens).toBeLessThanOrEqual(2000)
    expect(events).toContain('notice')

    const messages = provider.requests.at(-1)?.messages as Array<{
      role: string
      content: string
    }>
    expect(messages[0]?.role).toBe('system')
    expect(messages.some((message) => message.content.includes('[compacted]'))).toBe(true)
  })
})
