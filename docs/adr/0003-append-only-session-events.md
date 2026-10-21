# ADR-0003: Sessions are append-only event logs

- Status: accepted
- Date: 2026-10-22

## Context

An agent session is the only record of why files changed. Users need resume, audit, and
bug reports. A mutable transcript makes all three fuzzy.

## Decision

Persist sessions as newline-delimited JSON events plus a small metadata file:

```
~/.opcecode/projects/<hash(cwd)>/sessions/<timestamp>-<id>/
  meta.json
  events.jsonl
```

Every input, streamed text block, tool call, permission decision, denial, error, and usage
report is an event. Resume and replay fold the log. Compaction appends a summary event that
references the event range it replaces; it never deletes history.

## Consequences

- Replay tests are deterministic and cheap.
- Crash recovery is "read the file until the last valid line".
- The log grows; compaction and a future `opcecode sessions prune` handle it.
- Secrets must be redacted at write time, not at display time.
