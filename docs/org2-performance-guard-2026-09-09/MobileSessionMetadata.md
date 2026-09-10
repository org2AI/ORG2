# Mobile session workspace metadata

## Source and scope

The authoritative workspace fields live in the session directory records, backed by the imported-history cache or native session storage. Read-only inspection confirmed the affected records still contained workspace paths and update timestamps. The desktop `session/list` projection reduced each record to id, name and status before serialization, losing workspace metadata. The installed mobile client only renders a workspace when `repoName` is present.

Preserve `repoPath`, `repoName` and the RFC3339 update time converted to `updatedAtMs` at the RPC-producing boundary. Preserve the same optional fields through the sidebar snapshot ingestion and serialization path. Missing metadata remains null, not an invented label. No persistence migration, historical cleanup, re-pairing, title change, filter change or ordering change is needed.

Compatibility: fields are additive and optional; legacy snapshot producers can omit them. Snapshot workspace strings and timestamps are validated before retention. Metadata-only changes participate in the existing equality/invalidation mechanism. Reverting the projection restores the previous response shape without modifying stored data.

## Lifecycle and edge cases

- Request: reuse the existing authenticated list path, status filter, bounded limit and send-capability lookup; serialize metadata only for requested rows
- Snapshot update: validate up to 200 rows, reject oversized metadata/invalid dates, compare the complete row, invalidate through the existing event only when changed
- Missing workspace/invalid directory time: return null; never infer workspace from a session title
- Offline/reconnect/start/shutdown: no new timers, retries, listeners or persistent state; reconnect fetches canonical data through the existing lifecycle
- Account/endpoint/secondary instance behavior is unchanged; this patch does not claim to repair existing app-lifetime snapshot isolation
- Provider parsing, discovery, rewriting and compaction are untouched; no provider lifecycle improvements are claimed

## Performance review

| Area | Verdict | Evidence | Change or reason kept | Verification |
| --- | --- | --- | --- | --- |
| Background work | keep | Existing RPC request and snapshot invalidation own work | No added polling, scan, query or listener | Call-chain review |
| Memory | keep | Snapshot remains capped at 200 rows | Optional path/name bounded to 4096/1024 bytes per row | Ingestion bound regression test |
| Scope/isolation | keep | Existing authenticated RPC and process-owned snapshot | No new identity cache or async writer | Source review; account-switch runtime test not run |
| Rendering/hot path | fix | Wire projection discarded existing metadata | Add three fields per requested row, preserve list semantics | Producing-boundary and snapshot serialization regressions |

## Verification

- `cargo test -p org2 --lib mobile_`: 98 passed, including directory wire serialization, sidebar metadata round-trip/bounds and existing order/status tests
- `pnpm exec eslint src/api/tauri/mobileRemote/index.ts`: passed
- `git diff --check`: passed
- No frontend files changed; post-rebase verification was scoped to the Rust producing boundary
- `cargo build -p org2 --bin org2`: passed; existing large `__eh_frame` linker warning remains
- Restarted the current-tree desktop and the installed iPhone app without changing pairing data. Real-device screenshots before/after confirmed `ORGII` workspace labels and update dates restored for the same session rows. No mobile reinstall was required
- The after screenshot still showed a desktop reconnect/offline banner despite having received the corrected list. Connection stability is a separate unresolved issue; this repair does not claim to fix it

No performance improvement is claimed from code shape alone.

Performance verdict: blocked for steady-state CPU/RSS across visible/hidden states and sustained reconnect stability. Functional metadata rendering is verified on the physical iPhone; no full-app performance or connection-stability pass is claimed.
