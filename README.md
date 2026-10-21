# OpceCode!

> Open code, your code.

A small, open-source terminal coding agent. Talk to a model, let it read, edit, and run
code in your repo — and approve the risky bits.

**Status: pre-alpha.** The agent loop lands in M1. See [PLAN.md](./PLAN.md).

## Why

- **Yours.** MIT licensed, no telemetry, sessions stay on your machine.
- **Small.** A TypeScript core, a handful of sharp tools, and an optional Python sidecar.
- **Explicit.** Every tool call is visible. Writes and shell commands ask first.
- **Provider-agnostic.** Any OpenAI-compatible endpoint works: OpenRouter, Groq, OpenAI,
  LM Studio, vLLM. Anthropic support lands in M2.

## Providers and the "free" question

There is no hosted, unlimited, free LLM API. Free tiers are rate limited, and model IDs
change. OpceCode! ships presets so you can start quickly and swap later:

| Preset            | What you need                         | Reality                              |
| ----------------- | ------------------------------------- | ------------------------------------ |
| `openrouter-free` | `OPENROUTER_API_KEY`                  | Free `:free` models, daily/rate caps |
| `groq`            | `GROQ_API_KEY`                        | Fast free tier, rate caps            |
| `openai`          | `OPENAI_API_KEY`                      | Paid, most reliable                  |
| `local`           | LM Studio or vLLM on `localhost:1234` | Truly unlimited, needs hardware      |

Default preset is `openrouter-free`. Edit `opcecode.json` to change the model at any time.

## Try the scaffold (pre-alpha)

```sh
git clone https://github.com/agyssyy/opcecode.git
cd opcecode
npm install
npm run build
npm run doctor
```

Create a config in your project:

```sh
node apps/cli/dist/index.js init --preset openrouter-free
```

## Repository layout

```
apps/cli            CLI entrypoint, doctor, init
packages/config     config schema, precedence, presets
docs/adr            architecture decisions
python/             Python sidecar and evals (M3)
```

## Development

```sh
npm run build      # tsc project references
npm test           # vitest
npm run lint       # biome ci
npm run dev -- doctor
```

## Contributing

Issues and PRs are welcome once M1 lands. Read [PLAN.md](./PLAN.md) first — v0.1 has a
deliberately small scope. Be kind; see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

MIT © 2026 OpceCode! contributors
