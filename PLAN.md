# OpceCode! — v0.1 Plan

> A small, open-source terminal coding agent. Talk to a model, let it read/edit/run code in your repo, approve the risky bits.

Status: **proposal — awaiting approval**
Owner: you
Target: working local MVP (`v0.1.0`), MIT licensed

---

## 1. What we are building

`opcecode` is a CLI/TUI coding agent that:
- Runs in a project directory and talks to an LLM (cloud or local).
- Streams responses and shows every tool call as it happens.
- Can read, search, create, edit, and execute code — **with explicit approval** for anything destructive.
- Persists sessions so you can resume, replay, and inspect what happened.
- Ships as one npm package plus an optional Python sidecar for Python execution and evals.

**Tagline:** _Open code, your code._

### Non-goals for v0.1

Explicitly deferred: multi-agent orchestration, MCP servers, LSP integration, web/desktop UI, cloud sync, team features, plugin marketplace, embeddings-based repo indexing. Each gets a design note, not code.

---

## 2. Stack decision

The request was "Node.js, Python, and TypeScript". We use all three deliberately, not decoratively:

| Layer          | Tech                    | Responsibility                                                |
| -------------- | ----------------------- | ------------------------------------------------------------- |
| CLI + TUI      | TypeScript on Node ≥ 20 | Argument parsing, interactive loop, rendering, approvals      |
| Agent core     | TypeScript              | Provider abstraction, agent loop, sessions, context budgeting |
| Tools          | TypeScript              | Filesystem, search, shell, todos — the fast path              |
| Python runtime | Python ≥ 3.11           | Sandboxed `py` tool execution + evaluation harness            |
| Transport      | JSON-RPC 2.0 over stdio | Versioned contract between Node and Python                    |

**Why TS for the core:** one runtime for CLI + core + tools, mature provider ecosystem, fast iteration, and the TUI can later move to Ink/OpenTUI without touching the agent loop.

**Why Python only for a sidecar:** it gives us real Python execution (venvs, imports, pytest) and a pytest-based eval harness without making the CLI's startup time or packaging depend on Python. If the sidecar is missing, everything except `py` and `evals` still works.

**Explicitly rejected:** Bun as the primary runtime (we want the broadest `npx` audience and Node 24 is installed), Rust (too slow to iterate), a single-language Python core (weaker CLI/TUI story).

---

## 3. Architecture

### 3.1 Monorepo layout

```
opcecode/
  package.json                 # npm workspaces, root scripts
  tsconfig.base.json
  biome.json                   # lint + format (single tool)
  apps/
    cli/                       # bin: opcecode
      src/index.ts             # arg parsing, mode selection
      src/repl/                # plain streaming REPL (phase 1)
      src/tui/                 # Ink/OpenTUI (phase 2, behind Renderer)
  packages/
    core/                      # agent loop, context assembly, compaction
    providers/                 # provider interface + adapters
    tools/                     # read, write, edit, bash, grep, glob, list, todo, py
    permissions/               # rule engine + approval policy
    config/                    # config loading, precedence, validation
    protocol/                  # shared types + JSON-RPC schemas
    session/                   # append-only event store, resume, replay
  python/
    pyproject.toml
    src/opcecode_runtime/
      __main__.py              # `python -m opcecode_runtime serve`
      server.py                # JSON-RPC loop, handshake, cancellation
      executor.py              # venv-aware subprocess runner, limits
  evals/
    scenarios/                 # scripted repo fixtures + expected outcomes
    runner.py                  # pytest harness, mock + real provider modes
  docs/
    adr/                       # architecture decision records
    PLAN.md                    # this file
  examples/
    failing-test/              # canonical "fix my test" demo
```

npm workspaces (npm 11 is installed) + TS project references. No pnpm/Bun requirement for contributors.

### 3.2 Runtime shape

```
┌─────────────┐     events      ┌──────────────┐
│  CLI / TUI  │◄────────────────│  Agent Core  │
│  (renderer) │───── input ────►│              │
└─────────────┘                 └──────┬───────┘
                                       │ stream
                          ┌────────────┼────────────┐
                          ▼            ▼            ▼
                     Provider      Permission    Session
                     adapter        engine        store
                          │            │            │
                     HTTP/SSE      user prompt   JSONL file
                                       │
                                       ▼
                                    Tools ──► FS / shell
                                       │
                                       └──► Python sidecar (stdio JSON-RPC)
```

The agent core emits a typed async event stream. The renderer only consumes events — so the plain REPL and the future TUI are interchangeable. `--print` JSON output uses the same stream.

### 3.3 Agent loop

```
append user message
loop (max 25 steps):
  context = system prompt + project rules + compacted history + tool schemas
  stream provider response
    ├─ text deltas ──► renderer
    └─ tool calls ────► permission check ──► execute ──► append result
  stop when: no tool calls, max steps, token budget, or user abort
```

