import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { messagesFromEvents, projectKey, SessionRecorder } from '../src/session.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opcecode-session-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('SessionRecorder', () => {
  it('writes meta and an append-only event log', () => {
    const home = tempDir()
    const cwd = join(home, 'repo')
    const session = SessionRecorder.create({
      cwd,
      provider: 'openrouter',
      model: 'openrouter/free',
      home,
      id: 'test-session',
    })

    session.setTitleFrom('Fix the   parser\nwith tests')
    session.append({ type: 'user.message', content: 'hello' })
    session.append({ type: 'assistant.message', content: 'hi' })
    session.append({ type: 'usage', inputTokens: 3, outputTokens: 1, estimated: true })
    session.touch()

    expect(session.dir).toBe(join(home, 'projects', projectKey(cwd), 'sessions', 'test-session'))
    const meta = JSON.parse(readFileSync(join(session.dir, 'meta.json'), 'utf8'))
    expect(meta).toMatchObject({
      id: 'test-session',
      provider: 'openrouter',
      model: 'openrouter/free',
      title: 'Fix the   parser',
    })

    const events = session.events()
    expect(events.map((event) => event.type)).toEqual([
      'session.created',
      'user.message',
      'assistant.message',
      'usage',
    ])
    expect(events[1]).toMatchObject({ type: 'user.message', content: 'hello' })
  })

  it('folds events into a chat transcript', () => {
    const home = tempDir()
    const session = SessionRecorder.create({
      cwd: home,
      provider: 'mock',
      model: 'mock',
      home,
    })

    session.append({ type: 'user.message', content: 'read a.txt' })
    session.append({
      type: 'assistant.message',
      content: '',
      toolCalls: [{ id: 'call_1', name: 'read', arguments: '{"path":"a.txt"}' }],
    })
    session.append({
      type: 'tool.end',
      callID: 'call_1',
      name: 'read',
      status: 'ok',
      output: '1\tcontent',
      durationMs: 4,
    })
    session.append({ type: 'assistant.message', content: 'The file says content.' })

    const messages = session.transcript()
    expect(messages).toEqual([
      { role: 'user', content: 'read a.txt' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'read', arguments: '{"path":"a.txt"}' }],
      },
      { role: 'tool', content: '1\tcontent', toolCallID: 'call_1', name: 'read' },
      { role: 'assistant', content: 'The file says content.' },
    ])
  })

  it('drops events that are not chat messages', () => {
    expect(
      messagesFromEvents([
        { type: 'usage', at: 'now', inputTokens: 1, outputTokens: 2, estimated: false },
        { type: 'error', at: 'now', message: 'boom' },
      ]),
    ).toEqual([])
  })

  it('keeps the first title only', () => {
    const home = tempDir()
    const session = SessionRecorder.create({ cwd: home, provider: 'm', model: 'm', home })
    session.setTitleFrom('first')
    session.setTitleFrom('second')
    expect(session.meta.title).toBe('first')
  })

  it.runIf(process.platform === 'win32')('hashes Windows paths case-insensitively', () => {
    expect(projectKey('C:\\Repo\\App')).toBe(projectKey('c:/repo/app'))
  })

  it('hashes trailing separators equally', () => {
    expect(projectKey('/repo/app')).toBe(projectKey('/repo/app/'))
  })
})
