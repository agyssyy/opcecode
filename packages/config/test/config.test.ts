import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  ConfigError,
  type ConfigPatch,
  loadConfig,
  PRESETS,
  parseModelReference,
  resolveApiKey,
  resolveModel,
} from '../src/index.js'

const cwd = resolve('test-repo')
const home = resolve('test-home')
const globalPath = join(home, 'config.json')
const projectPath = join(cwd, 'opcecode.json')

interface LoadOptions {
  env?: NodeJS.ProcessEnv
  cli?: ConfigPatch
}

function load(files: Record<string, string>, options: LoadOptions = {}) {
  return loadConfig({
    cwd,
    home,
    env: options.env ?? {},
    cli: options.cli,
    readFile: (path) => files[path],
  })
}

describe('loadConfig', () => {
  it('returns defaults and warns when nothing is configured', () => {
    const loaded = load({})
    expect(loaded.config.model).toBe('')
    expect(loaded.config.context.maxSteps).toBe(25)
    expect(loaded.config.permissions.length).toBeGreaterThan(0)
    expect(loaded.sources).toHaveLength(2)
    expect(loaded.sources.every((source) => !source.found)).toBe(true)
    expect(loaded.warnings.join('\n')).toContain('No model configured')
  })

  it('applies global < project < env < cli precedence', () => {
    const loaded = load(
      {
        [globalPath]: JSON.stringify({
          model: 'openai/global-model',
          providers: { openai: { type: 'openai-compatible', apiKey: 'sk-global' } },
          context: { maxSteps: 5, readLimit: 100 },
        }),
        [projectPath]: JSON.stringify({
          model: 'openrouter/project-model',
          providers: { openai: { baseURL: 'https://example.test/v1' } },
          context: { maxSteps: 9 },
          permissions: [{ tool: 'bash', decision: 'deny' }],
        }),
      },
      { env: { OPCECODE_MODEL: 'env/env-model' } },
    )

    expect(loaded.config.model).toBe('env/env-model')
    expect(loaded.config.providers.openai).toEqual({
      type: 'openai-compatible',
      apiKey: 'sk-global',
      baseURL: 'https://example.test/v1',
    })
    expect(loaded.config.context).toEqual({ maxSteps: 9, readLimit: 100, bashTimeoutMs: 120_000 })
    expect(loaded.config.permissions).toEqual([{ tool: 'bash', decision: 'deny' }])
    expect(loaded.sources.map((source) => source.found)).toEqual([true, true])

    const withCli = load({}, { cli: { model: 'cli/cli-model' } })
    expect(withCli.config.model).toBe('cli/cli-model')
  })

  it('interpolates ${env:NAME} references', () => {
    const loaded = load(
      {
        [projectPath]: JSON.stringify({
          model: 'openrouter/openrouter/free',
          providers: {
            openrouter: {
              type: 'openai-compatible',
              baseURL: 'https://openrouter.ai/api/v1',
              apiKey: '${env:OPENROUTER_API_KEY}',
            },
          },
        }),
      },
      { env: { OPENROUTER_API_KEY: 'sk-or-test' } },
    )

    expect(loaded.config.providers.openrouter?.apiKey).toBe('sk-or-test')
  })

  it('warns instead of failing when a referenced env var is missing', () => {
    const loaded = load({
      [projectPath]: JSON.stringify({
        model: 'openrouter/openrouter/free',
        providers: {
          openrouter: {
            type: 'openai-compatible',
            apiKey: '${env:MISSING_KEY}',
          },
        },
      }),
    })

    expect(loaded.config.providers.openrouter?.apiKey).toBe('')
    expect(loaded.warnings.join('\n')).toContain('MISSING_KEY')
  })

  it('reports invalid JSON with the file path', () => {
    expect(() => load({ [projectPath]: '{ nope' })).toThrow(ConfigError)
    expect(() => load({ [projectPath]: '{ nope' })).toThrow(/opcecode\.json.*invalid JSON/)
  })

  it('rejects an invalid permission decision', () => {
    expect(() =>
      load({
        [projectPath]: JSON.stringify({ permissions: [{ tool: 'bash', decision: 'maybe' }] }),
      }),
    ).toThrow(/decision.*allow, ask, deny/)
  })

  it('warns about unknown keys but keeps loading', () => {
    const loaded = load({ [projectPath]: JSON.stringify({ modle: 'typo' }) })
    expect(loaded.warnings.join('\n')).toContain('Unknown key "modle"')
  })

  it('honours OPCECODE_CONFIG for the project file', () => {
    const loaded = load(
      { [join(cwd, 'custom.json')]: JSON.stringify({ model: 'custom/model' }) },
      { env: { OPCECODE_CONFIG: 'custom.json' } },
    )
    expect(loaded.config.model).toBe('custom/model')
    expect(loaded.sources[1]?.path).toBe(join(cwd, 'custom.json'))
  })

  it('warns when the provider for a model is missing', () => {
    const loaded = load({ [projectPath]: JSON.stringify({ model: 'ghost/model' }) })
    expect(loaded.warnings.join('\n')).toContain('provider "ghost"')
  })
})

describe('model references', () => {
  it('splits on the first slash so model IDs can contain slashes', () => {
    expect(parseModelReference('openrouter/openrouter/free')).toEqual({
      providerID: 'openrouter',
      modelID: 'openrouter/free',
    })
  })

  it('rejects references without both halves', () => {
    expect(parseModelReference('bare-model')).toBeNull()
    expect(parseModelReference('/model')).toBeNull()
    expect(parseModelReference('provider/')).toBeNull()
  })
})

describe('resolveModel', () => {
  it('resolves a configured model to its provider', () => {
    const loaded = load({
      [projectPath]: JSON.stringify({
        model: 'local/qwen2.5-coder-7b-instruct',
        providers: {
          local: { type: 'openai-compatible', baseURL: 'http://localhost:1234/v1' },
        },
      }),
    })
    expect(resolveModel(loaded.config)?.providerID).toBe('local')
    expect(resolveModel(loaded.config)?.modelID).toBe('qwen2.5-coder-7b-instruct')
  })
})

describe('resolveApiKey', () => {
  it('treats local base URLs as not requiring a key', () => {
    expect(
      resolveApiKey(
        'local',
        { type: 'openai-compatible', baseURL: 'http://127.0.0.1:1234/v1' },
        {},
      ),
    ).toEqual({ status: 'not-required' })
  })

  it('prefers a configured key', () => {
    expect(
      resolveApiKey('openai', { type: 'openai-compatible', apiKey: 'sk-x' }, {}),
    ).toMatchObject({ status: 'present', source: 'config' })
  })

  it('falls back to the provider environment variable', () => {
    expect(
      resolveApiKey('openrouter', { type: 'openai-compatible' }, { OPENROUTER_API_KEY: 'sk-or' }),
    ).toEqual({ status: 'present', source: 'env', envVar: 'OPENROUTER_API_KEY' })
  })

  it('reports the expected env var when missing', () => {
    expect(resolveApiKey('openrouter', { type: 'openai-compatible' }, {})).toEqual({
      status: 'missing',
      envVar: 'OPENROUTER_API_KEY',
    })
  })
})

describe('presets', () => {
  for (const preset of Object.values(PRESETS)) {
    it(`produces a valid config for "${preset.id}"`, () => {
      const loaded = load({ [projectPath]: JSON.stringify(preset.config) })
      expect(loaded.config.model).toBe(preset.config.model)
      expect(resolveModel(loaded.config)).not.toBeNull()
      expect(loaded.warnings.join('\n')).not.toContain('must be in "provider/model" form')
    })
  }
})