Rules baked in from day one:
- **Every tool result is a message** in the session log, including denials and timeouts.
- **Abort is a first-class state** (`Esc`/`Ctrl+C` cancels the request and the running tool).
- **Token budget** is computed from the model's context window, reserving 20% for output; oldest turns are summarized when over budget.
- **No hidden retries.** A retry is logged as an event so replay stays truthful.

### 3.4 Providers

```ts
interface Provider {
  id: string
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>
}
```

| Adapter             | Covers                                                  | Milestone |
| ------------------- | ------------------------------------------------------- | --------- |
| `openai-compatible` | OpenAI, OpenRouter, Groq, LM Studio, vLLM, Ollama `/v1` | M1        |
| `anthropic`         | Claude models, native tool-use blocks                   | M2        |
| `google`            | Gemini                                                  | Post-MVP  |

Adapters use `fetch` directly — no vendor SDKs, no dependency churn. Contract tests run each adapter against recorded SSE fixtures. First-run wizard offers presets so no model is hardcoded.

### 3.5 Tools (v0.1)

| Tool                                                | Risk   | Default policy           |
| --------------------------------------------------- | ------ | ------------------------ |
| `read` (offset/limit, numbered lines)               | low    | allow inside workspace   |
| `list`                                              | low    | allow                    |
| `glob`                                              | low    | allow                    |
| `grep`                                              | low    | allow                    |
| `write` (atomic, creates dirs)                      | medium | ask                      |
| `edit` (exact `oldString` → `newString`)            | medium | ask                      |
| `bash` (shell detected per OS, timeout, output cap) | high   | ask; read-only allowlist |
| `todo` (session task list)                          | none   | allow                    |
| `py` (sidecar, project venv)                        | medium | ask                      |

Deferred: `webfetch`, `task` (subagents), `mcp`, image input.

Cross-platform details that are easy to get wrong and are therefore in scope:
- Windows uses `pwsh`/`powershell`, not `bash`; macOS/Linux use the user's shell.
- Path jailing resolves symlinks and `realpath` before comparing against the workspace root.
- Atomic writes: temp file in the same directory + rename, preserving mode where possible.
- Output caps: `bash` truncates head/tail at ~30k chars; `read` defaults to 500 lines.

### 3.6 Permissions

```ts
type Decision = 'allow' | 'ask' | 'deny'
type Rule = { tool: string; pattern?: string; decision: Decision }
```

- First matching rule wins; defaults come last.
- Interactive prompt: `y` once, `a` always this session, `n` deny (reason goes back to the model), `d` show diff/command first.
- Non-interactive (`-p`) mode never prompts: it requires an explicit policy file or `--yes`, otherwise exits with code 3.
- Config can never _silently_ grant shell access outside the workspace; `--allow-outside` is a visible CLI flag only.

### 3.7 Sessions

Path: `~/.opcecode/projects/<hash(cwd)>/sessions/<timestamp>-<id>/`

| File           | Content                                                                     |
| -------------- | --------------------------------------------------------------------------- |
| `meta.json`    | cwd, provider/model, title, timestamps, token usage                         |
| `events.jsonl` | append-only source of truth: messages, tool calls, approvals, errors, usage |
| `summary.md`   | compaction summaries, linked to the event range they replace                |

Resume/replay rebuilds state by folding the event log. No database in v0.1. Session IDs are short and human-typeable.

### 3.8 Python sidecar

- Launched lazily on first `py` tool call; supervised with restart + backoff; disabled gracefully if Python is absent.
- Handshake: `{"method":"hello","params":{"protocol":1}}`; mismatched versions refuse to run.
- Methods: `exec`, `cancel`, `ping`, `shutdown`.
- Execution happens in the project's `.venv` if present, with timeout, output cap, and scrubbed environment.
- **Also home to the eval harness**, which is the main reason Python earns its place in v0.1.

### 3.9 CLI surface

```
opcecode                      # interactive session in cwd
opcecode -p "fix the tests"   # headless; --output-format text|json|stream-json
opcecode continue             # resume most recent session
opcecode sessions list|show|rm
opcecode models               # configured providers/models
opcecode init                 # wizard -> opcecode.json (+ .opcecode/rules/)
opcecode config get|set|path
opcecode auth login|logout
opcecode doctor               # node, python, shell, keys, workspace checks
```

Exit codes: `0` success, `1` agent error, `2` usage, `3` permission denied, `4` max steps.

### 3.10 Configuration

Precedence: **CLI flags → env → project `opcecode.json` → `~/.opcecode/config.json` → defaults**.

```jsonc
{
  "model": "ollama/qwen2.5-coder:7b",
  "providers": {
    "ollama": { "type": "openai-compatible", "baseURL": "http://localhost:11434/v1" },
    "openai": { "type": "openai-compatible", "apiKey": "${env:OPENAI_API_KEY}" }
  },
  "permissions": [
    { "tool": "bash", "pattern": "git status*", "decision": "allow" },
    { "tool": "write", "pattern": "**/*.md", "decision": "ask" }
  ],
  "context": { "maxSteps": 25, "readLimit": 500 }
}
```

