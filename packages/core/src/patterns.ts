function escapeRegexChar(char: string): string {
  return /[.*+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char
}

function globBody(pattern: string): string {
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

/** Expand simple `{a,b}` alternations, innermost first. */
function expandBraces(pattern: string): string[] {
  const open = pattern.indexOf('{')
  if (open === -1) return [pattern]
  let depth = 0
  for (let index = open; index < pattern.length; index += 1) {
    const char = pattern[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        const before = pattern.slice(0, open)
        const after = pattern.slice(index + 1)
        const options = pattern.slice(open + 1, index).split(',')
        return options.flatMap((option) => expandBraces(`${before}${option}${after}`))
      }
    }
  }
  return [pattern]
}

/**
 * Match a root-relative path against a glob.
 *
 * - `*` matches within one path segment, `**` crosses segments, `?` one char.
 * - A pattern without `/` matches at any depth, so `*.ts` finds `src/a.ts`.
 * - `{js,ts}` alternations and a leading `./` are supported.
 */
export function matchGlob(pattern: string, path: string): boolean {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\//, '')
  for (const expanded of expandBraces(pattern.trim())) {
    let candidate = expanded.replace(/^\.\//, '')
    if (candidate === '') continue
    if (!candidate.includes('/')) candidate = `**/${candidate}`
    const regex = new RegExp(`^${globBody(candidate)}$`)
    if (regex.test(normalized)) return true
  }
  return false
}

/** True when the pattern contains glob metacharacters. */
export function isGlobPattern(pattern: string): boolean {
  return /[*?{}]/.test(pattern)
}
