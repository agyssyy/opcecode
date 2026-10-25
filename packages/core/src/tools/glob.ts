import { IgnoreMatcher } from '../gitignore.js'
import { matchGlob } from '../patterns.js'
import { walkFiles } from '../search.js'
import { resolveWorkspacePath } from './path.js'
import {
  optionalInteger,
  optionalString,
  requireString,
  type ToolDefinition,
  truncateText,
} from './types.js'

const MAX_OUTPUT_CHARS = 20_000

export const globTool: ToolDefinition = {
  name: 'glob',
  description:
    'Find files by glob pattern, e.g. "src/**/*.ts" or "*.md". Patterns match paths relative to the search path (or the workspace root by default); a pattern without / matches at any depth. Results are newest first. Respects .gitignore.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Glob pattern, e.g. "**/*.test.ts".' },
      path: {
        type: 'string',
        description: 'Optional subdirectory to search in, relative to the workspace root.',
      },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 1000,
        description: 'Maximum number of results. Defaults to 100.',
      },
    },
    required: ['pattern'],
    additionalProperties: false,
  },
  risk: 'low',
  subject(args) {
    return typeof args.pattern === 'string' ? args.pattern : '(missing pattern)'
  },
  async execute(args, context) {
    const pattern = requireString(args, 'pattern').trim()
    const limit = Math.min(optionalInteger(args, 'limit') ?? 100, 1000)
    const input = optionalString(args, 'path') ?? '.'

    const resolved = resolveWorkspacePath(context.cwd, input, { allowRoot: true })
    const start = resolved.relative === '.' ? '' : resolved.relative

    const ignore = new IgnoreMatcher(context.cwd)
    const entries = walkFiles({
      root: context.cwd,
      start,
      ignore,
      maxEntries: 50_000,
      signal: context.signal,
    })

    const matches = entries
      .filter((entry) => {
        if (matchGlob(pattern, entry.relative)) return true
        if (start !== '' && entry.relative.startsWith(`${start}/`)) {
          return matchGlob(pattern, entry.relative.slice(start.length + 1))
        }
        return false
      })
      .sort((a, b) => b.mtimeMs - a.mtimeMs)

    if (matches.length === 0) {
      return { output: `No files match "${pattern}".` }
    }

    const shown = matches.slice(0, limit)
    const suffix =
      matches.length > shown.length
        ? `\n… ${matches.length - shown.length} more matches (showing ${shown.length})`
        : ''
    return {
      output: truncateText(
        `${shown.map((entry) => entry.relative).join('\n')}${suffix}`,
        MAX_OUTPUT_CHARS,
      ),
    }
  },
}
