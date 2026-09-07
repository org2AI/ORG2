# DocumentOpenMenu performance guard

| Area               | Verdict | Evidence                                                                                                      | Change or reason kept                                                                                                            | Verification                                        |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| Background work    | keep    | OS lookup starts only on menu expansion on macOS; no timer, scan, watcher, network call or startup effect     | NSWorkspace queries and launch/file validation use spawn_blocking; closing cancels UI delivery, bounded native lookup may finish | Demand/TTL tests and real native PDF discovery test |
| Memory             | keep    | Module cache retains at most 32 file keys including pending requests; native result capped at 64 apps per key | Completed entries evict by recency, lazy 60s TTL, failures evict, saturation rejects without creating more work                  | Completed and pending capacity tests                |
| Scope/isolation    | keep    | Cache key is exact local path in this webview; only OS handler metadata, no file contents or cloud/user data  | Different files preserve per-file associations; keyed component remount and effect cancellation reject late UI completion        | File-switch test, exact-path forwarding test        |
| Rendering/hot path | keep    | State belongs to menu, no global React subscription                                                           | Startup/file switching does not query handlers; state resets in expansion event                                                  | Component mount, platform and dirty-state tests     |

Lifecycle: app start/idle/hidden/focus return creates no scheduled work; active expansion performs one bounded lookup; close/unmount prevents result delivery; repeat expansion uses the shared cache. Native in-flight work finishes without UI delivery after close. No network, authentication, sync, provider or session lifecycle applies. Cache lifetime ends with the webview and is capacity bounded throughout. No automatic external-file reload was added.

Verification:

- `pnpm test src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/CodeViewerContent/DocumentOpenMenu`: 8 tests passed
- `pnpm typecheck`: passed in the isolated PR worktree based on current origin/develop
- `pnpm exec eslint src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/CodeViewerContent/DocumentOpenMenu src/modules/WorkStation/CodeEditor/Panels/EditorMainPane/content/CodeViewerContent/views/BinaryView.tsx --max-warnings 0`: passed
- `cargo test --manifest-path src-tauri/Cargo.toml -p system_services document_apps --lib`: 3 tests passed, including native macOS PDF handler discovery without launching an app
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p system_services --lib -- -D warnings`: passed
- `git diff --check`: passed in the isolated PR worktree
- Actual Tauri UI layout, external app launch, visible/hidden CPU/RSS measurements, and Windows/Linux execution: not run; desktop control has not been authorized and only this macOS environment is available

Performance verdict: blocked — code-level demand, bounds and stale-result invariants are tested, but actual desktop visible/hidden/post-close CPU/RSS and launch interaction have not been measured. No runtime performance improvement is claimed.
