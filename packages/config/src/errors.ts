export class ConfigError extends Error {
  readonly file: string | undefined

  constructor(message: string, file?: string) {
    super(file ? `${file}: ${message}` : message)
    this.name = 'ConfigError'
    this.file = file
  }
}
