import { createHash, randomBytes } from 'node:crypto'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { configHome } from '@opcecode/config'
import type { ChatMessage, ToolCall } from './providers/types.js'

export interface SessionMeta {
  version: 1
  id: string
  cwd: string
  provider: string
  model: string
  createdAt: string
  updatedAt: string
  /** Derived from the first user message. Empty until the first turn. */
  title: string
}

export type ToolEndStatus = 'ok' | 'error' | 'denied'

export interface SessionCreatedEvent {
  type: 'session.created'
  at: string
  sessionID: string
  cwd: string
  provider: string
  model: string
}

export type SessionEvent =
  | SessionCreatedEvent
  | { type: 'user.message'; at: string; content: string }
  | { type: 'assistant.message'; at: string; content: string; toolCalls?: ToolCall[] }
  | { type: 'tool.start'; at: string; call: ToolCall }
  | {
      type: 'tool.end'
      at: string
      callID: string
      name: string
      status: ToolEndStatus
      output: string
      durationMs: number
    }
  | { type: 'usage'; at: string; inputTokens: number; outputTokens: number; estimated: boolean }
  | {
      type: 'session.compact'
      at: string
      omittedMessages: number
      omittedTurns: number
      summary: string
      beforeTokens: number
      afterTokens: number
    }
  | { type: 'error'; at: string; message: string }

export type SessionEventDraft =
  | { type: 'user.message'; content: string }
  | { type: 'assistant.message'; content: string; toolCalls?: ToolCall[] }
  | { type: 'tool.start'; call: ToolCall }
  | {
      type: 'tool.end'
      callID: string
      name: string
      status: ToolEndStatus
      output: string
      durationMs: number
    }
  | { type: 'usage'; inputTokens: number; outputTokens: number; estimated: boolean }
  | {
      type: 'session.compact'
      omittedMessages: number
      omittedTurns: number
      summary: string
      beforeTokens: number
      afterTokens: number
    }
  | { type: 'error'; message: string }

export interface CreateSessionOptions {
  cwd: string
  provider: string
  model: string
  home?: string
  now?: Date
  id?: string
}

export function projectKey(cwd: string): string {
  const normalized = cwd.replaceAll('\\', '/').replace(/\/+$/, '')
  const value = process.platform === 'win32' ? normalized.toLowerCase() : normalized
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/** Local timestamp plus a short random suffix, safe in file names. */
export function newSessionId(now = new Date(), random = randomBytes(3).toString('hex')): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const date = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${date}-${time}-${random}`
}

export function messagesFromEvents(events: SessionEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = []
  for (const event of events) {
    switch (event.type) {
      case 'user.message':
        messages.push({ role: 'user', content: event.content })
        break
      case 'assistant.message':
        if (event.content !== '' || (event.toolCalls?.length ?? 0) > 0) {
          messages.push({
            role: 'assistant',
            content: event.content,
            ...(event.toolCalls ? { toolCalls: event.toolCalls } : {}),
          })
        }
        break
      case 'tool.end':
        messages.push({
          role: 'tool',
          content: event.output,
          toolCallID: event.callID,
          name: event.name,
        })
        break
      default:
        break
    }
  }
  return messages
}

export class SessionRecorder {
  readonly meta: SessionMeta
  readonly dir: string
  readonly eventsPath: string

  private readonly metaPath: string

  private constructor(meta: SessionMeta, dir: string) {
    this.meta = meta
    this.dir = dir
    this.eventsPath = join(dir, 'events.jsonl')
    this.metaPath = join(dir, 'meta.json')
  }

  static create(options: CreateSessionOptions): SessionRecorder {
    const now = options.now ?? new Date()
    const at = now.toISOString()
    const id = options.id ?? newSessionId(now)
    const home = options.home ?? configHome(process.env)
    const projectDir = join(home, 'projects', projectKey(options.cwd))
    const dir = join(projectDir, 'sessions', id)

    const meta: SessionMeta = {
      version: 1,
      id,
      cwd: options.cwd,
      provider: options.provider,
      model: options.model,
      createdAt: at,
      updatedAt: at,
      title: '',
    }

    mkdirSync(dir, { recursive: true })
    const session = new SessionRecorder(meta, dir)
    session.saveMeta()
    session.writeEvent({
      type: 'session.created',
      at,
      sessionID: id,
      cwd: options.cwd,
      provider: options.provider,
      model: options.model,
    })
    return session
  }

  append(draft: SessionEventDraft): SessionEvent {
    const event = { ...draft, at: new Date().toISOString() } as SessionEvent
    this.writeEvent(event)
    return event
  }

  events(): SessionEvent[] {
    let text: string
    try {
      text = readFileSync(this.eventsPath, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }

    const events: SessionEvent[] = []
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      events.push(JSON.parse(line) as SessionEvent)
    }
    return events
  }

  transcript(): ChatMessage[] {
    return messagesFromEvents(this.events())
  }

  /** Set a title from the first user message, if it has no title yet. */
  setTitleFrom(text: string): void {
    if (this.meta.title !== '') return
    const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
    const title = firstLine.trim().slice(0, 60)
    if (title === '') return
    this.meta.title = title
    this.touch()
  }

  touch(): void {
    this.meta.updatedAt = new Date().toISOString()
    this.saveMeta()
  }

  private writeEvent(event: SessionEvent): void {
    appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, 'utf8')
  }

  private saveMeta(): void {
    writeFileSync(this.metaPath, `${JSON.stringify(this.meta, null, 2)}\n`, 'utf8')
  }
}
