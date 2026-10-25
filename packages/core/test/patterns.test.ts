import { describe, expect, it } from 'vitest'
import { isGlobPattern, matchGlob } from '../src/patterns.js'

describe('matchGlob', () => {
  it('matches a pattern without a slash at any depth', () => {
    expect(matchGlob('*.ts', 'a.ts')).toBe(true)
    expect(matchGlob('*.ts', 'src/a.ts')).toBe(true)
    expect(matchGlob('*.ts', 'src/deep/a.ts')).toBe(true)
    expect(matchGlob('*.ts', 'src/a.js')).toBe(false)
  })

  it('anchors patterns that contain a slash', () => {
    expect(matchGlob('src/*.ts', 'src/a.ts')).toBe(true)
    expect(matchGlob('src/*.ts', 'src/nested/a.ts')).toBe(false)
    expect(matchGlob('src/**/*.ts', 'src/a.ts')).toBe(true)
    expect(matchGlob('src/**/*.ts', 'src/nested/deep/a.ts')).toBe(true)
  })

  it('supports braces, question marks, and leading ./', () => {
    expect(matchGlob('*.{js,ts}', 'a.ts')).toBe(true)
    expect(matchGlob('*.{js,ts}', 'a.js')).toBe(true)
    expect(matchGlob('*.{js,ts}', 'a.css')).toBe(false)
    expect(matchGlob('?.md', 'a.md')).toBe(true)
    expect(matchGlob('?.md', 'ab.md')).toBe(false)
    expect(matchGlob('./src/*.ts', 'src/a.ts')).toBe(true)
  })

  it('matches root-relative paths with forward slashes', () => {
    expect(matchGlob('**/*.test.ts', 'packages/core/test/agent.test.ts')).toBe(true)
    expect(matchGlob('test/**', 'test/a/b.ts')).toBe(true)
    expect(matchGlob('test/**', 'other/test/a.ts')).toBe(false)
  })

  it('detects glob metacharacters', () => {
    expect(isGlobPattern('src/a.ts')).toBe(false)
    expect(isGlobPattern('*.ts')).toBe(true)
    expect(isGlobPattern('src/{a,b}.ts')).toBe(true)
  })
})
