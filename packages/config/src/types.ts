export type PermissionDecision = 'allow' | 'ask' | 'deny'

export type ProviderType = 'openai-compatible' | 'anthropic' | 'google'

export interface ProviderConfig {
  type: ProviderType
  baseURL?: string
  apiKey?: string
  headers?: Record<string, string>
  models?: string[]
}

/** A provider entry from one config layer; `type` may come from another layer. */
export type ProviderPatch = Omit<ProviderConfig, 'type'> & { type?: ProviderType }

export interface PermissionRule {
  tool: string
  pattern?: string
  decision: PermissionDecision
}

export interface ContextConfig {
  maxSteps: number
  readLimit: number
  bashTimeoutMs: number
  /** Estimated transcript tokens before oldest turns are compacted. */
  maxContextTokens: number
}

export interface OpceCodeConfig {
  model: string
  providers: Record<string, ProviderConfig>
  permissions: PermissionRule[]
  context: ContextConfig
  projectInstructions: string[]
}

/** A partial config where context may itself be partial. */
export type ConfigPatch = Omit<Partial<OpceCodeConfig>, 'context' | 'providers'> & {
  context?: Partial<ContextConfig>
  providers?: Record<string, ProviderPatch>
}

export type ConfigSourceKind = 'global' | 'project' | 'env' | 'cli'

export interface ConfigSource {
  path: string
  kind: ConfigSourceKind
  found: boolean
}

export interface LoadedConfig {
  config: OpceCodeConfig
  sources: ConfigSource[]
  warnings: string[]
}

export interface ModelReference {
  providerID: string
  modelID: string
}

export interface ModelSelection extends ModelReference {
  provider: ProviderConfig
}

export type ApiKeyStatus = 'present' | 'missing' | 'not-required'

export interface ApiKeyResult {
  status: ApiKeyStatus
  source?: 'config' | 'env'
  envVar?: string
}
