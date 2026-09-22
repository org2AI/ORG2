# Native minimap menu freeze

A read-only `sample` of the hung ORG2 process showed AppKit native menu tracking on the main thread, reentering a WebKit URL-scheme callback, then `tauri_plugin_fs::commands::open`, blocked in `Webview::resources_table` / `Mutex::lock`. The installed Tauri 2.10.3 `menu/plugin.rs` popup command retains that same resource-table guard across `menu.popup_inner`. The popup cannot return while the nested filesystem command waits for its lock. The JavaScript menu gate prevents duplicate menus, but cannot prevent unrelated filesystem IPC.

The new `popup_native_menu` command looks up an owned `Arc<Menu>` in the calling WebView's resource table, drops the guard, then calls the native popup API. The menu stays alive for tracking. The shared frontend menu owner calls this command, retaining its existing gate, cursor fallback, error propagation, and resource cleanup. Every native menu caller uses this owner; this is one shared lock-boundary fix, not a minimap-specific workaround.

The position wrapper preserves Tauri's Logical/Physical serialized enum shape. The command accepts only an existing menu resource from the calling WebView and the current window; it exposes no arbitrary file or cross-WebView access. No dependency or persistence changes. Frontend and backend must deploy together; there is deliberately no fallback to the deadlocking plugin command. Reverting requires reverting both the frontend call and backend registration, and restores the original deadlock risk.

| Area               | Verdict | Evidence                                                                          | Change or reason kept                                   | Verification                                                      |
| ------------------ | ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------------------------------- |
| Background work    | fix     | Native tracking reenters filesystem IPC on the main thread                        | Drop table guard before popup; no new timers or polling | Hung-process stack and Rust reentry regression                    |
| Memory             | keep    | Owned menu Arc survives table-entry removal; JS owner closes resource after popup | Resource ownership stays bounded to one popup           | Rust ownership assertion; existing JS cleanup tests               |
| Scope/isolation    | keep    | Lookup uses calling WebView's table; popup uses current window                    | Shared gate remains per WebView and survives HMR        | Existing busy/HMR tests; source boundary inspection               |
| Rendering/hot path | fix     | Main thread blocked on table mutex throughout sample                              | Lock held only for resource lookup                      | Rust callback can acquire same table; invalid lookup also unlocks |

Architecture review: layer 1 compilation/tests recorded below; layer 2 shared owner and call-site sweep; layer 3 typed Resource/Arc ownership; layer 4 names distinguish resource lookup from popup; layer 5 invalid-rid and popup failures propagate with cleanup; layer 6 generic shared menu boundary; layer 7 documented nested-event-loop hazard; layer 8 resource ID and Logical/Physical position serialization tests; layer 9 command registered in the production handler list and shared by all callers; layer 10 positioned and cursor popup both use the unlocked backend path. No domain schema, provider ingestion, or multi-field persistence resolver applies.

Verification:

- `sample <hung-org2-pid> 2 -file /tmp/orgii-minimap-hang.sample.txt` — observed deadlock before changes; raw sample kept outside the repository
- `pnpm test src/util/platform/tauri/nativeMenuPopup.test.ts` — 14 tests pass in the isolated PR worktree
- `pnpm exec eslint src/util/platform/tauri/nativeMenuPopup.ts src/util/platform/tauri/nativeMenuPopup.test.ts` — pass
- `pnpm typecheck:fast` — pass
- Isolated `rustc --edition=2021 --test` harness imports the production `native_menu.rs` module, links the existing Tauri rlib via `--extern tauri` and its dependency directory, with `CARGO_PKG_NAME=org2`; `/tmp/orgii-native-menu-tests --nocapture` — 2 tests pass. Harness-only unused-command warning; production command is registered in `handler_list.inc`
- Full `cargo test -p org2 --lib native_menu::tests --no-default-features` — completed before cancellation: 2 tests pass, 1,361 filtered out. Linker warns that the test binary unwind section exceeds 16MB
- Dev binary inspected and contains the new command; development watcher rebuilt/restarted independently
- `git diff --check` scoped to the native-menu files — pass

Performance verdict: blocked — root-cause stack and lock regression are verified, but native right-click interaction after rebuild was not exercised because desktop control requires user opt-in. No claim of measured post-fix CPU/RSS or cross-platform popup validation.
