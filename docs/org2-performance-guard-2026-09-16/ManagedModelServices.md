# Managed model services lifecycle review

| Area | Verdict | Evidence | Change or reason kept | Verification |
| --- | --- | --- | --- | --- |
| Background work | keep | Selector demand owns reads; event subscriptions clean up on unmount | No new periodic catalog polling; token refresh remains demand driven | Source inspection; idle/reopen measurement not run |
| Memory | fix | Catalog capped at 100; 30-second shared cache; native connections 32 and per-owner credential cache 32; live session routes 256 | Evict short-lived credentials instead of retaining a lifetime set of selected sessions | Bound/eviction runtime tests not run |
| Scope/isolation | fix | Metadata, access/model/session and protocol are explicit cache keys; generations invalidate old catalog completions | Serialize authorization mutation; coalesce invalidated reads; each App configuration is independent | Identity/revocation/multi-instance tests not run |
| Rendering/hot path | keep | Existing model palette and App connection components consume shared reads | No new rendering framework or global model synchronization effect | Render/stream measurements not run |

| Provider | Raw transition | App/UI state | Topology/boundary | Expected invariant | Observed evidence |
| --- | --- | --- | --- | --- | --- |
| Anthropic-compatible Messages | Stream, local tool round, interruption | Live/reopen | Native session and Claude app/CLI | Selected source persists; route releases; refresh stays native | not run |
| OpenAI-compatible Responses | Stream, local tool round, restart | Live/restart | Native session and Codex app | Full context and selected source persist; no fallback credentials | not run |
| Both | Authorization change / config conflict | Active and idle | Per-identity source / per-App config | No stale token cache reuse or cross-App overwrite | not run |

Performance verdict: blocked. The user explicitly requested blind implementation and deferred compilation, automated tests, Computer Use and runtime measurement to the next stage. The uncovered matrix is all live provider, repeated lifecycle, idle CPU/RAM/network and multi-instance cells above. No runtime improvement or compatibility pass is claimed.
