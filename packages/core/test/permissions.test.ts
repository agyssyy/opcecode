import { describe, expect, it } from 'vitest'
import { matchesPattern, PermissionEngine } from '../src/permissions.js'

describe('matchesPattern', () => {
  it('matches glob stars and question marks', () => {
    expect(matchesPattern('src/**', 'src/a/b.ts')).toBe(true)
    expect(matchesPattern('*.ts', 'src/a.ts')).toBe(true)
    expect(matchesPattern('src/*.ts', 'src/a.ts')).toBe(true)
    expect(matchesPattern('file?.txt', 'file1.txt')).toBe(true)
    expect(matchesPattern('file?.txt', 'file10.txt')).toBe(false)
  })

  it('treats backslashes as path separators', () => {
    expect(matchesPattern('src/**', 'src\\a.ts')).toBe(true)
  })

  it('matches everything for an empty pattern', () => {
    expect(matchesPattern('', 'anything at all')).toBe(true)
  })

  it('escapes regular expression characters', () => {
    expect(matchesPattern('a+b.ts', 'a+b.ts')).toBe(true)
    expect(matchesPattern('a+b.ts', 'aab.ts')).toBe(false)
  })
})

describe('PermissionEngine', () => {
  it('uses the first matching rule', () => {
    const engine = new PermissionEngine([
      { tool: 'bash', pattern: 'git *', decision: 'allow' },
      { tool: 'bash', decision: 'deny' },
    ])
    expect(engine.evaluate('bash', 'git status')).toBe('allow')
    expect(engine.evaluate('bash', 'rm -rf /')).toBe('deny')
  })

  it('asks when no rule matches', () => {
    expect(new PermissionEngine([]).evaluate('write', 'a.txt')).toBe('ask')
  })

  it('supports a wildcard tool', () => {
    const engine = new PermissionEngine([{ tool: '*', decision: 'deny' }])
    expect(engine.evaluate('anything', 'x')).toBe('deny')
  })

  it('remembers session approvals for the exact tool and subject', () => {
    const engine = new PermissionEngine([{ tool: 'write', decision: 'ask' }])
    expect(engine.evaluate('write', 'a.txt')).toBe('ask')
    engine.allowForSession('write', 'a.txt')
    expect(engine.evaluate('write', 'a.txt')).toBe('allow')
    expect(engine.evaluate('write', 'b.txt')).toBe('ask')
  })
})
