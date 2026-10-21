# ADR-0002: Provider adapters use fetch, not vendor SDKs

- Status: accepted
- Date: 2026-10-22

## Context

Coding agents live or die on provider compatibility. Vendor SDKs bring retries, streaming
helpers, and types, but also lockfiles full of transitive dependencies, breaking releases,
and four different ideas of what a tool call looks like.

## Decision

Define one small `Provider` interface and implement adapters with `fetch`:

```ts
interface Provider {
  id: string
  stream(req: ChatRequest, signal: AbortSignal): AsyncIterable<ProviderEvent>
}
```

The first adapter is `openai-compatible`, which covers OpenRouter, Groq, OpenAI, LM Studio,
vLLM, and most local servers. Anthropic gets a native adapter in M2 because its tool-use
blocks differ materially.

Adapter behavior is tested against recorded SSE fixtures; CI never needs an API key.

## Consequences

- No vendor SDK churn, and every wire format is visible in the repo.
- We own retry, backoff, and error mapping.
- Provider-specific features (reasoning blocks, prompt caching) need explicit adapter work.
