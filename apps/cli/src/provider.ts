import { type ModelSelection, resolveApiKey } from '@opcecode/config'
import {
  createAnthropicProvider,
  createOpenAICompatibleProvider,
  type Provider,
  ProviderError,
} from '@opcecode/core'

/**
 * Build a provider for the configured model. Local endpoints need no key;
 * remote providers fail fast with a message that names the missing variable.
 */
export function createProviderForSelection(
  selection: ModelSelection,
  env: NodeJS.ProcessEnv,
): Provider {
  const type = selection.provider.type
  if (type !== 'openai-compatible' && type !== 'anthropic') {
    throw new ProviderError(
      `Provider type "${type}" is not supported yet. Use an OpenAI-compatible provider or a Claude model via the anthropic type.`,
    )
  }

  const key = resolveApiKey(selection.providerID, selection.provider, env)
  if (key.status === 'missing') {
    const variable = key.envVar ?? 'the provider API key'
    throw new ProviderError(
      `No API key for provider "${selection.providerID}". Set ${variable}, or run \`opcecode init\` to reconfigure.`,
    )
  }

  let apiKey: string | undefined
  if (key.status === 'present') {
    apiKey = key.source === 'config' ? selection.provider.apiKey : undefined
    if (key.envVar) apiKey = env[key.envVar]
  }

  if (type === 'anthropic') {
    if (!apiKey) {
      throw new ProviderError(
        `No API key for provider "${selection.providerID}". Set ANTHROPIC_API_KEY, or run \`opcecode init\` to reconfigure.`,
      )
    }
    return createAnthropicProvider({
      id: selection.providerID,
      apiKey,
      ...(selection.provider.baseURL ? { baseURL: selection.provider.baseURL } : {}),
      ...(selection.provider.headers ? { headers: selection.provider.headers } : {}),
    })
  }

  return createOpenAICompatibleProvider({
    id: selection.providerID,
    ...(selection.provider.baseURL ? { baseURL: selection.provider.baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(selection.provider.headers ? { headers: selection.provider.headers } : {}),
  })
}
