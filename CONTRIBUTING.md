# Contributing to OpceCode!

Thanks for being here. The project is pre-alpha: the scope in [PLAN.md](../PLAN.md) is
deliberately small, and additions that widen it will usually be deferred.

## Setup

```sh
git clone https://github.com/agyssyy/opcecode.git
cd opcecode
npm install
npm run build
npm test
npm run doctor
```

Requirements: Node 20.19+, npm 10+. Python 3.11+ is optional (it powers the `py` tool and
evals in M3).

## Before opening a PR

- Run `npm run lint`, `npm run build`, and `npm test`.
- Keep PRs focused. One concern per PR.
- Add a test for behavior changes, especially permissions and config precedence.
- Update the relevant ADR if you change an architectural decision; do not silently rewrite
  history.
- Do not add a runtime dependency without explaining why the standard library is not enough.

## Commit messages

Conventional commits are appreciated: `feat:`, `fix:`, `docs:`, `test:`, `chore:`,
`refactor:`. The subject line should read as a complete sentence fragment.

## Scope

Good first areas: docs, provider fixture tests, Windows-specific path handling, and eval
scenarios. Please open an issue before starting anything large.
