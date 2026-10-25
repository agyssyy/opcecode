import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { loadProjectInstructions } from '../src/instructions.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opcecode-instructions-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('loadProjectInstructions', () => {
  it('loads configured files and .opcecode/rules in sorted order', () => {
    const root = tempDir()
    writeFileSync(join(root, 'AGENTS.md'), 'Use tabs.\n')
    mkdirSync(join(root, '.opcecode', 'rules'), { recursive: true })
    writeFileSync(join(root, '.opcecode', 'rules', '10-style.md'), 'Prefer early returns.\n')
    writeFileSync(join(root, '.opcecode', 'rules', '99-extra.md'), 'Be terse.\n')

    const result = loadProjectInstructions(root, ['AGENTS.md', 'OPCECODE.md'])
    expect(result.files).toEqual([
      'AGENTS.md',
      '.opcecode/rules/10-style.md',
      '.opcecode/rules/99-extra.md',
    ])
    expect(result.text).toContain('Use tabs.')
    expect(result.text).toContain('Prefer early returns.')
    expect(result.text).toContain('Be terse.')
  })

  it('returns empty text when nothing is found', () => {
    const root = tempDir()
    const result = loadProjectInstructions(root, ['AGENTS.md'])
    expect(result.files).toEqual([])
    expect(result.text).toBe('')
  })

  it('skips file names that try to escape the workspace', () => {
    const root = tempDir()
    const result = loadProjectInstructions(root, ['../outside.md'])
    expect(result.files).toEqual([])
  })
})
