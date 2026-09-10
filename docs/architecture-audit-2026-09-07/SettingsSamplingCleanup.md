# Retired settings sampling cleanup

Completion criteria: delete sampling exclusively owned by removed Device & Network settings; preserve callers outside those pages; remove command registrations and wire-only types; compile the affected crates and verify retained memory behavior.

| Layer                | Verdict / evidence                                                                                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation        | Frontend typecheck, lint, and 8 shared-memory tests pass; Rust check passes without warnings, perf_utils tests: 64 passed / 1 ignored; LAN-IP test run blocked by recurring app-build lock                                                    |
| 2 Dead code          | Removed detect_vpn and platform interface scanners; removed get_tool_process_memory_diagnostics_v1, diagnostics collector/classifier, Rust/TS diagnostic types and re-exports, and inventory virtual-memory field used only by that collector |
| 3 Naming             | Network module description now lists geolocation and LAN IP discovery; app-memory comment no longer promises the removed diagnostics command                                                                                                  |
| 4 Semantics          | Tool-process RSS diagnostics were separate from authoritative app-memory totals; removing their collector does not change the snapshot ownership/exclusion rules                                                                              |
| 5 Defaults           | Remaining snapshot fallback and region/LAN behavior unchanged                                                                                                                                                                                 |
| 6 Boundaries         | Deleted exclusive code at Rust command and frontend type boundaries, preserving shared process inventory/ownership helpers                                                                                                                    |
| 7 Clarity            | No dangling sampler references; handler list only advertises surviving commands                                                                                                                                                               |
| 8 Wire               | Two internal Tauri commands removed with their only app consumers. Existing public app-memory snapshot and geolocation shapes unchanged                                                                                                       |
| 9 Init               | Generated handler expression uses edited handler_list.inc; no new initialization or background owner                                                                                                                                          |
| 10 Resolver symmetry | No data resolver/fallback chain change                                                                                                                                                                                                        |

## Retained production callers

- `fetch_geo_info`: `useRegionCheck` → ChatPanel agent presentation and Settings region notice; 30-minute cache and in-flight sharing remain.
- `get_local_lan_ip`: Mobile Remote address/QR setup.
- `get_system_memory`, `get_system_info`, `system_runtime_snapshot`: member-runtime payload and hardware reporting.
- `get_process_metrics`: diagnostics aggregation.
- `get_app_memory_snapshot_v1`: shared app-memory hook used by sidebar/runtime diagnostics.
- `descendant_depth`, process ownership and platform collectors: still used by authoritative app-memory snapshot, including Windows webview ownership.

No inference of dead code from registration alone: removed commands had no surviving app, script, tool, or test caller after page deletion. Generic unused APIs predating these pages were not treated as settings-owned. No schema/data migration or dependencies changed. Unknown external scripts invoking removed internal commands would receive an unknown-command error; rollback is restoring this deletion and rebuilding. Existing installed builds are not mutated.