Project instructions: discover `AGENTS.md` / `OPCECODE.md` at the root and merge `.opcecode/rules/*.md`. Respect `.gitignore` in search tools.

---

## 4. Milestones

Estimates assume one developer, part-time, with review pauses. Each milestone ends in something demoable.

| #      | Milestone      | Deliverable                                                                                                                                   | Est.    |
| ------ | -------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------- |
| **M0** | Foundations    | Repo, workspaces, TS config, Biome, vitest, CI (Win+Linux), MIT license, README skeleton, ADR-001..005, `opcecode doctor` + config loader     | 0.5–1 d |
| **M1** | Spine          | Provider interface + `openai-compatible`/Ollama, streaming, session JSONL, plain REPL, `read`/`write`/`bash`, permission prompt, abort        | 2–3 d   |
| **M2** | Real editing   | `edit`/`grep`/`glob`/`list`/`todo`, `AGENTS.md` discovery, `.gitignore` handling, token budget + compaction, Anthropic adapter, usage display | 2–3 d   |
| **M3** | Python         | Sidecar protocol, `py` tool, pytest eval harness, mock-provider scenarios, CI job                                                             | 2 d     |
| **M4** | TUI + sessions | Ink or OpenTUI renderer behind `Renderer`, diffs in approvals, `sessions list/resume`, `--print` JSON, session titles                         | 2–3 d   |
| **M5** | Release        | Docs + examples, security policy, `npx opcecode` smoke test, npm publish, GitHub release, demo GIF                                            | 2 d     |

**Total: ~10–14 working days** for a credible `v0.1.0`.

### Definition of done (v0.1)

1. `npx opcecode` works on Windows and Linux against Ollama and at least one cloud provider.
2. Three scripted benchmark tasks pass in `examples/`: fix a failing test, add a CLI flag, rename a symbol across files.
3. Permission rules are enforced and covered by tests, including symlink escape and `-p` denial.
4. `opcecode continue` restores a session exactly (replay test).
5. `npm test` + `pytest` green in CI on Windows and Ubuntu.
6. README has install, quickstart, config reference, and a demo recording.
7. MIT license, CONTRIBUTING, CODE_OF_CONDUCT, SECURITY.md.

---

## 5. Testing & evaluation

| Layer       | Tool                       | What it proves                                                                  |
| ----------- | -------------------------- | ------------------------------------------------------------------------------- |
| Unit        | Vitest                     | config precedence, permission matching, path jail, diff/edit logic              |
| Contract    | Vitest + SSE fixtures      | provider adapters parse real wire formats                                       |
| Replay      | Vitest golden files        | event log → transcript determinism                                              |
| Integration | temp repos + mock provider | full loop: tool call → approval → result → final answer                         |
| Python      | pytest                     | sidecar protocol, timeouts, env scrubbing                                       |
| Evals       | pytest + scenario fixtures | task success rate, invalid tool-call rate, destructive-op rate, tokens, latency |

Mock provider is deterministic and first-class: CI never needs an API key.

---

## 6. Risks and mitigations

| Risk                                   | Mitigation                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Scope creep (TUI, MCP, subagents)      | Non-goals list above; new ideas go to `docs/roadmap.md`, not the MVP                            |
| Provider API drift                     | Thin `fetch` adapters + recorded-fixture contract tests                                         |
| Windows/Linux shell differences        | Shell abstraction from M1, CI on both OSes, `pwsh` default on Windows                           |
| Model does something destructive       | Ask-by-default for write/edit/bash, path jail, no network unless allowed, diffs before approval |
| Python sidecar flakiness               | Lazy start, restart with backoff, version handshake, feature degrades gracefully                |
| Name collision/trademark with OpenCode | Check npm + GitHub availability before M0; fall back to `@scope/opcecode`                       |
| Agent loops burning tokens             | `maxSteps`, budget reserve, visible usage per turn, abort                                       |

---

## 7. Decisions to confirm

1. **Repo home** — create `C:\Users\H P\opcecode` and a GitHub repo under your account? Public from day one or private until M1?
2. **License** — MIT (recommended for adoption) or Apache-2.0?
3. **First provider preset** — Ollama local-first, OpenAI, or OpenRouter?
4. **TUI framework (M4)** — Ink (React, mature, heavier) vs OpenTUI (newer, faster, Bun-leaning). Recommendation: keep phase-1 REPL, decide at M4 with a spike.
5. **Package name** — `opcecode` if free on npm, otherwise a scoped name. Keep `!` for branding only; the binary is `opcecode`.

---

## 8. Immediate next steps (on approval)

1. `git init`, scaffold workspaces, Biome, vitest, CI, LICENSE, ADRs.
2. Implement config loader + `opcecode doctor` (first visible command).
3. Implement provider interface + Ollama adapter + streaming REPL with a fake echo tool.
4. Add `read` + `bash` + permission prompt; demo in `examples/failing-test`.
