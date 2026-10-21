import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ConfigError,
  type ConfigPatch,
  type ConfigSource,
  DEFAULT_CONFIG,
  type LoadedConfig,
  mergeConfig,
} from '@opcecode/config'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { type CommandRunner, collectChecks, runDoctor } from '../src/commands/doctor.js'

const dirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'opcecode-doctor-'))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function loaded(patch: ConfigPatch, sources: ConfigSource[] = []): LoadedConfig {
  return { config: mergeConfig(DEFAULT_CONFIG, patch), sources, warnings: [] }
}

const healthyRun: CommandRunner = (command) => {
  if (command === 'python') return { ok: true, stdout: 'Python 3.14.0', stderr: '' }
  if (command === 'pwsh') return { ok: true, stdout: 'PowerShell 7.4.20', stderr: '' }
  return { ok: true, stdout: `${command} version 1`, stderr: '' }
}

const noPythonRun: CommandRunner = (command) =>
  command === 'python' ? { ok: false, stdout: '', stderr: 'not found' } : healthyRun(command)

function findCheck(checks: ReturnType<typeof collectChecks>, id: string) {
  const check = checks.find((entry) => entry.id === id)
  if (!check) throw new Error(`missing check ${id}`)
  return check
}

describe('doctor', () => {
  it('reports setup details and warns about a missing key', () => {
    const checks = collectChecks({
      cwd: tempDir(),
      env: {},
      run: noPythonRun,
      ensureHome: () => {},
      load: () =>
        loaded(
          {
            model: 'openrouter/openrouter/free',
            providers: { openrouter: { type: 'openai-compatible' } },
          },
          [{ path: 'opcecode.json', kind: 'project', found: true }],
        ),
    })

    expect(findCheck(checks, 'node').status).toBe('ok')
    expect(findCheck(checks, 'workspace').status).toBe('ok')
    expect(findCheck(checks, 'config').status).toBe('ok')
    expect(findCheck(checks, 'model').status).toBe('ok')
    expect(findCheck(checks, 'api-key')).toMatchObject({
      status: 'warn',
      detail: 'missing OPENROUTER_API_KEY',
    })
    expect(findCheck(checks, 'python').status).toBe('warn')
  })

  it('warns when no model is configured', () => {
    const checks = collectChecks({
      cwd: tempDir(),
      env: {},
      run: noPythonRun,
      ensureHome: () => {},
      load: () => loaded({}),
    })
    expect(findCheck(checks, 'model')).toMatchObject({ status: 'warn', detail: 'not configured' })
    expect(findCheck(checks, 'config').status).toBe('warn')
  })

  it('does not require a key for a local endpoint', () => {
    const checks = collectChecks({
      cwd: tempDir(),
      env: {},
      run: noPythonRun,
      ensureHome: () => {},
      load: () =>
        loaded({
          model: 'local/qwen2.5-coder-7b-instruct',
          providers: {
            local: { type: 'openai-compatible', baseURL: 'http://localhost:1234/v1' },
          },
        }),
    })
    expect(findCheck(checks, 'api-key')).toMatchObject({ status: 'ok', detail: 'local endpoint' })
  })

  it('fails with exit code 1 and JSON when config is invalid', () => {
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line))
    })

    const code = runDoctor({
      cwd: tempDir(),
      env: {},
      json: true,
      color: false,
      run: noPythonRun,
      ensureHome: () => {},
      load: () => {
        throw new ConfigError('invalid JSON', 'opcecode.json')
      },
    })

    spy.mockRestore()

    expect(code).toBe(1)
    const payload = JSON.parse(logs[0] ?? '{}')
    expect(payload.ok).toBe(false)
    expect(payload.checks.find((check: { id: string }) => check.id === 'config').status).toBe(
      'fail',
    )
  })

  it('renders human output', () => {
    const logs: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line?: unknown) => {
      logs.push(String(line))
    })

    const code = runDoctor({
      cwd: tempDir(),
      env: {},
      json: false,
      color: false,
      run: healthyRun,
      ensureHome: () => {},
      load: () =>
        loaded(
          {
            model: 'local/qwen2.5-coder-7b-instruct',
            providers: {
              local: { type: 'openai-compatible', baseURL: 'http://localhost:1234/v1' },
            },
          },
          [{ path: 'opcecode.json', kind: 'project', found: true }],
        ),
    })

    spy.mockRestore()

    expect(code).toBe(0)
    expect(logs.join('\n')).toContain('OpceCode! doctor')
    expect(logs.join('\n')).toContain('All checks passed.')
  })
})
