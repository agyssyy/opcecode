import { bashTool, detectShell, runCommand, scrubEnv } from './bash.js'
import { editTool } from './edit.js'
import { globTool } from './glob.js'
import { grepTool } from './grep.js'
import { listTool } from './list.js'
import { readTool } from './read.js'
import { todoTool } from './todo.js'
import type { ToolDefinition } from './types.js'
import { writeTool } from './write.js'

export const BUILTIN_TOOLS: ToolDefinition[] = [
  readTool,
  listTool,
  globTool,
  grepTool,
  editTool,
  writeTool,
  bashTool,
  todoTool,
]

export function getTool(name: string): ToolDefinition | undefined {
  return BUILTIN_TOOLS.find((tool) => tool.name === name)
}

export { atomicWriteFile } from './fsx.js'
export { type ResolveOptions, resolveWorkspacePath } from './path.js'
export {
  optionalBoolean,
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
export {
  bashTool,
  detectShell,
  editTool,
  globTool,
  grepTool,
  listTool,
  readTool,
  runCommand,
  scrubEnv,
  todoTool,
  writeTool,
}
