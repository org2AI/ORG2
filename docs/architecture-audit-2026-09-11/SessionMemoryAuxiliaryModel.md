# Session memory auxiliary model selection

Scope: [issue #1579](https://github.com/org2AI/ORG2/issues/1579). This change repairs auxiliary model selection and recovery for session memory and explicit `agent(model: "fast")` dispatch.

## Source and invariant

The authoritative memory is `agent_sessions.sm_content` and `sm_last_seq`, written together by `save_session_memory_state`. The producing path is post-turn dispatch → memory coordinator → fresh provider → extraction → persistence. Previously, extraction and explicit fast subagents used a model-name substring to choose an unconditional sibling while retaining the parent's provider connection.

The factory derives an ordered low-cost policy from the same credential snapshot that constructs the transport. The September 12 revision replaces the original parent-retention policy: Codex OAuth tries enabled Luna, then Terra; API providers use their supported cheaper tiers. Candidates must appear in both the available and enabled catalogs. Catalog membership permits an attempt, not a claim of entitlement. Anthropic dot, hyphen, dated, and supported Bedrock aliases match while preserving the original enabled wire ID. Aggregator vendor namespaces are normalized for comparison only. Unknown deployment IDs and multi-provider reliability chains have no certified candidate and skip.

An explicit model-unavailable error advances to the next cheap candidate, up to three candidates per route. There is no expensive-parent fallback. Rejections survive successful extraction and new provider instances in the same session. Empty/exhausted candidates produce `Skipped`, no user warning, and no memory write. An explicit `agent(model: "fast")` request with no candidate returns a tool error before launch; ordinary omitted-model inheritance is unchanged. Other request errors do not change models. Existing transient-provider/incomplete-output retry budgets and the coordinator's 60-second deadline remain.

The preference table is a supported low-cost tier list, not live price discovery. xAI's retired Fast IDs are excluded because they [redirect to higher-priced Grok 4.3](https://docs.x.ai/developers/migration/may-15-retirement). No replacement cheap xAI tier is certified by this revision. Groq uses its [GPT-OSS 20B tool-capable model](https://console.groq.com/docs/tool-use/overview); Google prioritizes [Flash-Lite tiers](https://ai.google.dev/gemini-api/docs/pricing). No model is enabled automatically and no credentials or account selection change.

Failed/deferred extraction does not write durable memory or its boundary. Existing empty memory needs no destructive cleanup: a later successful extraction can use retained history. This change does not repair the separately identified runtime-before-persistence commit ordering or restart growth-baseline issues.

## Architecture review

| Layer                      | Verdict          | Evidence / decision                                                                                                                                                             |
| -------------------------- | ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation             | pass             | Agent-core targeted suites passed; `cargo clippy -p agent_core --all-targets -- -D warnings` passed                                                                             |
| 2. Ownership / duplication | fix              | Removed the name-only hint and its five naming-only tests; memory and fast subagents consume the same provider policy                                                           |
| 3. Naming                  | keep with reason | Auxiliary policy describes a preference constrained by a route, not universal model support                                                                                     |
| 4. Semantic boundaries     | fix              | Model family, provider wrapper, auth method, endpoint, catalog presence, and enabled status remain distinct                                                                     |
| 5. Defaults                | fix              | Unknown capabilities skip; no expensive-parent fallback                                                                                                                         |
| 6. Domain boundaries       | fix              | Factory owns credential/transport resolution; extraction receives a credential-free selection                                                                                   |
| 7. Readability             | keep with reason | Selection, typed model rejection, recovery, and persistence have explicit owners                                                                                                |
| 8. Wire                    | verify           | Loopback test uses real Codex serialization, HTTP error classification, and ReliableProvider; asserts model, reasoning effort, endpoint, and omitted unsupported request fields |
| 9. Entry-point parity      | fix              | Both post-turn extraction and subagent model resolution use LLMProvider::auxiliary_model; factory test distinguishes API-key and OAuth clients behind ReliableProvider          |
| 10. Resolver symmetry      | fix              | Client and policy share one credential snapshot; retry scope incorporates account, endpoint, provider/auth/protocol, catalog, and parent/candidate                              |

No TypeScript/IPC payload, database schema, persistence format, dependency, or lockfile changes. The Rust provider trait adds a default implementation so unknown adapters remain conservative. No frontend component audit applies.

## Resource ownership and lifecycle

The memory coordinator retains one active and one latest pending job per session/kind. New turns, session teardown, and deadlines keep their existing cancellation/cleanup paths. New rejection state is owned by SessionMemoryState and holds only the latest acquisition-scope hash, model route, a three-bit rejection mask, a cooldown timestamp, and one warning record. It has no global registry, worker, timer, or polling loop. Rebuilding a provider on the next turn does not lose a rejection. Changing account/endpoint/catalog/parent/candidate resets the route; dropping the session state releases it.

Model-unavailable and authentication failures cool down for five minutes. Each eligible job reads current account/routing metadata in a blocking worker, then checks cooldown before polling the provider-acquisition future. A deferred job performs no OAuth preflight, client construction, transcript load, or LLM call. Acquisition errors retain ProviderError until the shared failure classifier records the category and deadline. The acquisition scope includes account, endpoint, provider/auth/protocol, catalog, parent model, and native-harness type. It deliberately excludes health, refresh-failure counts, updated_at, token rotation, and the master enabled flag (which OAuth failure bookkeeping also changes), so a failure cannot invalidate its own cooldown. Same-route reconnection/re-enabling may wait for the existing deadline; changing account or endpoint bypasses it. Unavailable-model skips are silent. Other identical warnings are suppressed for five minutes, while a different error category can surface immediately. Success clears failure/cooldown/warning state and retains rejected candidates for the same route. Warning text uses fixed categories rather than upstream response bodies.

| Area               | Verdict | Evidence                                                                        | Change or reason kept                                                                                                                              | Verification                                                                                                |
| ------------------ | ------- | ------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Background work    | fix     | Repeated invalid requests previously followed every eligible turn               | At most three cheap candidates, never the parent as fallback; no provider acquisition, transcript load, or LLM call during the same-route cooldown | Loopback request sequence; failure/cancellation tests; existing coordinator deadline and cancellation tests |
| Memory             | fix     | A provider-local rejection would disappear when the next job creates a provider | Constant number of fields per session; only the most recent route is retained                                                                      | Rejection survives success and fresh provider instances; route reset tests                                  |
| Scope/isolation    | fix     | String-only family matching omitted account/auth/endpoint                       | Acquisition metadata scope plus resolved model route; literal custom IDs stay unchanged                                                            | Account, endpoint, auth, catalog, model, harness and failure-bookkeeping scope tests                        |
| Rendering/hot path | keep    | No component, stream-delta, or render path changed                              | Warnings still use the existing event channel                                                                                                      | Warning category/dedup tests; real SDE/member success paths exercised                                       |

Lifecycle coverage: selection/recovery during active work and route changes is automated; cooldown is tested with explicit Instant values without waiting or adding timers; session cancellation, pending-job coalescing, teardown sealing, and timeout cleanup use the existing coordinator tests. No new background activity is introduced for idle/hidden views. Packaged measurements and real-account results are recorded in the [device acceptance report](../org2-performance-guard-2026-09-12/SessionMemoryAuxiliaryModel.md). Coordinator continuation and broader lifecycle cells remain blocked/incomplete.

## Evidence limits and rollout

The loopback rejection reproduces the exact Codex HTTP 400 from the issue and drives the production extract-and-persist boundary against SQLite. A stale-candidate test override is used deliberately to exercise recovery; production Codex OAuth policy selects enabled Luna/Terra only. Generic errors, auth/rate limits, cancellation, single/empty/exhausted cheap candidate lists, unchanged persisted memory on failure, and cooldown warning deduplication are also covered. The acquisition regression uses a temporary KeyService and the real factory OAuth preflight with missing Claude access/refresh tokens: it produces a typed AuthError locally, with no upstream request. Three eligible attempts enter preflight once, retain the prior SQLite content/sequence, and keep the authentication warning category. Changing the route permits acquisition and successful persistence again. Another test proves an AuthError from chat also suppresses the next fresh-provider acquisition. State tests use explicit Instant values to verify the five-minute deadline and reset behavior without timers or sleeping. The seed helper now supplies the schema-required session name and uses a strict INSERT, so persistence tests cannot pass after silently ignoring a missing session row.

Historical pre-cheap-only-policy real-device SDE two-turn extraction and four Agent Org member extractions passed using a separate existing local Codex OAuth account. Coordinator continuation failed at native/canonical history synchronization before the next provider request; Anthropic OAuth was revoked. New synthetic test sessions were created and their authoritative rows inspected. The original session memory stayed unchanged. See the linked device report for CPU/RSS/footprint, failure evidence and untested cells. The issue reporter’s exact account and injected-failure toast behavior remain unverified.

Rollback: revert the code change. Durable schema and memory format are unchanged; transient retry state disappears with session/runtime teardown. Existing summaries remain readable.

Performance verdict: blocked — packaged measurements and real Codex SDE/member evidence are available, but coordinator continuation fails, Anthropic authentication is revoked, and elevated post-team idle CPU/repeated-cycle retention remain unresolved. No runtime performance improvement is claimed.

## Executed checks

Commands below ran from `src-tauri/`:

- `cargo check -p agent_core --all-targets` — passed on the initial PR revision; the follow-up was compiled by the tests and all-targets Clippy below
- `cargo test -p agent_core core::providers --lib` — 490 passed
- `cargo test -p agent_core session_memory --lib` — 55 passed
- `cargo test -p agent_core resolve_subagent_model_tests --lib` — 10 passed
- `cargo test -p agent_core specialization::memory::background --lib` — 9 passed
- `cargo test -p agent_core core::session::turn::post_turn::tests --lib` — 4 passed
- `cargo clippy -p agent_core --all-targets -- -D warnings` — passed

`git diff --check` passed. Suite counts overlap; they are not a count of distinct tests. This follow-up addresses the review of `41bedc7c3`: canonical Anthropic alias matching and authentication cooldown at provider acquisition. All 10 architecture layers were revisited; no UI, schema, IPC, or new background loop was introduced.
