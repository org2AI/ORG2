# Terminal exit identity

PR #1781 follow-up fixes the P2 delayed-exit regression. The authoritative source is the native PTY registry. Previously, removal checked reader identity but emitted only an unversioned session-ID event. A replacement listener could consume that event, unregister its own scheduler, and reject all later output.

Each native PTY now receives an immutable process-local generation, serialized as a decimal string. Create and attach return the generation. Both native exit emission paths include the captured generation and attachment owner. Normal EOF removal captures the event under the registry lock. Frontend exit handling checks the owner immediately and the generation after create/restore resolves, before rendering or unregistering. A pending exit retains its identity in one slot; no timer, listener, scan, or growing collection is added.

Historical remediation: none. This is transient event/scheduler state, not persisted pollution. Reopening an affected terminal restores a live attachment.

## Lifecycle and resource review

| Area               | Verdict | Evidence                                                           | Change or reason kept                                                   | Verification                                                                          |
| ------------------ | ------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Background work    | keep    | Existing reader and exit listener lifecycle                        | No additional polling, worker, subscription, or retry                   | Terminal Rust and frontend suites                                                     |
| Memory             | keep    | One native identity, one captured event, one pending frontend exit | Constant retained state per connection; native counter is constant-size | Source inspection and connection teardown tests                                       |
| Scope/isolation    | fix     | Event generation and owner survive removal/recreation              | Stale exits cannot unregister the replacement pane                      | Native production removal/serialization test; frontend live/create/attach regressions |
| Rendering/hot path | keep    | Only terminal-finality handling changes                            | Existing raw-byte decode, buffering, ACK and drain behavior retained    | Split-UTF-8, scheduler and final-output-before-banner tests                           |

Covered states: native removal/recreation, stale reader removal, attachment replacement, live exit, exit during create, exit during attach/restore, valid final output, and legacy handshake. The generation remains stable across attachment-owner changes. Both native exit emission sites were updated. The separate ChatPanel exit observer ignores payload fields and remains wire-compatible; it does not own or unregister the terminal scheduler. No adjacent status-management behavior was changed.

Architecture layers 1–10 covered: compilation/tests, shared identity ownership, naming, native-generation versus attachment-owner semantics, legacy/live/restore defaults, shared agent/interactive creation, lifecycle clarity, IPC serialization, create/attach parity, and identity resolution. No layer skipped. No action controls or visual layout were changed, so a UI-consistency audit and screenshots add no evidence for this event-ordering fix.

## Compatibility and recovery

`create_pty` now returns an identity object, attach adds `session_generation`, and exit payload changes from null to `{session_generation, owner_id}`. Existing callers that ignore results/payload fields remain compatible. New frontend code accepts null exits only when its handshake supplied no generation; paired releases require generation and owner. Native generations are process-local because no PTY or queued native IPC survives native process exit. No persistence, dependency, or schema change. Revert frontend/native together and reopen affected terminals to roll back. The pre-existing cross-webview clock-based attachment-owner ordering limitation is unchanged.

## Verification

- `cargo test --manifest-path src-tauri/Cargo.toml -p terminal --lib --locked`: 91 passed, one existing helper ignored; includes real macOS PTYs and native delayed-exit identity capture.
- `cargo clippy --manifest-path src-tauri/Cargo.toml -p terminal --all-targets --locked -- -D warnings`: passed.
- `pnpm exec vitest run --config config/vitest.config.ts --maxWorkers=2 src/engines/TerminalCore/components/TerminalInteractive/__tests__`: 138 passed.
- `pnpm exec tsgo --noEmit --pretty false`: full-project check passed.
- `pnpm exec eslint src/engines/TerminalCore/components/TerminalInteractive/terminalPty.ts src/engines/TerminalCore/components/TerminalInteractive/__tests__/terminalPty.connection.test.ts`: passed.
- `git diff --check`: passed.

Frontend checks used the existing shared dependencies (Vitest 4.1.11). Windows/ConPTY, Linux, native UI/multi-window rendering, and sustained CPU/RSS measurements were not run. No runtime performance improvement is claimed.

Performance verdict: blocked for unmeasured native platform/resource cells; the identified stale-exit lifecycle failure is fixed and regression-tested.
