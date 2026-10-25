import { readFileSync, statSync } from 'node:fs'
import { atomicWriteFile } from './fsx.js'
import { resolveWorkspacePath } from './path.js'
import { requireString, type ToolDefinition, ToolError } from './types.js'

function existingText(path: string): string | undefined {
  try {
    const stats = statSync(path)
    if (stats.isDirectory()) throw new ToolError(`Path is a directory: ${path}`)
    if (stats.size > 10 * 1024 * 1024) return undefined
    return readFileSync(path, 'utf8')
  } catch (error) {
    if (error instanceof ToolError) throw error
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

export const writeTool: ToolDefinition = {
  name: 'write',
  description:
    'Write a complete UTF-8 text file in the workspace. Creates parent directories and overwrites existing files. Read before editing when possible.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace root.' },
      content: { type: 'string', description: 'Complete new contents of the file.' },
    },
    required: ['path', 'content'],
    additionalProperties: false,
  },
  risk: 'medium',
  subject(args) {
    return typeof args.path === 'string' ? args.path : '(missing path)'
  },
  async execute(args, context) {
    const input = requireString(args, 'path')
    const content = args.content
    if (typeof content !== 'string') {
      throw new ToolError('Missing or invalid "content" argument: expected a string.')
    }

    const resolved = resolveWorkspacePath(context.cwd, input)
    const before = existingText(resolved.absolute)
    const existed = before !== undefined

    if (existed && before === content) {
      return { output: `No changes: ${resolved.relative}` }
    }

    atomicWriteFile(resolved.absolute, content)

    const bytes = Buffer.byteLength(content, 'utf8')
    return {
      output: `${existed ? 'Overwrote' : 'Created'} ${resolved.relative} (${bytes} bytes).`,
    }
  },
}
