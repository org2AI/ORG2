# Claude isolated launch boundary

## Root cause and source invariant

The authoritative native record is Claude's JSONL under its effective `CLAUDE_CONFIG_DIR`. An own-key launch without a persisted account previously left that variable unset. In an isolated desktop the child inherited the real user's default profile while ORG2 discovery used `ORGII_EXTERNAL_HISTORY_HOME`. A real Claude response therefore rendered locally but cloud body publication failed with history file not found.

The launch boundary now resolves an ambient isolated config under the external-history root. Explicit account and hosted-session profiles keep their precedence. Non-isolated ambient launches retain existing native settings. Every selected Claude directory must be created successfully before spawn; failure propagates instead of falling back to an inherited profile. No discovery roots are broadened and no historical files are moved or deleted. Existing files written outside isolation require a separately authorized recovery decision.

## Architecture review

| Layer                      | Coverage and verdict                                                                                                                                        |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation             | app_paths: 38 passed; app launch profile regressions: 3 passed                                                                                              |
| 2. Ownership/deduplication | Central path resolver owns isolation-root policy; runner owns filesystem preparation and child environment                                                  |
| 3. Naming                  | Helper explicitly names isolated ambient Claude configuration                                                                                               |
| 4. Semantic scope          | Discovery root and native-publication override remain distinct; this default launch must be discoverable                                                    |
| 5. Defaults                | Own-key without account is valid; isolated and ordinary ambient behavior are explicitly distinguished                                                       |
| 6. Cross-domain boundaries | app_paths depends on no account/domain enums; runner resolves KeySource                                                                                     |
| 7. Readability             | Launch comment states write/read invariant and error consequence                                                                                            |
| 8. Wire/persistence        | No RPC, schema, serialization, credential, or transcript-format changes                                                                                     |
| 9. Initialization parity   | Direct and launcher-created isolated instances use the same external-history override; managed proxy profiles already own their config and remain unchanged |
| 10. Resolver symmetry      | Child's ambient profile is `<external-history-home>/.claude`, the same root used by Claude history discovery; account and managed roots remain discoverable |

## Performance and lifecycle

Only launch-time path resolution and one directory creation are changed. The production caller already performs profile setup in `spawn_blocking`; no new timer, scan, watcher, cache, or retained state exists. Idle/hidden/offline behavior is unchanged. Preparation failure returns before child spawn and native sync cannot be handed a transcript written by this launch to an unintended default home. Restart uses the same deterministic root.

Verdict: bounded launch work by code inspection and filesystem regressions. Full desktop/bilateral, idle/RSS, restart, Windows, and Linux acceptance remain unverified. The earlier real desktop run failed body publication and is not a passing continuation test. Its test setup also failed to persist the named account/model; the next run must assert both rendered selection and stored launch fields.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml -p app_paths --lib`: 38 passed.
- `cargo test --manifest-path src-tauri/Cargo.toml -p org2 --lib agent_sessions::cli::session_runner::env_setup::tests -- --test-threads=2`: 3 passed; covers inherited config override, ordinary ambient preservation, and directory-creation failure.
- `git diff --check`: passed.
- No UI changes; screenshots are not applicable to the code diff. Rendered sharing acceptance remains required before claiming the broader stack verified.
