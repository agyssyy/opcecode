import { statSync } from 'node:fs'
import { IgnoreMatcher } from '../gitignore.js'
import { walkFiles } from '../search.js'
import { resolveWorkspacePath } from './path.js'
import {
  optionalInteger,
  optionalString,
  type ToolDefinition,
  ToolError,
  truncateText,
} from './types.js'

const MAX_ENTRIES = 500
const MAX_OUTPUT_CHARS = 20_000

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export const listTool: ToolDefinition = {
  name: 'list',
  description:
    'List directory entries in the workspace: names, sizes for files, trailing / for directories. Respects .gitignore. Use depth to go deeper.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Directory relative to the workspace root. Defaults to the root.',
      },
      depth: {
        type: 'integer',
        minimum: 1,
        maximum: 4,
        description: 'How many levels to list. Defaults to 1 (direct children).',
      },
    },
    required: [],
    additionalProperties: false,
  },
  risk: 'low',
  subject(args) {
    return typeof args.path === 'string' && args.path !== '' ? args.path : '.'
  },
  async execute(args, context) {
    const input = optionalString(args, 'path') ?? '.'
    const depth = Math.min(optionalInteger(args, 'depth') ?? 1, 4)
    const resolved = resolveWorkspacePath(context.cwd, input, { allowRoot: true })

    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(resolved.absolute)
    } catch {
      throw new ToolError(`Directory not found: ${resolved.relative}`)
    }
    if (!stats.isDirectory()) {
      throw new ToolError(`Not a directory: ${resolved.relative}. Use read for files.`)
    }

    const start = resolved.relative === '.' ? '' : resolved.relative
    const startDepth = start === '' ? 0 : start.split('/').length
    const ignore = new IgnoreMatcher(context.cwd)
    const entries = walkFiles({
      root: context.cwd,
      start,
      ignore,
      includeDirectories: true,
      maxEntries: 5000,
      signal: context.signal,
    })

    const visible = entries
      .filter((entry) => entry.relative.split('/').length - startDepth <= depth)
      .slice(0, MAX_ENTRIES)

    if (visible.length === 0) {
      return { output: `(empty) ${resolved.relative}/` }
    }

    const lines = visible.map((entry) => {
      const level = entry.relative.split('/').length - startDepth
      const indent = '  '.repeat(Math.max(level - 1, 0))
      const label = entry.relative.split('/').pop() ?? entry.relative
      return entry.isDirectory
        ? `${indent}${label}/`
        : `${indent}${label}  ${formatSize(entry.size)}`
    })

    const hidden = entries.length > visible.length
    const suffix = hidden
      ? `\n… ${entries.length - visible.length} more entries; use depth or a subdirectory`
      : ''
    return {
      output: truncateText(`${resolved.relative}/\n${lines.join('\n')}${suffix}`, MAX_OUTPUT_CHARS),
    }
  },
}
