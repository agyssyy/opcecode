import { ConfigError } from './errors.js'
import type {
  ConfigPatch,
  ContextConfig,
  PermissionDecision,
  PermissionRule,
  ProviderPatch,
  ProviderType,
} from './types.js'

const PROVIDER_TYPES: ReadonlySet<string> = new Set(['openai-compatible', 'anthropic', 'google'])
const DECISIONS: ReadonlySet<string> = new Set(['allow', 'ask', 'deny'])

const TOP_LEVEL_KEYS = new Set([
  '$schema',
  'model',
  'providers',
  'permissions',
  'context',
  'projectInstructions',
])
const PROVIDER_KEYS = new Set(['type', 'baseURL', 'apiKey', 'headers', 'models'])
const PERMISSION_KEYS = new Set(['tool', 'pattern', 'decision'])
const CONTEXT_KEYS = new Set(['maxSteps', 'readLimit', 'bashTimeoutMs', 'maxContextTokens'])

export interface ParseResult {
  value: ConfigPatch
  warnings: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'an array'
  return typeof value
}

function expectRecord(value: unknown, file: string, path: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ConfigError(`"${path}" must be an object, got ${describe(value)}`, file)
  }
  return value
}

function expectString(value: unknown, file: string, path: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigError(`"${path}" must be a non-empty string, got ${describe(value)}`, file)
  }
  return value
}

function expectStringArray(value: unknown, file: string, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new ConfigError(`"${path}" must be an array of strings, got ${describe(value)}`, file)
  }
  return value.map((item, index) => expectString(item, file, `${path}[${index}]`))
}

function expectPositiveInteger(value: unknown, file: string, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ConfigError(`"${path}" must be a positive integer, got ${describe(value)}`, file)
  }
  return value
}

function warnUnknownKeys(
  record: Record<string, unknown>,
  known: ReadonlySet<string>,
  file: string,
  path: string,
  warnings: string[],
): void {
  for (const key of Object.keys(record)) {
    if (!known.has(key)) {
      const prefix = path ? `${path}.` : ''
      warnings.push(`Unknown key "${prefix}${key}" in ${file}`)
    }
  }
}

function parseProvider(
  raw: unknown,
  file: string,
  path: string,
  warnings: string[],
): ProviderPatch {
  const record = expectRecord(raw, file, path)
  warnUnknownKeys(record, PROVIDER_KEYS, file, path, warnings)

  const provider: ProviderPatch = {}

  if (record.type !== undefined) {
    const type = expectString(record.type, file, `${path}.type`)
    if (!PROVIDER_TYPES.has(type)) {
      throw new ConfigError(
        `"${path}.type" must be one of ${[...PROVIDER_TYPES].join(', ')}, got "${type}"`,
        file,
      )
    }
    provider.type = type as ProviderType
  }

  if (record.baseURL !== undefined) {
    const baseURL = expectString(record.baseURL, file, `${path}.baseURL`)
    try {
      const url = new URL(baseURL)
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('unsupported protocol')
      }
    } catch {
      throw new ConfigError(`"${path}.baseURL" must be an http(s) URL, got "${baseURL}"`, file)
    }
    provider.baseURL = baseURL
  }

  if (record.apiKey !== undefined) {
    provider.apiKey = expectString(record.apiKey, file, `${path}.apiKey`)
  }

  if (record.headers !== undefined) {
    const headers = expectRecord(record.headers, file, `${path}.headers`)
    provider.headers = {}
    for (const [name, value] of Object.entries(headers)) {
      provider.headers[name] = expectString(value, file, `${path}.headers.${name}`)
    }
  }

  if (record.models !== undefined) {
    provider.models = expectStringArray(record.models, file, `${path}.models`)
  }

  return provider
}

function parsePermission(
  raw: unknown,
  file: string,
  path: string,
  warnings: string[],
): PermissionRule {
  const record = expectRecord(raw, file, path)
  warnUnknownKeys(record, PERMISSION_KEYS, file, path, warnings)

  if (record.tool === undefined) {
    throw new ConfigError(`"${path}.tool" is required`, file)
  }
  if (record.decision === undefined) {
    throw new ConfigError(`"${path}.decision" is required`, file)
  }

  const tool = expectString(record.tool, file, `${path}.tool`)
  const decision = expectString(record.decision, file, `${path}.decision`)
  if (!DECISIONS.has(decision)) {
    throw new ConfigError(
      `"${path}.decision" must be one of ${[...DECISIONS].join(', ')}, got "${decision}"`,
      file,
    )
  }

  const rule: PermissionRule = { tool, decision: decision as PermissionDecision }
  if (record.pattern !== undefined) {
    rule.pattern = expectString(record.pattern, file, `${path}.pattern`)
  }
  return rule
}

function parseContext(
  raw: unknown,
  file: string,
  path: string,
  warnings: string[],
): Partial<ContextConfig> {
  const record = expectRecord(raw, file, path)
  warnUnknownKeys(record, CONTEXT_KEYS, file, path, warnings)

  const context: Partial<ContextConfig> = {}
  if (record.maxSteps !== undefined) {
    context.maxSteps = expectPositiveInteger(record.maxSteps, file, `${path}.maxSteps`)
  }
  if (record.readLimit !== undefined) {
    context.readLimit = expectPositiveInteger(record.readLimit, file, `${path}.readLimit`)
  }
  if (record.bashTimeoutMs !== undefined) {
    context.bashTimeoutMs = expectPositiveInteger(
      record.bashTimeoutMs,
      file,
      `${path}.bashTimeoutMs`,
    )
  }
  if (record.maxContextTokens !== undefined) {
    context.maxContextTokens = expectPositiveInteger(
      record.maxContextTokens,
      file,
      `${path}.maxContextTokens`,
    )
  }
  return context
}

/**
 * Validate a parsed JSON document and keep only known keys. Unknown keys are
 * warnings, not errors, so new config fields remain forward-compatible.
 */
export function parseConfig(raw: unknown, file: string): ParseResult {
  const record = expectRecord(raw, file, '<root>')
  const warnings: string[] = []
  warnUnknownKeys(record, TOP_LEVEL_KEYS, file, '', warnings)

  const value: ConfigPatch = {}

  if (record.model !== undefined) {
    value.model = expectString(record.model, file, 'model')
  }

  if (record.providers !== undefined) {
    const providers = expectRecord(record.providers, file, 'providers')
    const parsed: Record<string, ProviderPatch> = {}
    for (const [id, provider] of Object.entries(providers)) {
      if (id.trim() === '') {
        throw new ConfigError('provider names must not be empty', file)
      }
      parsed[id] = parseProvider(provider, file, `providers.${id}`, warnings)
    }
    value.providers = parsed
  }

  if (record.permissions !== undefined) {
    if (!Array.isArray(record.permissions)) {
      throw new ConfigError(
        `"permissions" must be an array, got ${describe(record.permissions)}`,
        file,
      )
    }
    value.permissions = record.permissions.map((rule, index) =>
      parsePermission(rule, file, `permissions[${index}]`, warnings),
    )
  }

  if (record.context !== undefined) {
    value.context = parseContext(record.context, file, 'context', warnings)
  }

  if (record.projectInstructions !== undefined) {
    value.projectInstructions = expectStringArray(
      record.projectInstructions,
      file,
      'projectInstructions',
    )
  }

  return { value, warnings }
}
