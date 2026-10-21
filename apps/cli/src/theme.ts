export interface Styler {
  green(text: string): string
  yellow(text: string): string
  red(text: string): string
  cyan(text: string): string
  dim(text: string): string
  bold(text: string): string
}

function wrap(open: number, close: number, enabled: boolean) {
  return (text: string) => (enabled ? `\u001b[${open}m${text}\u001b[${close}m` : text)
}

export function createStyler(enabled: boolean): Styler {
  return {
    green: wrap(32, 39, enabled),
    yellow: wrap(33, 39, enabled),
    red: wrap(31, 39, enabled),
    cyan: wrap(36, 39, enabled),
    dim: wrap(2, 22, enabled),
    bold: wrap(1, 22, enabled),
  }
}

export function colorEnabled(requested: boolean, env: NodeJS.ProcessEnv, isTTY: boolean): boolean {
  if (!requested) return false
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== '') return false
  return isTTY
}
