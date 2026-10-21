# ADR-0005: Writes and shell commands ask by default

- Status: accepted
- Date: 2026-10-22

## Context

A coding agent with filesystem and shell access can destroy a working tree in one turn.
Convenience defaults that silently allow writes trade the user's repo for a smoother demo.

## Decision

Default policy:

| Risk   | Tools                                  | Default                    |
| ------ | -------------------------------------- | -------------------------- |
| low    | `read`, `list`, `glob`, `grep`, `todo` | allow inside the workspace |
| medium | `write`, `edit`, `py`                  | ask                        |
| high   | `bash`                                 | ask                        |

Rules are evaluated first-match-wins, with defaults last. Paths are resolved with
`realpath` and must stay under the workspace root. In `--print` mode the agent never
prompts: it requires an explicit policy or `--yes`, otherwise it exits with code 3.

Every denial is fed back to the model as a tool result so it can adapt instead of retrying
blindly.

## Consequences

- Slower first runs, dramatically fewer disaster stories.
- Config must support narrow allow rules (for example `git status*`) to keep power users
  productive.
- Headless/CI users must make a policy decision up front, which is the point.
