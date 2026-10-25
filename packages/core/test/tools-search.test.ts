import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TodoList } from '../src/todo.js'
import { globTool, grepTool, listTool } from '../src/tools/index.js'
import type { ToolContext } from '../src/tools/types.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opcecode-search-'))
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

function fixture(): string {
  const root = tempDir()
  mkdirSync(join(root, 'src', 'nested'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true })
  writeFileSync(join(root, 'README.md'), '# Demo\n')
  writeFileSync(join(root, 'src', 'app.ts'), 'export const x = 1\nconst secret = "TODO fix"\n')
  writeFileSync(join(root, 'src', 'nested', 'util.ts'), 'export function util() {}\n')
  writeFileSync(join(root, 'src', 'notes.log'), 'TODO but ignored\n')
  writeFileSync(join(root, 'node_modules', 'pkg', 'index.ts'), 'TODO in modules\n')
  writeFileSync(join(root, '.gitignore'), '*.log\n')
  return root
}

describe('listTool', () => {
  it('lists direct children and skips ignored and always-skipped paths', async () => {
    const root = fixture()
    const result = await listTool.execute({}, context(root))

    expect(result.output).toContain('README.md')
    expect(result.output).toContain('src/')
    expect(result.output).not.toContain('node_modules')
  })

  it('walks deeper with depth and a subdirectory', async () => {
    const root = fixture()
    const result = await listTool.execute({ path: 'src', depth: 2 }, context(root))

    expect(result.output).toContain('app.ts')
    expect(result.output).toContain('nested/')
    expect(result.output).toContain('util.ts')
    expect(result.output).not.toContain('notes.log')
  })

  it('rejects files', async () => {
    const root = fixture()
    await expect(listTool.execute({ path: 'README.md' }, context(root))).rejects.toThrow(
      /Not a directory/,
    )
  })
})

describe('globTool', () => {
  it('finds files at any depth for a bare pattern', async () => {
    const root = fixture()
    const result = await globTool.execute({ pattern: '*.ts' }, context(root))

    const lines = result.output.split('\n')
    expect(lines).toContain('src/app.ts')
    expect(lines).toContain('src/nested/util.ts')
    expect(result.output).not.toContain('node_modules')
  })

  it('supports nested globs and an explicit path', async () => {
    const root = fixture()
    const result = await globTool.execute({ pattern: 'nested/*.ts', path: 'src' }, context(root))

    expect(result.output).toContain('src/nested/util.ts')
    expect(result.output).not.toContain('src/app.ts')
  })

  it('reports no matches', async () => {
    const root = fixture()
    const result = await globTool.execute({ pattern: '*.rs' }, context(root))
    expect(result.output).toContain('No files match')
  })
})

describe('grepTool', () => {
  it('returns file:line matches and honors .gitignore', async () => {
    const root = fixture()
    const result = await grepTool.execute({ pattern: 'TODO', include: '*.ts' }, context(root))

    expect(result.output).toContain('src/app.ts:2:')
    expect(result.output).toContain('TODO fix')
    expect(result.output).not.toContain('notes.log')
    expect(result.output).not.toContain('node_modules')
  })

  it('searches a single file and supports ignoreCase', async () => {
    const root = fixture()
    const result = await grepTool.execute(
      { pattern: 'todo', path: 'src/app.ts', ignoreCase: true },
      context(root),
    )
    expect(result.output).toContain('src/app.ts:2:')
  })

  it('rejects invalid regular expressions', async () => {
    const root = fixture()
    await expect(grepTool.execute({ pattern: '(' }, context(root))).rejects.toThrow(
      /Invalid regular expression/,
    )
  })

  it('reports no matches', async () => {
    const root = fixture()
    const result = await grepTool.execute({ pattern: 'zzz-not-here' }, context(root))
    expect(result.output).toContain('No matches')
  })
})
