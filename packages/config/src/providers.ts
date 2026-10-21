import type { ApiKeyResult, ModelReference, ModelSelection, OpceCodeConfig } from './types.js'

const PROVIDER_KEY_ENV: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  openrouter: ['OPENROUTER_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  groq: ['GROQ_API_KEY'],
  google: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
  local: [],
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'])

/** Split `provider/model` on the first slash. Model IDs may contain slashes. */
export function parseModelReference(model: string): ModelReference | null {
  const trimmed = model.trim()
  const separator = trimmed.indexOf('/')
  if (separator <= 0 || separator === trimmed.length - 1) return null
  return {
    providerID: trimmed.slice(0, separator),
    modelID: trimmed.slice(separator + 1),
  }
}

export function resolveModel(config: OpceCodeConfig): ModelSelection | null {
  const reference = parseModelReference(config.model)
  if (!reference) return null
  const provider = config.providers[reference.providerID]
  if (!provider) return null
  return { ...reference, provider }
}

export function isLocalBaseURL(baseURL: string | undefined): boolean {
  if (!baseURL) return false
  try {
    return LOCAL_HOSTS.has(new URL(baseURL).hostname)
  } catch {
    return false
  }
}

export function resolveApiKey(
  providerID: string,
  provider: { apiKey?: string; baseURL?: string; type: string },
  env: NodeJS.ProcessEnv,
): ApiKeyResult {
  if (provider.apiKey && provider.apiKey.trim() !== '') {
    return { status: 'present', source: 'config' }
  }

  if (isLocalBaseURL(provider.baseURL)) {
    return { status: 'not-required' }
  }

  const candidates =
    PROVIDER_KEY_ENV[providerID] ??
    (provider.type === 'anthropic'
      ? ['ANTHROPIC_API_KEY']
      : provider.type === 'google'
        ? ['GEMINI_API_KEY', 'GOOGLE_API_KEY']
        : ['OPENAI_API_KEY'])

  for (const envVar of candidates) {
    if (env[envVar] && env[envVar]?.trim() !== '') {
      return { status: 'present', source: 'env', envVar }
    }
  }

  return { status: 'missing', envVar: candidates[0] }
}

export function expectedApiKeyEnv(providerID: string, type: string): string | undefined {
  return (
    PROVIDER_KEY_ENV[providerID]?.[0] ?? (type === 'anthropic' ? 'ANTHROPIC_API_KEY' : undefined)
  )
}
