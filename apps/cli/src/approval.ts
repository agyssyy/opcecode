import { type ApprovalDecision, type ApprovalRequest, createAbortError } from '@opcecode/core'
import type { Styler } from './theme.js'

export interface ApprovalOptions {
  styles: Styler
  stdin: NodeJS.ReadStream
  stdout: NodeJS.WriteStream
}

function preview(args: Record<string, unknown>): string[] {
  const content = args.content
  if (typeof content === 'string') {
    const lines = content.split(/\r?\n/).slice(0, 40)
    const more = content.split(/\r?\n/).length - lines.length
    return [...lines, ...(more > 0 ? [`… ${more} more lines`] : [])]
  }
  return [JSON.stringify(args, null, 2)]
}

/**
 * Single-key approval prompt. Keys are read in raw mode so no Enter is needed:
 * y = once, a = always this session, n/Esc = deny, d = details, Ctrl+C = abort.
 */
export function createApprovalPrompt(
  options: ApprovalOptions,
): (request: ApprovalRequest) => Promise<ApprovalDecision> {
  const { styles, stdin, stdout } = options

  return (request) =>
    new Promise<ApprovalDecision>((resolve, reject) => {
      if (!stdin.isTTY) {
        resolve('deny')
        return
      }

      const write = (text: string) => stdout.write(text)
      const writeLine = (text = '') => write(`${text}\n`)

      writeLine()
      writeLine(
        `${styles.yellow('?')} ${styles.bold(request.tool)} ${styles.dim(request.subject)} ${styles.dim(`(${request.risk} risk)`)}`,
      )

      const printKeys = () =>
        write(`${styles.dim('[y] allow once  [a] always this session  [n] deny  [d] details')} `)

      const printDetails = () => {
        writeLine()
        for (const line of preview(request.args)) writeLine(styles.dim(`  ${line}`))
        writeLine()
      }

      printKeys()

      const wasRaw = stdin.isRaw
      stdin.setRawMode(true)
      stdin.resume()

      const cleanup = () => {
        stdin.off('data', onData)
        if (!wasRaw) stdin.setRawMode(false)
        stdin.pause()
      }

      const answer = (decision: ApprovalDecision, label: string) => {
        cleanup()
        writeLine(label)
        resolve(decision)
      }

      const onData = (chunk: Buffer) => {
        for (const char of chunk.toString('utf8')) {
          if (char === '\u0003') {
            cleanup()
            writeLine(styles.yellow('aborted'))
            reject(createAbortError('Aborted at approval prompt'))
            return
          }
          if (char === 'y' || char === 'Y') {
            answer('allow-once', styles.green('allowed once'))
            return
          }
          if (char === 'a' || char === 'A') {
            answer('allow-session', styles.green('always allowed this session'))
            return
          }
          if (char === 'n' || char === 'N' || char === '\r' || char === '\n' || char === '\u001b') {
            answer('deny', styles.red('denied'))
            return
          }
          if (char === 'd' || char === 'D') {
            writeLine()
            printDetails()
            printKeys()
          }
        }
      }

      stdin.on('data', onData)
    })
}
