import { randomBytes } from 'node:crypto'
import { mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

/**
 * Write a file via temp-file + rename so readers never see a partial file.
 * Falls back to replace-and-rename when the target is locked (Windows).
 */
export function atomicWriteFile(absolute: string, content: string): void {
  mkdirSync(dirname(absolute), { recursive: true })
  const temp = join(
    dirname(absolute),
    `.${basename(absolute)}.opcecode-${process.pid}-${randomBytes(4).toString('hex')}.tmp`,
  )

  writeFileSync(temp, content, 'utf8')
  try {
    try {
      renameSync(temp, absolute)
    } catch {
      rmSync(absolute, { force: true })
      renameSync(temp, absolute)
    }
  } finally {
    rmSync(temp, { force: true })
  }
}
