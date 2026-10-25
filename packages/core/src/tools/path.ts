import { realpathSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path'
import { ToolError } from './types.js'

export interface ResolvedPath {
  absolute: string
  relative: string
}

function tryRealpath(path: string): string | undefined {
  try {
    return realpathSync(path)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

/**
 * Resolve the nearest existing ancestor and re-attach the missing tail. This
 * lets new files be written inside symlinked project directories while still
 * checking the real location against the workspace root.
 */
function resolveMissingPath(path: string): string {
  let cursor = path
  const tail: string[] = []

  while (true) {
    const real = tryRealpath(cursor)
    if (real !== undefined) return join(real, ...tail)
    const parent = dirname(cursor)
    if (parent === cursor) return path
    tail.unshift(basename(cursor))
    cursor = parent
  }
}

/**
 * Resolve a model-supplied path and reject anything outside the workspace.
 * Existing paths are canonicalized so a symlink cannot escape the jail.
 */
export function resolveWorkspacePath(root: string, input: string): ResolvedPath {
  if (input.trim() === '') throw new ToolError('Path must not be empty.')

  const rootReal = tryRealpath(root)
  if (rootReal === undefined) {
    throw new ToolError(`Workspace directory does not exist: ${root}`)
  }

  const candidate = isAbsolute(input) ? input : join(rootReal, input)
  const targetReal = tryRealpath(candidate) ?? resolveMissingPath(candidate)
  const rel = relative(rootReal, targetReal)

  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new ToolError(`Path is outside the workspace: ${input}`)
  }

  return {
    absolute: targetReal,
    relative: rel.split(sep).join('/'),
  }
}
