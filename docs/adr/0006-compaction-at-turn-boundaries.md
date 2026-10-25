# ADR-0006: Compaction happens at turn boundaries, at request time

- Status: accepted
- Date: 2026-10-25

## Context

Tool output and long conversations can exceed a model's context window. Truncating a
tool result mid-call produces invalid transcripts; deleting history makes replay lie.
A model also needs enough recent context to continue the current task.

## Decision

- Estimate transcript size at ~4 characters per token and compare against
  `context.maxContextTokens` (default 24,000).
- Compact only at user-message boundaries. The current turn is always kept; older turns
  are replaced by one bounded `system` summary listing prior summaries, user requests,
  tool usage counts, and touched paths.
- Compact the in-memory request transcript, not the session log. Append a
  `session.compact` event describing what was omitted and the estimates before/after.
- Save as many recent turns as fit, falling back to the current turn alone. Never split
  an assistant tool call from its tool result.

## Consequences

- Providers receive a valid, shorter transcript; the full log remains for audit and replay.
- Summaries lose detail by design. The prompt tells the model to re-read files with
  `read`/`grep` when it needs exact contents.
- Token counts are estimates until a provider reports usage; `/usage` labels them.
- A single oversized turn cannot be compacted; the agent warns instead of corrupting it.
