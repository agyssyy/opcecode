import type { OpceCodeConfig } from '@opcecode/config'
import { compactMessages, estimateTokens, estimateTokensForMessages } from './compact.js'
import type {
  ApprovalDecision,
  ApprovalRequest,
  PermissionEngine,
  RiskLevel,
} from './permissions.js'
import {
  type ChatMessage,
  type ChatRequest,
  createAbortError,
  isAbortError,
  type Provider,
  type ToolCall,
} from './providers/types.js'
import type { SessionRecorder, ToolEndStatus } from './session.js'
import { TodoList } from './todo.js'
import { detectShell } from './tools/bash.js'
import { BUILTIN_TOOLS, getTool } from './tools/index.js'
import { type ToolContext, ToolError } from './tools/types.js'

export interface TurnUsage {
  inputTokens: number
  outputTokens: number
  estimated: boolean
}

export type TurnReason = 'complete' | 'max-steps' | 'aborted' | 'error'

export interface TurnResult {
  reason: TurnReason
  steps: number
  usage: TurnUsage
  /** Estimated tokens of the final request transcript (including the system prompt). */
  contextTokens: number
  /** Configured compaction budget for that estimate. */
  contextBudget: number
  error?: string
}

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool.start'; call: ToolCall; subject: string; risk: RiskLevel }
  | {
      type: 'tool.end'
      call: ToolCall
      subject: string
      status: ToolEndStatus
      output: string
      durationMs: number
    }
  | { type: 'notice'; level: 'info' | 'warn'; message: string }
  | { type: 'turn.end'; result: TurnResult }

export type Approve = (request: ApprovalRequest) => Promise<ApprovalDecision>

export interface AgentOptions {
  config: OpceCodeConfig
  cwd: string
  model: string
  provider: Provider
  session: SessionRecorder
  permissions: PermissionEngine
  approve: Approve
  onEvent: (event: AgentEvent) => void
  /** Project instructions (AGENTS.md etc), appended to the system prompt. */
  instructions?: string
}

