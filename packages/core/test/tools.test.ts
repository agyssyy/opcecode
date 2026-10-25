import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TodoList } from '../src/todo.js'
import { bashTool, readTool, writeTool } from '../src/tools/index.js'
import { resolveWorkspacePath } from '../src/tools/path.js'
import { type ToolContext, ToolError } from '../src/tools/types.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opcecode-tools-'))
  dirs.push(dir)
  return dir
}

function context(cwd: string, bashTimeoutMs = 10_000): ToolContext {
  return {
    cwd,
    signal: new AbortController().signal,
    readLimit: 500,
    bashTimeoutMs,
    todo: new TodoList(),
  }
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
})

describe('resolveWorkspacePath', () => {
  it('resolves relative paths inside the workspace', () => {
    const root = tempDir()
    expect(resolveWorkspacePath(root, 'src/a.ts').relative).toBe('src/a.ts')
  })

  it('rejects paths that escape the workspace', () => {
    const root = tempDir()
    expect(() => resolveWorkspacePath(root, '../escape.txt')).toThrow(ToolError)
    expect(() => resolveWorkspacePath(root, join(root, '..', 'escape.txt'))).toThrow(
      /outside the workspace/,
    )
    expect(() => resolveWorkspacePath(root, '.')).toThrow(/outside the workspace/)
  })
})

describe('readTool', () => {
  it('returns numbered lines with offset and limit', async () => {
    const root = tempDir()
    writeFileSync(join(root, 'a.txt'), 'one\ntwo\nthree\nfour\n')

    const result = await readTool.execute({ path: 'a.txt', offset: 2, limit: 2 }, context(root))
    expect(result.output).toContain('    2\ttwo')
    expect(result.output).toContain('    3\tthree')
    expect(result.output).not.toContain('one')
    expect(result.output).toContain('1 more lines')
  })

  it('rejects missing files and directories', async () => {
    const root = tempDir()
    await expect(readTool.execute({ path: 'nope.txt' }, context(root))).rejects.toThrow(
      /File not found/,
    )
    await expect(readTool.execute({ path: '.' }, context(root))).rejects.toThrow(ToolError)
  })

  it('refuses binary content', async () => {
    const root = tempDir()
    writeFileSync(join(root, 'bin.dat'), Buffer.from([0x00, 0x01, 0x02]))
    await expect(readTool.execute({ path: 'bin.dat' }, context(root))).rejects.toThrow(/binary/)
  })
})

describe('writeTool', () => {
  it('creates parent directories and writes content', async () => {
    const root = tempDir()
    const result = await writeTool.execute(
      { path: 'nested/a.txt', content: 'hello' },
      context(root),
    )
    expect(result.output).toContain('Created nested/a.txt')
    expect(readFileSync(join(root, 'nested', 'a.txt'), 'utf8')).toBe('hello')
  })

  it('overwrites and reports no-op writes', async () => {
    const root = tempDir()
    await writeTool.execute({ path: 'a.txt', content: 'one' }, context(root))
    const overwrite = await writeTool.execute({ path: 'a.txt', content: 'two' }, context(root))
    expect(overwrite.output).toContain('Overwrote')
    const unchanged = await writeTool.execute({ path: 'a.txt', content: 'two' }, context(root))
    expect(unchanged.output).toContain('No changes')
  })

  it('rejects writes outside the workspace', async () => {
    const root = tempDir()
    await expect(
      writeTool.execute({ path: '../escape.txt', content: 'x' }, context(root)),
    ).rejects.toThrow(/outside the workspace/)
  })
})

describe('bashTool', () => {
  it('runs a command and returns its output', async () => {
    const root = tempDir()
    const result = await bashTool.execute(
      { command: 'node -e "console.log(\'hi\')"' },
      context(root),
    )
    expect(result.output).toContain('hi')
    expect(result.output).toContain('exit code: 0')
    expect(result.isError).not.toBe(true)
  })

  it('marks non-zero exit codes as errors', async () => {
    const root = tempDir()
    const result = await bashTool.execute({ command: 'node -e "process.exit(3)"' }, context(root))
    expect(result.isError).toBe(true)
    expect(result.output).toContain('exit code: 3')
  })

  it('times out long commands', async () => {
    const root = tempDir()
    const result = await bashTool.execute(
      { command: 'node -e "setTimeout(() => {}, 5000)"', timeoutMs: 150 },
      context(root, 1000),
    )
    expect(result.isError).toBe(true)
    expect(result.output).toContain('timed out')
  })

  it('does not leak provider keys into child processes', async () => {
    const root = tempDir()
    const previous = process.env.OPENAI_API_KEY
    process.env.OPENAI_API_KEY = 'super-secret'
    try {
      const result = await bashTool.execute(
        { command: 'node -e "console.log(process.env.OPENAI_API_KEY ?? \'unset\')"' },
        context(root),
      )
      expect(result.output).toContain('unset')
      expect(result.output).not.toContain('super-secret')
    } finally {
      if (previous === undefined) delete process.env.OPENAI_API_KEY
      else process.env.OPENAI_API_KEY = previous
    }
  })
})
