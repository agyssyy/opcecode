import { ConfigError } from './errors.js'
import type { ConfigPatch, OpceCodeConfig, ProviderConfig, ProviderPatch } from './types.js'

function mergeProviders(
  base: Record<string, ProviderConfig>,
  patch: Record<string, ProviderPatch>,
): Record<string, ProviderConfig> {
  const merged: Record<string, ProviderConfig> = { ...base }
  for (const [id, provider] of Object.entries(patch)) {
    const existing = merged[id]
    const next = existing ? { ...existing, ...provider } : { ...provider }
    if (!next.type) {
      throw new ConfigError(`provider "${id}" is missing "type"`)
    }
    merged[id] = next as ProviderConfig
  }
  return merged
}

/**
 * Merge a partial config over a complete one.
 *
 * Objects (providers, context) merge field by field. Arrays (permissions,
 * projectInstructions) replace wholesale so a project can opt out of a global
 * rule without guessing indexes.
 */
export function mergeConfig(base: OpceCodeConfig, patch: ConfigPatch): OpceCodeConfig {
  return {
    model: patch.model ?? base.model,
    providers: patch.providers ? mergeProviders(base.providers, patch.providers) : base.providers,
    permissions: patch.permissions ?? base.permissions,
    context: patch.context ? { ...base.context, ...patch.context } : base.context,
    projectInstructions: patch.projectInstructions ?? base.projectInstructions,
  }
}
