import { describe, expect, it } from 'vitest'
import { parseCommandLine, UsageError } from '../src/args.js'

describe('parseCommandLine', () => {
  it('defaults to chat', () => {
    expect(parseCommandLine([])).toMatchObject({
      command: 'chat',
      flags: { color: true, json: false, force: false },
    })
  })

  it('parses the explicit chat command', () => {
    expect(parseCommandLine(['chat']).command).toBe('chat')
  })

  it('parses doctor flags', () => {
    expect(parseCommandLine(['doctor', '--json', '--no-color', '--cwd', 'repo'])).toMatchObject({
      command: 'doctor',
      flags: { json: true, color: false, cwd: 'repo' },
    })
  })

  it('parses init flags', () => {
    expect(
      parseCommandLine(['init', '--preset', 'local', '--model', 'local/model', '--force']),
    ).toMatchObject({
      command: 'init',
      flags: { preset: 'local', model: 'local/model', force: true },
    })
  })

  it('treats --version as the version command', () => {
    expect(parseCommandLine(['--version']).command).toBe('version')
    expect(parseCommandLine(['-v']).command).toBe('version')
  })

  it('rejects unknown commands', () => {
    expect(() => parseCommandLine(['frobnicate'])).toThrow(UsageError)
    expect(() => parseCommandLine(['frobnicate'])).toThrow(/Unknown command/)
  })

  it('rejects unknown options', () => {
    expect(() => parseCommandLine(['doctor', '--wat'])).toThrow(UsageError)
  })

  it('rejects extra positionals', () => {
    expect(() => parseCommandLine(['doctor', 'extra'])).toThrow(/Unexpected argument/)
  })
})
