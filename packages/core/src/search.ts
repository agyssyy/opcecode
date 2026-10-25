import { type Dirent, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { IgnoreMatcher } from './gitignore.js'

/** Never traversed by search tools, ignored or not. */
const ALWAYS_SKIPPED = new Set(['.git', 'node_modules'])

export interface WalkEntry {
  /** Root-relative path with forward slashes. */
  relative: string
  absolute: string
  isDirectory: boolean
  size: number
  mtimeMs: number
}

export interface WalkOptions {
  root: string
  /** Subdirectory to start from, root-relative ('' for the root). */
  start?: string
  ignore: IgnoreMatcher
  /** Stop after this many entries. Defaults to 50_000. */
  maxEntries?: number
  includeDirectories?: boolean
  signal?: AbortSignal
}

/**
 * Depth-first directory walk that honors .gitignore rules and skips
 * `.git`/`node_modules`. Directory symlinks are not followed to avoid loops;
 * unreadable directories are skipped silently. Order is deterministic
 * (alphabetical per directory).
 */
export function walkFiles(options: WalkOptions): WalkEntry[] {
  const root = options.root
  const maxEntries = options.maxEntries ?? 50_000
  const results: WalkEntry[] = []
  let capped = false

  const visit = (dirRelative: string): void => {
    if (capped || options.signal?.aborted) return

    options.ignore.loadDirectory(dirRelative)
    const dirAbsolute = dirRelative === '' ? root : join(root, dirRelative)

    let entries: Dirent[]
    try {
      entries = readdirSync(dirAbsolute, { withFileTypes: true }).sort((a, b) =>
        a.name.localeCompare(b.name),
      )
    } catch {
      return
    }

    for (const entry of entries) {
      if (capped || options.signal?.aborted) return
      if (ALWAYS_SKIPPED.has(entry.name)) continue

      const rel = dirRelative === '' ? entry.name : `${dirRelative}/${entry.name}`
      const absolute = join(dirAbsolute, entry.name)
      let isDirectory = entry.isDirectory()
      let isFile = entry.isFile()

      if (entry.isSymbolicLink()) {
        try {
          const stats = statSync(absolute)
          isDirectory = stats.isDirectory()
          isFile = stats.isFile()
        } catch {
          continue
        }
        // Directory symlinks are skipped entirely (loop risk).
        if (isDirectory) continue
      }

      let size = 0
      let mtimeMs = 0
      if (isFile) {
        try {
          const stats = statSync(absolute)
          size = stats.size
          mtimeMs = stats.mtimeMs
        } catch {
          continue
        }
      }

      if (options.ignore.ignores(rel, isDirectory)) continue

      if (isDirectory) {
        if (options.includeDirectories) {
          results.push({ relative: rel, absolute, isDirectory: true, size: 0, mtimeMs })
        }
        if (results.length >= maxEntries) {
          capped = true
          return
        }
        visit(rel)
        continue
      }

      if (!isFile) continue

      results.push({ relative: rel, absolute, isDirectory: false, size, mtimeMs })
      if (results.length >= maxEntries) {
        capped = true
        return
      }
    }
  }

  const start = (options.start ?? '').replaceAll('\\', '/').replace(/^\.\//, '').replace(/\/+$/, '')
  const normalizedStart = start === '.' ? '' : start

  // Load ignore files from the root down to the start directory so a search
  // rooted in a subdirectory still honors rules above it.
  if (normalizedStart !== '') {
    const segments = normalizedStart.split('/')
    for (let index = 0; index <= segments.length; index += 1) {
      options.ignore.loadDirectory(segments.slice(0, index).join('/'))
    }
  }

  visit(normalizedStart)
  return results
}
