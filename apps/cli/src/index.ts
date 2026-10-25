#!/usr/bin/env node
import { resolve } from 'node:path'
import { ConfigError } from '@opcecode/config'
import { type ParsedArgs, parseCommandLine, UsageError } from './args.js'
import { runChat } from './commands/chat.js'
import { runDoctor } from './commands/doctor.js'
import { runInit } from './commands/init.js'
import { helpText, initHelp } from './help.js'
import { colorEnabled } from './theme.js'
import { VERSION } from './version.js'

export async function main(argv: string[]): Promise<number> {
  let args: ParsedArgs
  try {
    args = parseCommandLine(argv)
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      return error.exitCode
    }
    console.error(error instanceof Error ? error.message : String(error))
    return 2
  }

  const cwd = resolve(args.flags.cwd ?? process.cwd())
  const color = colorEnabled(args.flags.color, process.env, process.stdout.isTTY ?? false)

  try {
    switch (args.command) {
      case 'version':
        console.log(VERSION)
        return 0
      case 'help':
        console.log(helpText())
        return 0
      case 'doctor':
        return runDoctor({
          cwd,
          env: process.env,
          json: args.flags.json,
          color,
        })
      case 'init':
        return runInit({
          cwd,
          color,
          preset: args.flags.preset,
          model: args.flags.model,
          force: args.flags.force,
        })
      case 'chat':
        return await runChat({
          cwd,
          env: process.env,
          color,
          model: args.flags.model,
        })
    }
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(error.message)
      console.error('')
      console.error(initHelp().trimEnd())
      return error.exitCode
    }
    if (error instanceof ConfigError) {
      console.error(`Config error: ${error.message}`)
      return 1
    }
    console.error(error instanceof Error ? (error.stack ?? error.message) : String(error))
    return 1
  }
}

process.exitCode = await main(process.argv.slice(2))
