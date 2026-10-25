import { type ModelSelection, resolveApiKey } from '@opcecode/config'
import { createOpenAICompatibleProvider, type Provider, ProviderError } from '@opcecode/core'

/**
 * Build a provider for the configured model. Local endpoints need no key;
 * remote providers fail fast with a message that names the missing variable.
 */
export function createProviderForSelection(
  selection: ModelSelection,
  env: NodeJS.ProcessEnv,
): Provider {
  if (selection.provider.type !== 'openai-compatible') {
    throw new ProviderError(
      `Provider type "${selection.provider.type}" is not supported yet. Use an OpenAI-compatible provider.`,
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

  return createOpenAICompatibleProvider({
    id: selection.providerID,
    ...(selection.provider.baseURL ? { baseURL: selection.provider.baseURL } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(selection.provider.headers ? { headers: selection.provider.headers } : {}),
  })
}
