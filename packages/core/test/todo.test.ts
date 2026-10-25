import { describe, expect, it } from 'vitest'
import { TodoList } from '../src/todo.js'
import { todoTool } from '../src/tools/index.js'
import type { ToolContext } from '../src/tools/types.js'

function context(): ToolContext {
  return {
    cwd: process.cwd(),
    signal: new AbortController().signal,
    readLimit: 500,
    bashTimeoutMs: 5000,
    todo: new TodoList(),
  }
}

describe('TodoList', () => {
  it('renders statuses and reports emptiness', () => {
    const todo = new TodoList()
    expect(todo.isEmpty()).toBe(true)
    expect(todo.render()).toBe('(no tasks)')

    todo.set([
      { text: 'first', status: 'completed' },
      { text: 'second', status: 'in_progress' },
      { text: 'third', status: 'pending' },
    ])
    expect(todo.render()).toBe('1. [x] first\n2. [~] second\n3. [ ] third')
    expect(todo.all()).toHaveLength(3)
  })
})

describe('todoTool', () => {
  it('replaces the session list and returns its rendering', async () => {
    const ctx = context()
    const result = await todoTool.execute(
      { items: [{ text: 'plan' }, { text: 'build', status: 'in_progress' }] },
      ctx,
    )

    expect(result.output).toContain('[ ] plan')
    expect(result.output).toContain('[~] build')
    expect(ctx.todo.size).toBe(2)
  })

  it('clears with an empty array', async () => {
    const ctx = context()
    await todoTool.execute({ items: [{ text: 'x' }] }, ctx)
    const result = await todoTool.execute({ items: [] }, ctx)

    expect(result.output).toBe('(no tasks)')
    expect(ctx.todo.isEmpty()).toBe(true)
  })

  it('rejects invalid statuses and non-arrays', async () => {
    const ctx = context()
    await expect(todoTool.execute({ items: [{ text: 'x', status: 'done' }] }, ctx)).rejects.toThrow(
      /invalid status/,
    )
    await expect(todoTool.execute({ items: 'nope' }, ctx)).rejects.toThrow(/expected an array/)
  })
})
