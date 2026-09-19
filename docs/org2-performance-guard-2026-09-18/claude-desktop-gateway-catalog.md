# Claude Desktop gateway catalog audit

Scope: PR #1985; the startup backfill and the added gateway publication path.
No real provider profile or transcript was modified by the automated audit.
The isolated fixture tests do not establish Desktop UI, routing or billing behavior.

## Findings and corrections

| Line / element                                     | Verdict                         | Reason                                                                                               | Change                                                                                                                                                       |
| -------------------------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `refresh_bound_native_catalog` gateway publication | fix                             | The original extension reused the official updater, overwriting Desktop-owned title/model/turn count | Distinguish official refresh from gateway insert-only publication; every existing gateway row remains byte-identical, including previously ORG2-created rows |
| Backfill `exists` then atomic replacement          | fix                             | Desktop does not take ORG2's lock and could create a row between inspection and rename               | Stage and fsync a complete file, then atomically create the destination via a file hard link; an existing name wins; no profile directories are linked       |
| Catalog JSON parsing                               | fix                             | Entry-count bounds alone did not bound allocation for an unexpectedly large file                     | Read at most 256 KiB plus one byte; reject oversized or non-regular metadata, including symlinked rows                                                       |
| Startup insertion limit                            | keep                            | The 512 limit counts successful new inserts, not already-listed rows                                 | A 513-row fixture must advance 512 → 1 → 0 over three starts                                                                                                 |
| First gateway profile registration                 | keep with documented limitation | Backfill runs once at ORG2 startup; a profile first created later is not immediately picked up       | Open gateway mode once, then restart ORG2; no polling or new entry point added                                                                               |
| Discovery scan horizon                             | keep with documented limitation | At most 2,048 project entries / 10,000 metadata entries are scanned; no persistent scan cursor       | Histories beyond the scanned prefix are not guaranteed to appear on repeated starts                                                                          |

## Performance and lifecycle

| Area               | Verdict | Evidence                                                                                                 | Change or reason kept                                                                         | Verification                                                                          |
| ------------------ | ------- | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Background work    | keep    | One `spawn_blocking` task after startup reconciliation                                                   | No timer, watcher or retained worker; no added steady-state work while visible/hidden/offline | Source call-chain inspection; real cold-start/idle measurement remains pending        |
| Memory             | fix     | `listed` set bounded by 10,000 valid UUID entries; 512 insertions; transient JSON now bounded to 256 KiB | Large/corrupt provider metadata cannot force allocation of its entire size                    | Oversized-row regression and scan-budget fixture                                      |
| Scope/isolation    | keep    | `native_transcript_home_dir`, active UUID account and provider-created local org marker                  | Missing profile is a no-op; permissions use an explicit allowlist and safe defaults           | Isolated profile / grant stripping / no-profile tests; runtime account switch not run |
| Rendering/hot path | keep    | No UI change; completed-session publication gains one existing gateway catalog                           | Gateway rows are discovery metadata only; no startup transcript parsing                       | Unit evidence only; Desktop Code tab is a separate manual gate                        |
| Concurrent writers | fix     | Advisory locks protect ORG2 peers but cannot exclude Desktop                                             | Atomic create-if-absent, complete staged bytes, temporary-file cleanup                        | Desktop write during staging and competing-writer tests                               |

## Provider coverage

| Provider                | Raw transition                              | App/UI state                        | Boundary                          | Expected invariant                                               | Evidence                                          |
| ----------------------- | ------------------------------------------- | ----------------------------------- | --------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------- |
| Claude Desktop gateway  | Missing catalog                             | Isolated cold start                 | Local discovery                   | No profile created                                               | Unit test                                         |
| Claude Desktop gateway  | Existing/absent transcript                  | Isolated cold start, repeated start | Source catalog to gateway catalog | Only present transcripts registered; no duplicate or grants      | Unit test                                         |
| Claude Desktop gateway  | Existing native row                         | Completed ORG2 session publication  | Local writer                      | Title/model/grants and all bytes preserved                       | Regression test                                   |
| Claude Desktop gateway  | Concurrent row creation                     | Staged publication                  | Filesystem commit                 | Existing Desktop row wins without partial file                   | Regression test                                   |
| Claude Desktop gateway  | 513 eligible sessions                       | Three isolated starts               | Scan/insertion budget             | 512 then 1 then 0 inserted                                       | Regression test                                   |
| Claude Desktop gateway  | Append/continue history, live index refresh | Real Desktop                        | UI → provider → billing           | History resumes through gateway; restart requirement established | Not run by this audit; separate manual acceptance |
| Claude Desktop official | Restore normal mode                         | Real Desktop                        | Config → original account/catalog | Original sessions and login intact                               | Not run by this audit; separate manual acceptance |
| Claude Desktop Windows  | Same file publication                       | Native Windows                      | NTFS/profile discovery            | Equivalent safe create and correct profile path                  | Not run; Windows runtime remains unverified       |

## Architecture checklist

1. Compilation: targeted Rust tests and clippy are the local gates; record results below.
2. Ownership/deduplication: filesystem staging belongs to `native_store`; both gateway producers call the same insert-only primitive.
3. Naming: `RefreshOfficial` and `InsertGateway` distinguish the existing and new semantics.
4. Terms: Desktop catalog is discovery metadata; native transcript is conversation content; gateway here means Desktop's third-party deployment profile, not Market daemon identity.
5. Defaults: unknown/missing account UUID, origin, transcript or malformed JSON is skipped; permissions are never inherited.
6. Boundaries: Desktop knowledge remains in native materialization; generic storage owner knows only files.
7. Discoverability: documentation no longer claims that all official catalog paths are read-only; only the new backfill is read-only.
8. Serialized data: fixture assertions inspect stored JSON and grant stripping. No network schema changed; real provider calls are a separate acceptance gate.
9. Init parity: production startup invokes the tested backfill; first-use after profile creation requires another ORG2 start. Tests use isolated native homes, not real users' profiles.
10. Resolver symmetry: official refresh keeps previous behavior; gateway new rows require its own active account and registered local project. No identifiers are invented.

## Validation

Baseline before changes: `cargo test -p org2 --lib native_materializer` passed 44 tests, 1 intentional child-process helper ignored.
Updated local validation:

- `cargo test -p org2 --lib native_materializer`: 47 passed, 0 failed, 1 intentional child-process helper ignored; 8.34 seconds (final source recheck). Includes the 513-row continuation, oversized JSON and gateway preservation regressions.
- `cargo test -p org2 --lib native_store`: 5 passed, 0 failed, 1 intentional child-process helper ignored; 0.13 seconds. Includes external Desktop write and competing no-replace writers.
- `git diff --check`: passed.
- `cargo clippy -p org2 --lib --tests -- -D warnings`: passed (1m 51s). No Desktop runtime result is inferred from these tests.

Performance verdict: blocked for full runtime acceptance. Unit and source evidence cover bounded discovery and additive writes; real Desktop cold start, idle/hidden resource measurements, hot index discovery, history continuation, restore and Windows runtime were not performed by this audit.
