# Mobile session search integration

## Contract and ownership

The running desktop checkout lacked the mobile search implementation present in the mobile feature checkout. `initialize` now advertises `sessionSearch` together with an implemented `session/list(query, offset, limit)` path. No-query listing is unchanged. Search reads the existing `orgtrack_core_sessions` title index, hydrates through the same native/imported-history directory boundary, and returns existing mobile row projection plus `nextOffset`/`hasMore`. No schema, credentials, pairing, history writes or historical cleanup are needed.

Mobile owns transient query intent and the existing latest-only request generation. Desktop owns the authoritative indexed records. Search is literal substring matching (SQLite lower for ASCII case folding), not full-message search or an external-history rescan. Source providers retain their existing ingestion/visibility rules.

## State and verification matrix

| State / transition | Contract | Evidence |
| --- | --- | --- |
| Old desktop / unavailable | Show unsupported warning and Cancel; do not claim indexed search scope | SessionsScreen.features regression |
| Initialize / supported | Capability corresponds to a real implementation behind initialized connection | RPC initialize and read-only validation tests |
| Query / loading / results | Query database before pagination, not the loaded sidebar snapshot | SQL fixture finds row 151 with page size 50; request path bypasses snapshot |
| Empty / terminal page | Return explicit empty rows and cursor/exhaustion | SQL exhausted-page and hydration-page tests |
| Hidden or deleted result | Cursor consumes candidate rows even if hydration drops them; lookahead is not hydrated | Hydration cursor regression |
| Invalid query / cursor | Reject before database access; cursor stays JavaScript-safe | Real RPC dispatcher tests |
| Database failure | Propagate failure, do not report empty success | Hydration failure regression |
| Cancel / retry / switch / offline | Retain existing mobile generation and latest-only scheduler policies | 21 useMobileSessionSearch tests plus 18 screen tests |
| Desktop restart / phone reconnect | Negotiate new capability and exercise real phone search | After approved restart, iPhone 17 Pro simulator automatically reconnected; the real search field opened and `chat` returned matching history including August entries |

## Performance guard

| Area | Verdict | Evidence | Change or reason kept | Verification |
| --- | --- | --- | --- | --- |
| Background work | keep | Search runs only on explicit requests, within spawn_blocking | No new timer, subscription, history scan or background task | Call-chain review; mobile lifecycle tests |
| Memory | keep | SQL LIMIT page size + 1; request maximum 200; only page rows hydrated | No cache or app-lifetime collection added | SQL page-size test; lookahead hydration test |
| Scope/isolation | keep | Same paired desktop/database and existing auth initialization gate | No new identity, credentials or storage scope | RPC initialize/read-only tests; mobile switch/stale-result coverage |
| Rendering/hot path | keep | Existing response validation and generation guard | Unsupported scope text follows capability; no per-stream work | Screen tests; typecheck |

Performance verdict: blocked for remaining measurement only. Restart recovery and real search response are now verified through the simulator's user-visible UI. Physical-phone latency and hidden-idle CPU were not measured. Query uses a bounded result set but substring matching may scan eligible indexed titles; no latency improvement is claimed. Offset ordering is stable for equal timestamps, but concurrent index mutations can move rows between pages as with ordinary offset pagination.

## Architecture review

Layers 1–10 considered within the search integration only: compilation; one shared hydration boundary rather than duplicated converters; explicit name-search naming; distinction between indexed history and sidebar snapshot; absent query preserves existing behavior; directory access stays in aggregation; request path documented; additive capability/query/cursor contract; LAN/Relay both dispatch through initialize; list and search reuse the same field hydration/projection. No unrelated queue, provider-ingestion, session-startup or schema refactors. Raw-provider transition and dual-machine sync tests are outside this read-only search change and are not claimed.

## Checks

- `cargo test --lib agent_sessions::session_directory::aggregation -- --test-threads=1`
- `cargo test --lib api::mobile_bridge::rpc -- --test-threads=1`
- `cargo build --bin org2` (existing macOS linker unwind-size warning)
- Mobile checkout: targeted screen/search-hook tests, `pnpm typecheck:fast`, scoped ESLint, `pnpm build:mobile-native`, `git diff --check`

Rollback removes the additive desktop search integration and leaves old clients/listing intact; mobile detects the absent capability. No persisted migration or data rollback is required. Do not replace the modern desktop with the older feature checkout just to enable search.
