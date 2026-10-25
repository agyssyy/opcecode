import type { PermissionDecision, PermissionRule } from '@opcecode/config'

export type RiskLevel = 'low' | 'medium' | 'high'

export interface ApprovalRequest {
  callID: string
  tool: string
  subject: string
  risk: RiskLevel
  args: Record<string, unknown>
}

export type ApprovalDecision = 'allow-once' | 'allow-session' | 'deny'

function escapeRegExp(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char
}

/**
 * Small glob matcher for permission patterns: `*` matches any run of
 * characters, `?` matches one character, and everything else is literal.
 * Paths are compared with forward slashes on every platform.
 */
export function matchesPattern(pattern: string, subject: string): boolean {
  if (pattern === '') return true
  const normalizedPattern = pattern.replaceAll('\\', '/')
  const normalizedSubject = subject.replaceAll('\\', '/')

  let source = '^'
  for (let index = 0; index < normalizedPattern.length; index += 1) {
    const char = normalizedPattern[index] ?? ''
    if (char === '*') {
      if (normalizedPattern[index + 1] === '*') index += 1
      source += '.*'
    } else if (char === '?') {
      source += '.'
    } else {
      source += escapeRegExp(char)
    }
  }
  source += '$'

  return new RegExp(source, 's').test(normalizedSubject)
}

/**
 * Applies ordered permission rules. The first matching rule wins, and tools
 * without a matching rule ask by default. "Always allow" decisions are scoped
 * to one tool + subject pair for this session.
 */
export class PermissionEngine {
  private readonly rules: PermissionRule[]
  private readonly sessionAllows: Array<{ tool: string; subject: string }> = []

  constructor(rules: PermissionRule[]) {
    this.rules = rules
  }

  evaluate(tool: string, subject: string): PermissionDecision {
    if (this.sessionAllows.some((entry) => entry.tool === tool && entry.subject === subject)) {
      return 'allow'
    }

    for (const rule of this.rules) {
      if (rule.tool !== '*' && rule.tool !== tool) continue
      if (rule.pattern !== undefined && !matchesPattern(rule.pattern, subject)) continue
      return rule.decision
    }

    return 'ask'
  }

  allowForSession(tool: string, subject: string): void {
    if (this.sessionAllows.some((entry) => entry.tool === tool && entry.subject === subject)) {
      return
    }
    this.sessionAllows.push({ tool, subject })
  }
}
