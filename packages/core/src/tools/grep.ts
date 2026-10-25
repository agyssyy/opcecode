import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { IgnoreMatcher } from '../gitignore.js'
import { matchGlob } from '../patterns.js'
import { walkFiles } from '../search.js'
import { resolveWorkspacePath } from './path.js'
import {
  optionalBoolean,
  optionalInteger,
  optionalString,
  requireString,
  type ToolDefinition,
  ToolError,
  truncateText,
} from './types.js'

const MAX_OUTPUT_CHARS = 20_000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_LINE_CHARS = 300

function looksBinary(absolute: string): boolean {
  let fd: number | undefined
  try {
    fd = openSync(absolute, 'r')
    const buffer = Buffer.alloc(8192)
    const read = readSync(fd, buffer, 0, buffer.length, 0)
    return buffer.subarray(0, read).includes(0)
  } catch {
    return true
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

interface Match {
  path: string
  line: number
  text: string
}

export const grepTool: ToolDefinition = {
  name: 'grep',
  description:
    'Search file contents with a JavaScript regular expression. Returns file:line: text matches. Respects .gitignore. Use include to filter files by glob.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Regular expression to search for.' },
      path: {
        type: 'string',
        description:
          'File or directory to search, relative to the workspace root. Defaults to the root.',
      },
      include: {
        type: 'string',
        description: 'Only search files matching this glob, e.g. "*.ts".',
      },
      ignoreCase: { type: 'boolean', description: 'Case-insensitive search. Defaults to false.' },
      limit: {
        type: 'integer',
        minimum: 1,
        maximum: 1000,
        description: 'Maximum matches to return. Defaults to 200.',
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
    const pattern = requireString(args, 'pattern')
    const ignoreCase = optionalBoolean(args, 'ignoreCase') ?? false
    const limit = Math.min(optionalInteger(args, 'limit') ?? 200, 1000)
    const include = optionalString(args, 'include')
    const input = optionalString(args, 'path') ?? '.'

    let regex: RegExp
    try {
      regex = new RegExp(pattern, ignoreCase ? 'i' : '')
    } catch (error) {
      throw new ToolError(
        `Invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
      )
    }

    const resolved = resolveWorkspacePath(context.cwd, input, { allowRoot: true })

    let files: Array<{ relative: string; absolute: string }>
    let stats: ReturnType<typeof statSync>
    try {
      stats = statSync(resolved.absolute)
    } catch {
      throw new ToolError(`Path not found: ${input}`)
    }
    if (stats.isDirectory()) {
      const ignore = new IgnoreMatcher(context.cwd)
      const start = resolved.relative === '.' ? '' : resolved.relative
      files = walkFiles({
        root: context.cwd,
        start,
        ignore,
        maxEntries: 20_000,
        signal: context.signal,
      }).map((entry) => ({ relative: entry.relative, absolute: entry.absolute }))
    } else {
      files = [{ relative: resolved.relative, absolute: resolved.absolute }]
    }

    if (include !== undefined && include.trim() !== '') {
      const includeGlob = include.trim()
      const start = resolved.relative === '.' ? '' : resolved.relative
      files = files.filter((file) => {
        if (matchGlob(includeGlob, file.relative)) return true
        if (start !== '' && file.relative.startsWith(`${start}/`)) {
          return matchGlob(includeGlob, file.relative.slice(start.length + 1))
        }
        return false
      })
    }

    const matches: Match[] = []
    let truncatedAtLimit = false

    for (const file of files) {
      if (context.signal.aborted) break
      let fileStats: ReturnType<typeof statSync>
      try {
        fileStats = statSync(file.absolute)
      } catch {
        continue
      }
      if (!fileStats.isFile() || fileStats.size > MAX_FILE_BYTES) continue
      if (looksBinary(file.absolute)) continue

      let content: string
      try {
        content = readFileSync(file.absolute, 'utf8')
      } catch {
        continue
      }

      const lines = content.split('\n')
      for (let index = 0; index < lines.length; index += 1) {
        let line = lines[index] ?? ''
        if (line.endsWith('\r')) line = line.slice(0, -1)
        if (!regex.test(line)) continue
        matches.push({
          path: file.relative,
          line: index + 1,
          text: line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line,
        })
        if (matches.length >= limit) {
          truncatedAtLimit = true
          break
        }
      }
      if (truncatedAtLimit) break
    }

    if (matches.length === 0) {
      return { output: `No matches for /${pattern}/ in ${input}.` }
    }

    const body = matches.map((match) => `${match.path}:${match.line}: ${match.text}`).join('\n')
    const note = truncatedAtLimit ? `\n… stopped at the ${limit}-match limit` : ''
    const summary = `\n(${matches.length} matches in ${input})`
    return { output: truncateText(`${body}${note}${summary}`, MAX_OUTPUT_CHARS) }
  },
}
