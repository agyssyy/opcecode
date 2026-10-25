import type { TodoItem, TodoStatus } from '../todo.js'
import { requireString, type ToolDefinition, ToolError } from './types.js'

const MAX_ITEMS = 50
const MAX_TEXT = 200

const STATUSES: readonly TodoStatus[] = ['pending', 'in_progress', 'completed']

function parseItems(raw: unknown): TodoItem[] {
  if (!Array.isArray(raw)) {
    throw new ToolError('Missing or invalid "items" argument: expected an array.')
  }
  if (raw.length > MAX_ITEMS) {
    throw new ToolError(`Too many tasks (${raw.length}). Maximum is ${MAX_ITEMS}.`)
  }

  return raw.map((entry, index) => {
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ToolError(`Task ${index + 1} must be an object with "text" and optional "status".`)
    }
    const record = entry as Record<string, unknown>
    const text = requireString(record, 'text').trim().slice(0, MAX_TEXT)
    const status = record.status ?? 'pending'
    if (typeof status !== 'string' || !STATUSES.includes(status as TodoStatus)) {
      throw new ToolError(
        `Task ${index + 1} has invalid status "${String(status)}". Use pending, in_progress, or completed.`,
      )
    }
    return { text, status: status as TodoStatus }
  })
}

export const todoTool: ToolDefinition = {
  name: 'todo',
  description:
    'Replace the session task list. Use it to plan multi-step work and keep progress visible: send the full list every time, marking items pending, in_progress, or completed. Send an empty array to clear it.',
  parameters: {
    type: 'object',
    properties: {
      items: {
        type: 'array',
        description:
          'Complete task list. Each item: { "text": string, "status": "pending"|"in_progress"|"completed" }.',
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'Short task description.' },
            status: {
              type: 'string',
              enum: ['pending', 'in_progress', 'completed'],
              description: 'Defaults to pending.',
            },
          },
          required: ['text'],
        },
      },
    },
    required: ['items'],
    additionalProperties: false,
  },
  risk: 'low',
  subject(args) {
    const count = Array.isArray(args.items) ? args.items.length : 0
    return `${count} task${count === 1 ? '' : 's'}`
  },
  async execute(args, context) {
    const items = parseItems(args.items)
    context.todo.set(items)
    return { output: context.todo.render() }
  },
}
