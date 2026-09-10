# Source context refresh review

## Review outcome

External history previously omitted context hydration, and managed CLI hydration and billing events treated cumulative totals as current context. Codex now supplies the last reported request footprint and window; Claude supplies the latest prompt footprint including cache reads/writes. Missing capacity remains unknown. No billing records, provider files or schemas are changed; historical cleanup is unnecessary.

One review finding was fixed before handoff: the bounded reader discarded its first line even when the 2 MiB boundary was exactly the start of a complete record. It now probes the preceding byte and preserves complete records; a regression test covers this boundary.

Architecture review covers all ten layers: compilation, shared ownership/dead code, naming, token/session semantics, unknown defaults, provider boundaries, readability, camel-case wire serialization, hydration/refresh parity, and source fallback symmetry. No additional blocking source finding was identified. UI work adds a shared Button to the existing popover; this is not a component refactor. Native visual behavior and operational performance have not been measured.

| Area               | Verdict | Evidence                                                                                      | Change or reason kept                                                                                           | Verification                                 |
| ------------------ | ------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Background work    | fix     | Hydration, explicit click and CLI billing invalidation only                                   | No polling; blocking reads run in spawn_blocking; bounded 2 MiB tail plus one boundary byte; indexed paths only | Raw JSONL reader tests                       |
| Memory             | fix     | Shared command/session map has at most 8 in-flight entries                                    | Completed reads are removed; bursts retain one pending read and one queued flag                                 | API bound/retry and handler coalescing tests |
| Scope/isolation    | fix     | Current native binding resolves managed sessions; UI reads guarded by identity and generation | Switch, reset and disposal reject stale completions                                                             | Refresh/handler tests                        |
| Rendering/hot path | fix     | Cumulative billing no longer writes context; snapshots preserve cache fields                  | Refresh fetches telemetry without transcript reload                                                             | CLI hydration and state projection tests     |

| Provider        | Raw transition                                                                      | App/UI state            | Topology/boundary            | Expected invariant                                   | Observed evidence   |
| --------------- | ----------------------------------------------------------------------------------- | ----------------------- | ---------------------------- | ---------------------------------------------------- | ------------------- |
| Codex           | token events, partial lines, compaction, rewrite, large tail, deletion              | temporary-file fixtures | parser/file reader           | latest request only; compaction invalidates old fill | Rust tests          |
| Claude Code     | repeated blocks, cache split, cumulative result, partial lines, compaction, rewrite | temporary-file fixtures | parser/file reader           | latest prompt; cache counted once; capacity unknown  | Rust tests          |
| Shared reader   | record exactly at bounded tail start                                                | temporary-file fixture  | file reader                  | complete first record preserved                      | new regression test |
| Managed CLI     | hydration, billing bursts, disposal, retry                                          | simulated session       | adapter/event handler        | no cumulative or stale write                         | frontend tests      |
| Claude/Codex    | launch, restart, rendered active-row refresh                                        | not run                 | real desktop                 | native binding accessible and UI correct             | not measured        |
| Cloud/other CLI | remote sync/reconnect                                                               | not run                 | remote/unsupported providers | source-backed capacity                               | no support claim    |

Performance verdict: blocked for real desktop CPU/RSS and topology evidence; automated bounds and lifecycle checks pass. Computer Use was not authorized, so no UI automation was used.

## Compatibility and next steps

The three new local Tauri read commands require frontend/backend updates together. Wire data is additive and no persistence migration is needed. Reverting the feature is sufficient rollback. Legacy chunks-only CLI sessions, providers without telemetry, unindexed native paths and cloud-only sessions remain unknown. A telemetry event outside the bounded tail also returns unknown.

1. Validate Codex and Claude native sessions in the desktop app: refresh, append, compaction, switching, loading/error states, and idle/hidden CPU/RSS.
2. Add an authoritative Claude capacity source before promising percentages; do not infer capacity from the composer's model or subscription.
3. Define source provenance and freshness metadata before adding cloud telemetry transport or more CLI providers.
