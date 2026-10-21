# ADR-0001: TypeScript core with a Python sidecar

- Status: accepted
- Date: 2026-10-22

## Context

The project should use Node.js, TypeScript, and Python. The temptation is to split the agent
itself across both runtimes, which doubles the process model, the type surface, and the
failure modes.

## Decision

The CLI, agent loop, providers, tools, permissions, and sessions are TypeScript on Node.
Python is a lazily started sidecar, reached over JSON-RPC on stdio, and owns only:
- the `py` tool (venv-aware execution), and
- the evaluation harness.

If Python is absent, the CLI works and reports the `py` tool as disabled.

## Consequences

- One fast startup path and one package manager for the core.
- The sidecar needs a version handshake, restart policy, and cancellation mapping.
- Python contributors get a focused surface (`python/src/opcecode_runtime`) instead of a
  second half-implemented agent.
