import { readFileSync, statSync } from 'node:fs'
import { resolveWorkspacePath } from './path.js'
import {
  optionalInteger,
  requireString,
  type ToolDefinition,
  ToolError,
  truncateText,
} from './types.js'

const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_OUTPUT_CHARS = 20_000

export const readTool: ToolDefinition = {
  name: 'read',
  description:
    'Read a UTF-8 text file from the workspace. Returns numbered lines. Use offset and limit for large files.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace root.' },
      offset: {
        type: 'integer',
        minimum: 1,
        description: 'First line to return (1-based). Defaults to 1.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 2000,
        description: 'Maximum number of lines to return. Defaults to the configured read limit.',
      },
    },
    required: ['path'],
    additionalProperties: false,
  },
  risk: 'low',
  subject(args) {
    return typeof args.path === 'string' ? args.path : '(missing path)'
  },
  async execute(args, context) {
    const input = requireString(args, 'path')
    const resolved = resolveWorkspacePath(context.cwd, input)

    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(resolved.absolute)
    } catch {
      throw new ToolError(`File not found: ${resolved.relative}`)
    }
    if (stats.isDirectory()) {
      throw new ToolError(`Path is a directory: ${resolved.relative}`)
    }
    if (!stats.isFile()) {
      throw new ToolError(`Path is not a regular file: ${resolved.relative}`)
    }
    if (stats.size > MAX_FILE_BYTES) {
      throw new ToolError(
        `File is too large (${Math.ceil(stats.size / 1024)} KiB). Maximum is ${MAX_FILE_BYTES / 1024} KiB.`,
      )
    }

    const content = readFileSync(resolved.absolute, 'utf8')
    if (content.includes('\u0000')) {
      throw new ToolError(`Refusing to read binary file: ${resolved.relative}`)
    }

    const lines = content.split('\n')
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()

    const offset = optionalInteger(args, 'offset') ?? 1
    const limit = Math.min(optionalInteger(args, 'limit') ?? context.readLimit, 2000)
    if (offset > lines.length && lines.length > 0) {
      throw new ToolError(
        `Offset ${offset} is past the end of ${resolved.relative} (${lines.length} lines).`,
      )
    }

    const slice = lines.slice(offset - 1, offset - 1 + limit)
    if (slice.length === 0) return { output: `(empty file) ${resolved.relative}` }

    const numbered = slice
      .map(
        (line, index) => `${String(offset + index).padStart(5, ' ')}\t${line.replace(/\r$/, '')}`,
      )
      .join('\n')

    const suffix =
      offset - 1 + slice.length < lines.length
        ? `\n… ${lines.length - (offset - 1 + slice.length)} more lines; use offset=${offset + slice.length}`
        : ''

    return {
      output: truncateText(`${numbered}${suffix}`, MAX_OUTPUT_CHARS),
    }
  },
}
