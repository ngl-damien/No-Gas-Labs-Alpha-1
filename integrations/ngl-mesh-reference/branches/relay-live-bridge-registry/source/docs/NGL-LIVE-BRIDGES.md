# NGL Live Bridge Registry

Status: PROPOSED integration contract for the Relay/Mesh provider layer.

## Goal

Turn the existing provider-specific settings screen into a capability-driven bridge layer without making provider request/response formats canonical state.

The Relay should select a bridge by declared capabilities, then preserve the raw request, raw response, normalized artifact, timing, HTTP status, model id, endpoint, retry metadata, and provenance parent links as separate evidence.

## Bridge priority

### 1. OpenAI-compatible bridge

Use one generic adapter for providers that implement `/v1/chat/completions` or a compatible equivalent. Provider profiles supply only base URL, authorization style, model id, and optional headers.

Known live targets as of 2026-09-17:

- Groq: `https://api.groq.com/openai/v1`
- Hugging Face Inference Providers router: `https://router.huggingface.co/v1`
- Cloudflare Workers AI: `https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}/ai/v1`
- OpenRouter: `https://openrouter.ai/api/v1`

This bridge should be the default expansion path because it lets NGL add providers without adding a new transport implementation every time.

### 2. Native-provider bridges

Keep native adapters only where they expose meaningful capability not preserved by the generic bridge, such as provider-specific reasoning controls, native message semantics, multimodal input, or richer tool metadata.

### 3. Gateway bridge

Support a gateway profile as a first-class node. A gateway is not authoritative: it is an execution route whose provider/model resolution must be recorded in provenance.

Cloudflare AI Gateway can route multiple model providers behind one API surface. NGL should record both the gateway endpoint and resolved upstream provider/model when available.

## Required bridge record

Each remote execution should append a record with at least:

```text
bridge_id
provider_profile_id
endpoint_base
request_path
model_requested
model_resolved
capabilities_requested[]
capabilities_observed[]
started_at
completed_at
latency_ms
http_status
retry_count
request_artifact_id
response_artifact_id
normalized_output_artifact_id
error_artifact_id
provenance_parents[]
```

API keys must never be copied into provenance records, logs, screenshots, exported artifacts, or model-visible context.

## Capability flags

Recommended profile flags:

```text
CHAT
STREAM
TOOLS
STRUCTURED_OUTPUT
VISION
EMBEDDINGS
REASONING_CONTROL
OPENAI_COMPAT
ANTHROPIC_COMPAT
MODEL_LIST
```

Selection rule: prefer explicit capability match over provider name.

## Failure behavior

- HTTP 429 becomes a first-class error artifact and may trigger bounded retry or a separately authorized fallback.
- Authentication failures never trigger blind cross-provider fallback.
- Timeouts and transport errors remain distinct from model refusals and malformed responses.
- A fallback call must cite the failed call as a provenance parent.
- A successful fallback does not erase the failed attempt.

## Android transport notes

Use one shared OkHttp client and derive per-call clients with `newBuilder()` when a bridge needs different timeouts. Configure connect/read/write/call timeouts explicitly. Keep retries bounded and provenance-visible; do not let automatic retransmission create invisible duplicate executions for non-idempotent request bodies.

## Immediate Relay UI adaptation

Replace the fixed four-provider mental model with:

1. Built-in profiles: OpenAI, Gemini, Groq, Claude.
2. Generic OpenAI-compatible profile.
3. Generic Anthropic-compatible profile.
4. Gateway profile.
5. Capability badges beside each enabled node.
6. A `TEST BRIDGE` action that performs a minimal probe and records the result locally before the node may participate in methodology stages.
7. A health state: `UNTESTED`, `READY`, `RATE_LIMITED`, `AUTH_FAILED`, `UNREACHABLE`, `INCOMPATIBLE`.

## Recommended first deployment

For the current Relay, add the generic OpenAI-compatible profile first. It gives immediate access to Groq, Hugging Face Inference Providers, OpenRouter, and Cloudflare Workers AI with one transport path while preserving NGL's authority and provenance boundaries.
