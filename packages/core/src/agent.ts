import type { OpceCodeConfig } from '@opcecode/config'
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
}

function systemPrompt(cwd: string): string {
  return [
    'You are OpceCode!, a terminal coding agent.',
    `Workspace root: ${cwd}`,
    `Commands run with ${detectShell().label}.`,
    '',
    'Guidelines:',
    '- Use the provided tools instead of guessing file contents.',
    '- Read a file before you edit it, and write complete file contents with the write tool.',
    '- Keep responses short and focused on the task.',
    '- Prefer small, verifiable shell commands.',
    '- After making changes, summarize what changed.',
  ].join('\n')
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
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
  private readonly messages: ChatMessage[]
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
    this.messages = [...options.session.transcript()]
  }

  async send(text: string, signal: AbortSignal): Promise<TurnResult> {
    this.session.setTitleFrom(text)
    this.session.append({ type: 'user.message', content: text })
    this.messages.push({ role: 'user', content: text })

    const usage: TurnUsage = { inputTokens: 0, outputTokens: 0, estimated: false }
    const maxSteps = Math.max(this.config.context.maxSteps, 1)
    let steps = 0
    let usageLogged = false

    const finalize = (reason: TurnReason, error?: string): TurnResult => {
      if (!usageLogged) {
        this.session.append({ type: 'usage', ...usage })
        usageLogged = true
      }
      this.session.touch()
      const result: TurnResult = { reason, steps, usage, ...(error ? { error } : {}) }
      this.onEvent({ type: 'turn.end', result })
      return result
    }

    try {
      for (; steps < maxSteps; steps += 1) {
        if (signal.aborted) throw createAbortError()

        const request: ChatRequest = {
          model: this.model,
          messages: [{ role: 'system', content: systemPrompt(this.cwd) }, ...this.messages],
          tools: this.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          })),
        }

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
}
