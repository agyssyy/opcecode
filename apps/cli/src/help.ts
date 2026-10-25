import { VERSION } from './version.js'

export function helpText(): string {
  return `OpceCode! v${VERSION} — open code, your code

Usage:
  opcecode [chat] [options]   Start an interactive session (default)
  opcecode <command> [options]

Commands:
  chat              Start an interactive session
  doctor            Check your setup
  init              Write opcecode.json from a provider preset
  help              Show this help
  version           Print the version

Options:
  --cwd <path>      Project directory (default: current directory)
  --model <id>      Override the configured model (provider/model)
  --preset <id>     Preset for init: openrouter-free, groq, openai, anthropic, local
  --force           Overwrite an existing opcecode.json (init)
  --json            Machine-readable output (doctor)
  --no-color        Disable colors
  -h, --help        Show help
  -v, --version     Print version

First time here?
  opcecode init --preset openrouter-free
  opcecode doctor
  opcecode
`
}

export function initHelp(): string {
  return `Usage: opcecode init [--preset <id>] [--model <provider/model>] [--force]

Presets:
  openrouter-free   OpenRouter free router (needs OPENROUTER_API_KEY)
  groq              Groq free tier (needs GROQ_API_KEY)
  openai            OpenAI (needs OPENAI_API_KEY)
  anthropic         Anthropic Claude (needs ANTHROPIC_API_KEY, paid)
  local             LM Studio / vLLM on http://localhost:1234/v1
`
}
