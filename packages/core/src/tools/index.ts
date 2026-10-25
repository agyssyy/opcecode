import { bashTool, detectShell, runCommand, scrubEnv } from './bash.js'
import { readTool } from './read.js'
import type { ToolDefinition } from './types.js'
import { writeTool } from './write.js'

export const BUILTIN_TOOLS: ToolDefinition[] = [readTool, writeTool, bashTool]

export function getTool(name: string): ToolDefinition | undefined {
  return BUILTIN_TOOLS.find((tool) => tool.name === name)
}

export { resolveWorkspacePath } from './path.js'
export {
  optionalInteger,
  optionalString,
  requireString,
  ToolAbortError,
  type ToolContext,
  type ToolDefinition,
  ToolError,
  type ToolResult,
  truncateText,
} from './types.js'
export { bashTool, detectShell, readTool, runCommand, scrubEnv, writeTool }
