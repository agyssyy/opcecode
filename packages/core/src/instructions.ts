import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

const MAX_FILE_CHARS = 12_000
const MAX_TOTAL_CHARS = 32_000

export interface ProjectInstructions {
  /** Merged instruction text, ready for the system prompt. '' when none. */
  text: string
  /** Workspace-relative files that contributed, in load order. */
  files: string[]
}

function readIfFile(path: string): string | undefined {
  try {
    const stats = statSync(path)
    if (!stats.isFile() || stats.size > MAX_FILE_CHARS * 4) return undefined
    const content = readFileSync(path, 'utf8')
    if (content.includes('\u0000')) return undefined
    return content.length > MAX_FILE_CHARS
      ? `${content.slice(0, MAX_FILE_CHARS)}\n… truncated`
      : content
  } catch {
    return undefined
  }
}

/**
 * Discover project instructions: each configured file name at the workspace
 * root (first found per name), merged with `.opcecode/rules/*.md` sorted by
 * name. Later files append; total size is capped.
 */
export function loadProjectInstructions(cwd: string, filenames: string[]): ProjectInstructions {
  const sections: string[] = []
  const files: string[] = []
  let total = 0

  const add = (relativePath: string, content: string) => {
    if (total >= MAX_TOTAL_CHARS) return
    const room = MAX_TOTAL_CHARS - total
    const body = content.length > room ? `${content.slice(0, room)}\n… truncated` : content
    total += body.length
    files.push(relativePath)
    sections.push(`# ${relativePath}\n\n${body.trim()}`)
  }

  for (const filename of filenames) {
    const trimmed = filename.trim()
    if (trimmed === '' || trimmed.includes('..')) continue
    const content = readIfFile(join(cwd, trimmed))
    if (content !== undefined && content.trim() !== '') add(trimmed, content)
  }

  const rulesDir = join(cwd, '.opcecode', 'rules')
  let ruleNames: string[] = []
  try {
    ruleNames = readdirSync(rulesDir)
      .filter((name) => name.toLowerCase().endsWith('.md'))
      .sort((a, b) => a.localeCompare(b))
  } catch {
    ruleNames = []
  }
  for (const name of ruleNames) {
    const content = readIfFile(join(rulesDir, name))
    if (content !== undefined && content.trim() !== '') {
      add(relative(cwd, join(rulesDir, name)).split(sep).join('/'), content)
    }
  }

  return { text: sections.join('\n\n'), files }
}
