import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TodoList } from '../src/todo.js'
import { editTool } from '../src/tools/index.js'
import type { ToolContext } from '../src/tools/types.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opcecode-edit-'))
  dirs.push(dir)
  return dir
}

function context(cwd: string): ToolContext {
  return {
    cwd,
    signal: new AbortController().signal,
    readLimit: 500,
    bashTimeoutMs: 5000,
    todo: new TodoList(),
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('editTool', () => {
  it('replaces a unique snippet and reports the line', async () => {
    const root = tempDir()
    writeFileSync(join(root, 'a.ts'), 'line one\nconst x = 1\nline three\n')

    const result = await editTool.execute(
      { path: 'a.ts', oldString: 'const x = 1', newString: 'const x = 2' },
      context(root),
    )

    expect(result.output).toContain('1 replacement')
    expect(result.output).toContain('line 2')
    expect(readFileSync(join(root, 'a.ts'), 'utf8')).toBe('line one\nconst x = 2\nline three\n')
  })

  it('refuses an ambiguous match unless replaceAll is set', async () => {
    const root = tempDir()
    writeFileSync(join(root, 'a.txt'), 'x\nx\n')

    await expect(
      editTool.execute({ path: 'a.txt', oldString: 'x', newString: 'y' }, context(root)),
    ).rejects.toThrow(/matches 2 times/)

    const result = await editTool.execute(
      { path: 'a.txt', oldString: 'x', newString: 'y', replaceAll: true },
      context(root),
    )
    expect(result.output).toContain('2 replacements')
    expect(readFileSync(join(root, 'a.txt'), 'utf8')).toBe('y\ny\n')
  })

  it('reports missing text instead of guessing', async () => {
    const root = tempDir()
    writeFileSync(join(root, 'a.txt'), 'hello\n')

    await expect(
      editTool.execute({ path: 'a.txt', oldString: 'goodbye', newString: 'x' }, context(root)),
    ).rejects.toThrow(/oldString not found/)
  })

  it('treats an identical replacement as a no-op', async () => {
    const root = tempDir()
    writeFileSync(join(root, 'a.txt'), 'same\n')

    const result = await editTool.execute(
      { path: 'a.txt', oldString: 'same', newString: 'same' },
      context(root),
    )
    expect(result.output).toContain('No changes')
  })

  it('rejects missing files and escapes', async () => {
    const root = tempDir()
    await expect(
      editTool.execute({ path: 'ghost.txt', oldString: 'a', newString: 'b' }, context(root)),
    ).rejects.toThrow(/File not found/)
    await expect(
      editTool.execute({ path: '../escape.txt', oldString: 'a', newString: 'b' }, context(root)),
    ).rejects.toThrow(/outside the workspace/)
  })
})
