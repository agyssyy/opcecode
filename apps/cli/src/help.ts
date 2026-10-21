import { VERSION } from './version.js'

export function helpText(): string {
  return `OpceCode! v${VERSION} — open code, your code

Usage:
  opcecode <command> [options]

Commands:
  doctor            Check your setup
  init              Write opcecode.json from a provider preset
  help              Show this help
  version           Print the version

Options:
  --cwd <path>      Project directory (default: current directory)
  --preset <id>     Preset for init: openrouter-free, groq, openai, local
  --model <id>      Override the preset's model (provider/model)
  --force           Overwrite an existing opcecode.json
  --json            Machine-readable output (doctor)
  --no-color        Disable colors
  -h, --help        Show help
  -v, --version     Print version

Interactive mode lands in M1. For now: opcecode init, then opcecode doctor.
`
}

export function initHelp(): string {
  return `Usage: opcecode init [--preset <id>] [--model <provider/model>] [--force]

Presets:
  openrouter-free   OpenRouter free router (needs OPENROUTER_API_KEY)
  groq              Groq free tier (needs GROQ_API_KEY)
  openai            OpenAI (needs OPENAI_API_KEY)
  local             LM Studio / vLLM on http://localhost:1234/v1
`
}
