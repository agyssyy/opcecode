import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageError } from '../src/args.js'
import { runInit, writePresetConfig } from '../src/commands/init.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opcecode-init-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('opcecode init', () => {
  it('writes a valid config from the default preset', () => {
    const cwd = tempDir()
    const outcome = writePresetConfig({ cwd })

    expect(outcome.path).toBe(join(cwd, 'opcecode.json'))
    expect(outcome.model).toBe('openrouter/openrouter/free')
    expect(outcome.envVars).toContain('OPENROUTER_API_KEY')

    const config = JSON.parse(readFileSync(outcome.path, 'utf8'))
    expect(config.model).toBe('openrouter/openrouter/free')
    expect(config.providers.openrouter.baseURL).toBe('https://openrouter.ai/api/v1')
    expect(Array.isArray(config.permissions)).toBe(true)
  })

  it('refuses to overwrite without --force', () => {
    const cwd = tempDir()
    writePresetConfig({ cwd })
    expect(() => writePresetConfig({ cwd })).toThrow(UsageError)
    expect(() => writePresetConfig({ cwd })).toThrow(/already exists/)
  })

  it('overwrites with --force', () => {
    const cwd = tempDir()
    writePresetConfig({ cwd })
    const outcome = writePresetConfig({ cwd, preset: 'local', force: true })
    expect(outcome.presetID).toBe('local')
    expect(JSON.parse(readFileSync(outcome.path, 'utf8')).model).toBe(
      'local/qwen2.5-coder-7b-instruct',
    )
  })

  it('accepts a model override for the configured provider', () => {
    const cwd = tempDir()
    const outcome = writePresetConfig({
      cwd,
      preset: 'groq',
      model: 'groq/some-other-model',
    })
    expect(outcome.model).toBe('groq/some-other-model')
  })

  it('rejects a model for a provider the preset does not configure', () => {
    const cwd = tempDir()
    expect(() => writePresetConfig({ cwd, preset: 'groq', model: 'openai/gpt-4.1-mini' })).toThrow(
      /configures provider "groq"/,
    )
  })

  it('rejects unknown presets', () => {
    expect(() => writePresetConfig({ cwd: tempDir(), preset: 'nope' })).toThrow(/Unknown preset/)
  })

  it('prints next steps', () => {
    const cwd = tempDir()
    expect(runInit({ cwd, color: false })).toBe(0)
  })
})
