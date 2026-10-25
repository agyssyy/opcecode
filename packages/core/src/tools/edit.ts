import { readFileSync, statSync } from 'node:fs'
import { atomicWriteFile } from './fsx.js'
import { resolveWorkspacePath } from './path.js'
import { optionalBoolean, requireString, type ToolDefinition, ToolError } from './types.js'

const MAX_FILE_BYTES = 10 * 1024 * 1024

export const editTool: ToolDefinition = {
  name: 'edit',
  description:
    'Replace an exact text snippet in a workspace file. The old text must match the file exactly, including whitespace, and must be unique unless replaceAll is true. Read the file first.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace root.' },
      oldString: { type: 'string', description: 'Exact existing text to replace.' },
      newString: { type: 'string', description: 'Replacement text. Empty deletes the snippet.' },
      replaceAll: {
        type: 'boolean',
        description: 'Replace every occurrence instead of requiring a unique match.',
      },
    },
    required: ['path', 'oldString', 'newString'],
    additionalProperties: false,
  },
  risk: 'medium',
  subject(args) {
    return typeof args.path === 'string' ? args.path : '(missing path)'
  },
  async execute(args, context) {
    const input = requireString(args, 'path')
    const oldString = requireString(args, 'oldString')
    const newString = args.newString
    if (typeof newString !== 'string') {
      throw new ToolError('Missing or invalid "newString" argument: expected a string.')
    }
    const replaceAll = optionalBoolean(args, 'replaceAll') ?? false

    const resolved = resolveWorkspacePath(context.cwd, input)

    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(resolved.absolute)
    } catch {
      throw new ToolError(`File not found: ${resolved.relative}. Use write to create new files.`)
    }
    if (stats.isDirectory()) throw new ToolError(`Path is a directory: ${resolved.relative}`)
    if (stats.size > MAX_FILE_BYTES) {
      throw new ToolError(`File is too large to edit: ${resolved.relative}`)
    }

    const content = readFileSync(resolved.absolute, 'utf8')
    if (oldString === newString) return { output: `No changes: ${resolved.relative}` }

    const firstIndex = content.indexOf(oldString)
    if (firstIndex === -1) {
      throw new ToolError(
        `oldString not found in ${resolved.relative}. Read the file again: the text must match exactly, including whitespace, without line-number prefixes.`,
      )
    }

    let count = 0
    let cursor = firstIndex
    while (cursor !== -1) {
      count += 1
      cursor = content.indexOf(oldString, cursor + oldString.length)
    }

    if (count > 1 && !replaceAll) {
      throw new ToolError(
        `oldString matches ${count} times in ${resolved.relative}. Include more surrounding context to make it unique, or set replaceAll=true.`,
      )
    }

    const updated = replaceAll
      ? content.split(oldString).join(newString)
      : content.slice(0, firstIndex) + newString + content.slice(firstIndex + oldString.length)

    const line = content.slice(0, firstIndex).split('\n').length
    atomicWriteFile(resolved.absolute, updated)

    const plural = count === 1 ? '' : 's'
    return {
      output: `Edited ${resolved.relative} (${count} replacement${plural}, first at line ${line}).`,
    }
  },
}
