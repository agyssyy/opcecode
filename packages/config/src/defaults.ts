import type { OpceCodeConfig } from './types.js'

export const DEFAULT_CONFIG: OpceCodeConfig = {
  model: '',
  providers: {},
  permissions: [
    { tool: 'read', decision: 'allow' },
    { tool: 'list', decision: 'allow' },
    { tool: 'glob', decision: 'allow' },
    { tool: 'grep', decision: 'allow' },
    { tool: 'todo', decision: 'allow' },
    { tool: 'write', decision: 'ask' },
    { tool: 'edit', decision: 'ask' },
    { tool: 'bash', decision: 'ask' },
    { tool: 'py', decision: 'ask' },
  ],
  context: {
    maxSteps: 25,
    readLimit: 500,
    bashTimeoutMs: 120_000,
    maxContextTokens: 24_000,
  },
  projectInstructions: ['AGENTS.md', 'OPCECODE.md'],
}
