# OpceCode!

> Open code, your code.

A small, open-source terminal coding agent. Talk to a model, let it read, edit, and run
code in your repo — and approve the risky bits.

**Status: alpha (M1).** The agent loop, tools, and permission prompts work. A TUI,
more providers, and the Python sidecar are on the way. See [PLAN.md](./PLAN.md).

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

## Try it

```sh
git clone https://github.com/agyssyy/opcecode.git
cd opcecode
npm install
npm run build
npm link   # optional: puts `opcecode` on your PATH
```

Then, from the project you want to work on:

```sh
opcecode init --preset openrouter-free   # writes opcecode.json
opcecode doctor                          # checks config, key, and shell
opcecode                                 # start chatting with your repo
```

Without `npm link`, replace `opcecode` with `node <path-to-opcecode>/apps/cli/dist/index.js`.

A session looks like this:

```
› fix the failing test in src/parser.test.ts
● read src/parser.test.ts
✓ read ok · 3ms
● write src/parser.ts
? write src/parser.ts (medium risk)
[y] allow once  [a] always this session  [n] deny  [d] details y
✓ write ok · 2ms
● bash node --test
? bash node --test (high risk)
[y] allow once  [a] always this session  [n] deny  [d] details a
✓ bash ok · 812ms
Tests pass now (12/12).
```

`read` is allowed by default; every `write` and `bash` call asks first. Paths are jailed
to the project directory, API keys are scrubbed from child processes, and Ctrl+C aborts
a running turn.

## Repository layout

```
apps/cli            CLI entrypoint, chat REPL, init, doctor
packages/core       agent loop, providers, tools, permissions, sessions
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
npm run dev -- chat
```

## Contributing

Issues and PRs are welcome. v0.1 has a deliberately small scope — read
[PLAN.md](./PLAN.md) first. Be kind; see [CODE_OF_CONDUCT.md](./CODE_OF_CONDUCT.md).

## License

MIT © 2026 OpceCode! contributors
