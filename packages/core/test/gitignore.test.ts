import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { IgnoreMatcher, parseGitignorePattern } from '../src/gitignore.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opcecode-ignore-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('parseGitignorePattern', () => {
  it('ignores blank lines and comments', () => {
    expect(parseGitignorePattern('')).toBeNull()
    expect(parseGitignorePattern('   ')).toBeNull()
    expect(parseGitignorePattern('# comment')).toBeNull()
  })

  it('parses negation and directory-only rules', () => {
    const negated = parseGitignorePattern('!keep.log')
    expect(negated?.negated).toBe(true)
    expect(negated?.dirOnly).toBe(false)

    const dir = parseGitignorePattern('build/')
    expect(dir?.dirOnly).toBe(true)
    expect(dir?.regex.test('build')).toBe(true)
    expect(dir?.regex.test('nested/build')).toBe(true)
  })

  it('anchors patterns that contain a slash', () => {
    const anchored = parseGitignorePattern('/dist')
    expect(anchored?.regex.test('dist')).toBe(true)
    expect(anchored?.regex.test('nested/dist')).toBe(false)

    const deep = parseGitignorePattern('src/gen/**')
    expect(deep?.regex.test('src/gen/a/b.ts')).toBe(true)
    expect(deep?.regex.test('src/other/a.ts')).toBe(false)
  })
})

describe('IgnoreMatcher', () => {
  it('applies rules from the root .gitignore', () => {
    const root = tempDir()
    writeFileSync(join(root, '.gitignore'), '*.log\nbuild/\n!keep.log\n')

    const matcher = new IgnoreMatcher(root)
    matcher.loadDirectory('')
    expect(matcher.ignores('a.log', false)).toBe(true)
    expect(matcher.ignores('nested/a.log', false)).toBe(true)
    expect(matcher.ignores('keep.log', false)).toBe(false)
    expect(matcher.ignores('build', true)).toBe(true)
    expect(matcher.ignores('build', false)).toBe(false)
    expect(matcher.ignores('src', true)).toBe(false)
  })

  it('lets deeper .gitignore files win over shallower rules', () => {
    const root = tempDir()
    writeFileSync(join(root, '.gitignore'), '*.log\n')
    mkdirSync(join(root, 'sub'))
    writeFileSync(join(root, 'sub', '.gitignore'), '!important.log\n')

    const matcher = new IgnoreMatcher(root)
    matcher.loadDirectory('')
    matcher.loadDirectory('sub')
    expect(matcher.ignores('sub/a.log', false)).toBe(true)
    expect(matcher.ignores('sub/important.log', false)).toBe(false)
    expect(matcher.ignores('other/a.log', false)).toBe(true)
  })

  it('treats a missing .gitignore as an empty rule set', () => {
    const root = tempDir()
    const matcher = new IgnoreMatcher(root)
    expect(() => matcher.loadDirectory('')).not.toThrow()
    expect(matcher.ignores('anything.txt', false)).toBe(false)
  })
})