function systemPrompt(cwd: string, instructions: string): string {
  const lines = [
    'You are OpceCode!, a terminal coding agent.',
    `Workspace root: ${cwd}`,
    `Commands run with ${detectShell().label}.`,
    '',
    'Guidelines:',
    '- Use the provided tools instead of guessing file contents.',
    '- Read a file before editing it. Use edit for targeted changes, write for complete files.',
    '- Use the todo tool to plan multi-step work and keep its status current.',
    '- Keep responses short and focused on the task.',
    '- Prefer small, verifiable shell commands.',
    '- After making changes, summarize what changed.',
  ]
  if (instructions !== '') {
    lines.push(
      '',
      'Project instructions from the repository. Follow them unless they conflict with safety or the user:',
      instructions,
    )
  }
  return lines.join('\n')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export class Agent {
  private readonly config: OpceCodeConfig
  private readonly cwd: string
  private readonly model: string
  private readonly provider: Provider
  private readonly session: SessionRecorder
  private readonly permissions: PermissionEngine
  private readonly approve: Approve
  private readonly onEvent: (event: AgentEvent) => void
  private readonly instructions: string
  private readonly messages: ChatMessage[]
  private readonly todo = new TodoList()
  private readonly tools = BUILTIN_TOOLS

  constructor(options: AgentOptions) {
    this.config = options.config
    this.cwd = options.cwd
    this.model = options.model
    this.provider = options.provider
    this.session = options.session
    this.permissions = options.permissions
    this.approve = options.approve
    this.onEvent = options.onEvent
    this.instructions = options.instructions?.trim() ?? ''
    this.messages = [...options.session.transcript()]
  }

  async send(text: string, signal: AbortSignal): Promise<TurnResult> {
    this.session.setTitleFrom(text)
    this.session.append({ type: 'user.message', content: text })
    this.messages.push({ role: 'user', content: text })

    const usage: TurnUsage = { inputTokens: 0, outputTokens: 0, estimated: false }
    const maxSteps = Math.max(this.config.context.maxSteps, 1)
    const contextBudget = Math.max(this.config.context.maxContextTokens, 1000)
    let contextTokens = 0
    let steps = 0
    let usageLogged = false

    const finalize = (reason: TurnReason, error?: string): TurnResult => {
      if (!usageLogged) {
        this.session.append({ type: 'usage', ...usage })
        usageLogged = true
      }
      this.session.touch()
      const result: TurnResult = {
        reason,
        steps,
        usage,
        contextTokens,
        contextBudget,
        ...(error ? { error } : {}),
      }
      this.onEvent({ type: 'turn.end', result })
      return result
    }

    try {
      for (; steps < maxSteps; steps += 1) {
        if (signal.aborted) throw createAbortError()

        this.compactIfNeeded(contextBudget, steps)

        const request: ChatRequest = {
          model: this.model,
          messages: [
            { role: 'system', content: systemPrompt(this.cwd, this.instructions) },
            ...this.messages,
          ],
          tools: this.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        }
        contextTokens = estimateTokensForMessages(request.messages)

        let content = ''
        const calls: ToolCall[] = []
        let providerUsage: { inputTokens: number; outputTokens: number } | undefined

        for await (const event of this.provider.stream(request, signal)) {
          if (event.type === 'text') {
            content += event.delta
            this.onEvent(event)
          } else if (event.type === 'tool_call') {
            calls.push(event.call)
          } else if (event.type === 'usage') {
            providerUsage = event
          }
        }

        if (providerUsage) {
          usage.inputTokens += providerUsage.inputTokens
          usage.outputTokens += providerUsage.outputTokens
        } else {
          usage.estimated = true
          usage.inputTokens += estimateTokens(JSON.stringify(request.messages))
          usage.outputTokens += estimateTokens(
            content + calls.map((call) => call.arguments).join(''),
          )
        }

        if (content !== '' || calls.length > 0) {
          const message: ChatMessage = {
            role: 'assistant',
            content,
            ...(calls.length > 0 ? { toolCalls: calls } : {}),
          }
          this.session.append({
            type: 'assistant.message',
            content,
            ...(calls.length > 0 ? { toolCalls: calls } : {}),
          })
          this.messages.push(message)
        }

        if (calls.length === 0) {
          steps += 1
          return finalize('complete')
        }

        for (const call of calls) {
          if (signal.aborted) throw createAbortError()
          await this.executeTool(call, signal)
        }

        if (steps + 1 >= maxSteps) {
          const message = `Reached the maximum of ${maxSteps} steps before finishing.`
          this.session.append({ type: 'error', message })
          steps += 1
          return finalize('max-steps', message)
        }
      }

      steps = maxSteps
      return finalize('max-steps')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (signal.aborted || isAbortError(error)) {
        this.session.append({ type: 'error', message: 'Turn aborted by user.' })
        return finalize('aborted')
      }
      this.session.append({ type: 'error', message })
      return finalize('error', message)
    }
  }

  private async executeTool(call: ToolCall, signal: AbortSignal): Promise<void> {
    const started = Date.now()
    const tool = getTool(call.name)

    let args: Record<string, unknown>
    try {
      const parsed: unknown = JSON.parse(call.arguments)
      if (!isPlainObject(parsed)) throw new Error('arguments must be a JSON object')
      args = parsed
    } catch (error) {
      const output = `Invalid arguments for ${call.name}: ${
        error instanceof Error ? error.message : String(error)
      }`
      this.finishTool(call, '(invalid)', 'error', output, started)
      return
    }

    if (!tool) {
      this.finishTool(call, '(unknown tool)', 'error', `Unknown tool "${call.name}".`, started)
      return
    }

    let subject = '(unknown)'
    try {
      subject = tool.subject(args)
    } catch {
      subject = '(invalid)'
    }

    let decision = this.permissions.evaluate(tool.name, subject)
    if (decision === 'ask') {
      const approval = await this.approve({
        callID: call.id,
        tool: tool.name,
        subject,
        risk: tool.risk,
        args,
      })
      if (approval === 'deny') {
        decision = 'deny'
      } else {
        if (approval === 'allow-session') this.permissions.allowForSession(tool.name, subject)
        decision = 'allow'
      }
    }

    if (decision === 'deny') {
      this.finishTool(call, subject, 'denied', 'Permission denied by user.', started)
      return
    }

    this.session.append({ type: 'tool.start', call })
    this.onEvent({ type: 'tool.start', call, subject, risk: tool.risk })

    const context: ToolContext = {
      cwd: this.cwd,
      signal,
      readLimit: this.config.context.readLimit,
      bashTimeoutMs: this.config.context.bashTimeoutMs,
      todo: this.todo,
    }

    try {
      const result = await tool.execute(args, context)
      this.finishTool(call, subject, result.isError ? 'error' : 'ok', result.output, started)
    } catch (error) {
      if (isAbortError(error) || signal.aborted) {
        this.finishTool(call, subject, 'error', 'Tool aborted.', started)
        throw createAbortError()
      }
      const message =
        error instanceof ToolError || error instanceof Error ? error.message : String(error)
      this.finishTool(call, subject, 'error', message, started)
    }
  }

  private finishTool(
    call: ToolCall,
    subject: string,
    status: ToolEndStatus,
    output: string,
    started: number,
  ): void {
    const durationMs = Date.now() - started
    this.session.append({
      type: 'tool.end',
      callID: call.id,
      name: call.name,
      status,
      output,
      durationMs,
    })
    this.onEvent({ type: 'tool.end', call, subject, status, output, durationMs })
    this.messages.push({ role: 'tool', content: output, toolCallID: call.id, name: call.name })
  }

  /**
   * Drop whole turns from the in-memory transcript when it exceeds the
   * configured context budget. The session log stays complete: compaction is
   * a request-time view, recorded as a `session.compact` event.
   */
  private compactIfNeeded(budget: number, step: number): void {
    const outcome = compactMessages(this.messages, { maxTokens: budget })
    if (outcome.compacted) {
      this.messages.splice(0, this.messages.length, ...outcome.messages)
      this.session.append({
        type: 'session.compact',
        omittedMessages: outcome.omittedMessages,
        omittedTurns: outcome.omittedTurns,
        summary: outcome.summary,
        beforeTokens: outcome.beforeTokens,
        afterTokens: outcome.afterTokens,
      })
      this.onEvent({
        type: 'notice',
        level: 'info',
        message: `Context compacted: dropped ${outcome.omittedMessages} message${
          outcome.omittedMessages === 1 ? '' : 's'
        } (~${outcome.beforeTokens} → ~${outcome.afterTokens} tokens).`,
      })
      return
    }
    if (outcome.overBudget && step === 0) {
      this.onEvent({
        type: 'notice',
        level: 'warn',
        message: `Transcript is over the context budget (~${outcome.beforeTokens} tokens) and cannot be compacted further. Start a new session for best results.`,
      })
    }
  }
}
