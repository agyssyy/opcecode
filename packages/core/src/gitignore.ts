import { readFileSync } from 'node:fs'
import { join } from 'node:path'

interface IgnoreRule {
  /** Directory of the .gitignore relative to the root ('' for the root itself). */
  base: string
  regex: RegExp
  negated: boolean
  dirOnly: boolean
}

function escapeRegexChar(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char
}

/** Translate one gitignore pattern (no comments, no negation) into a regex body. */
function patternBody(pattern: string): string {
  let out = ''
  let index = 0
  while (index < pattern.length) {
    const char = pattern[index]
    if (char === '*') {
      const precededByBoundary = index === 0 || pattern[index - 1] === '/'
      if (precededByBoundary && pattern[index + 1] === '*') {
        if (pattern[index + 2] === '/') {
          out += '(?:.*/)?'
          index += 3
          continue
        }
        if (pattern[index + 2] === undefined) {
          out += '.*'
          index += 2
          continue
        }
      }
      out += '[^/]*'
      index += 1
      continue
    }
    if (char === '?') {
      out += '[^/]'
      index += 1
      continue
    }
    out += escapeRegexChar(char as string)
    index += 1
  }
  return out
}

export interface GitignorePattern {
  regex: RegExp
  negated: boolean
  dirOnly: boolean
}

/** Parse a single .gitignore pattern line. Returns null for blank/comment lines. */
export function parseGitignorePattern(line: string): GitignorePattern | null {
  let pattern = line
  if (pattern.trim() === '') return null
  if (pattern.startsWith('#')) return null
  if (pattern.startsWith('\\#')) pattern = pattern.slice(1)

  let negated = false
  if (pattern.startsWith('!')) {
    negated = true
    pattern = pattern.slice(1)
  }
  if (pattern === '') return null

  // Unescaped trailing spaces are ignored by git.
  pattern = pattern.replace(/(?<!\\)\s+$/, '')
  if (pattern === '') return null

  let dirOnly = false
  if (pattern.endsWith('/')) {
    dirOnly = true
    pattern = pattern.slice(0, -1)
  }

  let anchored = pattern.startsWith('/')
  if (anchored) pattern = pattern.slice(1)
  if (pattern.includes('/')) anchored = true
  if (pattern === '') return null

  const body = patternBody(pattern)
  const source = anchored ? `^${body}$` : `^(?:.*/)?${body}$`
  return { regex: new RegExp(source), negated, dirOnly }
}

/**
 * Lazy .gitignore matcher. Rules are loaded per directory during traversal;
 * deeper files are appended later and therefore win, matching git's
 * "last matching pattern decides" behavior.
 */
export class IgnoreMatcher {
  private readonly root: string
  private readonly rules: IgnoreRule[] = []
  private readonly loaded = new Set<string>()

  constructor(root: string) {
    this.root = root
  }

  /** Load `<root>/<dir>/.gitignore` once. `dir` is '' for the root. */
  loadDirectory(dir: string): void {
    if (this.loaded.has(dir)) return
    this.loaded.add(dir)

    let text: string
    try {
      text = readFileSync(join(this.root, dir, '.gitignore'), 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }

    for (const line of text.split(/\r?\n/)) {
      const parsed = parseGitignorePattern(line)
      if (!parsed) continue
      this.rules.push({ base: dir, ...parsed })
    }
  }

  /** Whether a root-relative path (forward slashes) is ignored. */
  ignores(relativePath: string, isDir: boolean): boolean {
    const path = relativePath.replaceAll('\\', '/').replace(/^\.\//, '')
    if (path === '') return false

    let ignored = false
    for (const rule of this.rules) {
      if (rule.base !== '' && !path.startsWith(`${rule.base}/`)) continue
      const sub = rule.base === '' ? path : path.slice(rule.base.length + 1)
      if (rule.dirOnly && !isDir) continue
      if (rule.regex.test(sub)) ignored = !rule.negated
    }
    return ignored
  }
}
