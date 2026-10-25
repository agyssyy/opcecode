import type { OpceCodeConfig } from './types.js'

export interface ProviderPreset {
  id: string
  label: string
  description: string
  config: Partial<OpceCodeConfig>
}

/**
 * Presets are starting points, not promises. Free tiers change their model
 * catalogues; edit `opcecode.json` or rerun `opcecode init --force` when a
 * model is retired.
 */
export const PRESETS: Record<string, ProviderPreset> = {
  'openrouter-free': {
    id: 'openrouter-free',
    label: 'OpenRouter free router',
    description:
      'One key, many free models. Rate limited. The `openrouter/free` router picks an available free model.',
    config: {
      model: 'openrouter/openrouter/free',
      providers: {
        openrouter: {
          type: 'openai-compatible',
          baseURL: 'https://openrouter.ai/api/v1',
          apiKey: '${env:OPENROUTER_API_KEY}',
          models: ['openrouter/free'],
        },
      },
    },
  },
  groq: {
    id: 'groq',
    label: 'Groq free tier',
    description:
      'Very fast inference with a free rate-limited tier. Retired model IDs can be swapped.',
    config: {
      model: 'groq/llama-3.3-70b-versatile',
      providers: {
        groq: {
          type: 'openai-compatible',
          baseURL: 'https://api.groq.com/openai/v1',
          apiKey: '${env:GROQ_API_KEY}',
        },
      },
    },
  },
  openai: {
    id: 'openai',
    label: 'OpenAI',
    description: 'Paid, reliable, and the most predictable tool calling.',
    config: {
      model: 'openai/gpt-4.1-mini',
      providers: {
        openai: {
          type: 'openai-compatible',
          apiKey: '${env:OPENAI_API_KEY}',
        },
      },
    },
  },
  anthropic: {
    id: 'anthropic',
    label: 'Anthropic (Claude)',
    description: 'Native tool use via the Anthropic API. Paid.',
    config: {
      model: 'anthropic/claude-sonnet-4-5',
      providers: {
        anthropic: {
          type: 'anthropic',
          apiKey: '${env:ANTHROPIC_API_KEY}',
        },
      },
    },
  },
  local: {
    id: 'local',
    label: 'Local model (LM Studio / vLLM)',
    description:
      'Truly unlimited: runs on your machine. Start an OpenAI-compatible server on localhost:1234.',
    config: {
      model: 'local/qwen2.5-coder-7b-instruct',
      providers: {
        local: {
          type: 'openai-compatible',
          baseURL: 'http://localhost:1234/v1',
        },
      },
    },
  },
}

export function getPreset(id: string): ProviderPreset | undefined {
  return PRESETS[id]
}

export function presetIds(): string[] {
  return Object.keys(PRESETS)
}
