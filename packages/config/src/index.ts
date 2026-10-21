export { DEFAULT_CONFIG } from './defaults.js'
export { interpolateEnv } from './env.js'
export { ConfigError } from './errors.js'
export { configHome, type LoadConfigOptions, loadConfig } from './loader.js'
export { mergeConfig } from './merge.js'
export { type ParseResult, parseConfig } from './parse.js'
export { getPreset, PRESETS, type ProviderPreset, presetIds } from './presets.js'
export {
  expectedApiKeyEnv,
  isLocalBaseURL,
  parseModelReference,
  resolveApiKey,
  resolveModel,
} from './providers.js'
export type {
  ApiKeyResult,
  ApiKeyStatus,
  ConfigPatch,
  ConfigSource,
  ConfigSourceKind,
  ContextConfig,
  LoadedConfig,
  ModelReference,
  ModelSelection,
  OpceCodeConfig,
  PermissionDecision,
  PermissionRule,
  ProviderConfig,
  ProviderPatch,
  ProviderType,
} from './types.js'
