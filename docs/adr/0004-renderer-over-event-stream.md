# ADR-0004: The UI is a renderer over an event stream

- Status: accepted
- Date: 2026-10-22

## Context

Terminal UIs are where agent projects spend months. We need a working loop now and a
polished TUI later, without rewriting the core.

## Decision

The agent core exposes typed events (`text.delta`, `tool.start`, `tool.end`,
`permission.request`, `usage`, `error`). The phase-one UI is a plain streaming REPL. The
phase-two TUI (Ink or OpenTUI, decided by a spike at M4) is another renderer implementing
the same interface.

`--print` JSON output consumes the same events, so scripting and UI share one code path.

## Consequences

- No React/terminal framework dependency in M1.
- Approvals and diffs must be expressible as events, not callbacks hidden in the renderer.
- A future web UI is possible without touching the core.
