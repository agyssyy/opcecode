export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface TodoItem {
  text: string
  status: TodoStatus
}

const STATUS_MARKS: Record<TodoStatus, string> = {
  pending: '[ ]',
  in_progress: '[~]',
  completed: '[x]',
}

/** Session-scoped task list. Owned by the agent, rendered by the todo tool. */
export class TodoList {
  private items: TodoItem[] = []

  set(items: TodoItem[]): void {
    this.items = items
  }

  all(): TodoItem[] {
    return [...this.items]
  }

  get size(): number {
    return this.items.length
  }

  isEmpty(): boolean {
    return this.items.length === 0
  }

  render(): string {
    if (this.items.length === 0) return '(no tasks)'
    return this.items
      .map((item, index) => `${index + 1}. ${STATUS_MARKS[item.status]} ${item.text}`)
      .join('\n')
  }
}
