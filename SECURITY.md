# Security policy

OpceCode! is pre-alpha. It runs model-generated tool calls against your working tree, so
please treat it as experimental software.

## Reporting a vulnerability

Do **not** open a public issue for a security problem.

Use GitHub's private vulnerability reporting:
https://github.com/agyssyy/opcecode/security/advisories/new

Include:
- affected version or commit,
- operating system,
- a minimal reproduction,
- impact, especially whether it crosses the workspace boundary or leaks credentials.

We aim to acknowledge reports within 72 hours and to ship a fix or mitigation before
public disclosure.

## Scope

In scope:
- path traversal or symlink escape outside the workspace,
- permission-rule bypasses,
- credential leakage in logs, session files, or tool output,
- command injection through tool arguments,
- denial of service through unbounded tool output or recursion.

Out of scope for now:
- prompt injection that stays within the approved permission model,
- issues requiring a compromised local machine,
- model quality or hallucinated code.
