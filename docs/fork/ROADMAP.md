# Independent ORG2 Fork — Engineering Roadmap

**Status:** Planning and initial release-safety changes, not a production release.
**Repository:** https://github.com/TheerasakPing/ORG2
**Upstream:** https://github.com/org2AI/ORG2
**Tracking:** GitHub Issues are currently disabled on this fork; this file is the active task checklist until Issues are enabled.

## P0 — Safe ownership and packaging (must pass before installers)

- [ ] Select a final brand and domain; inventory ORG2 trademarks and upstream-only UI links.
- [x] Introduce original two-tone TP Agent Studio icons for desktop bundle, Dev and default live Dock; remaining tray, Store/mobile and legacy optional Dock variants need rebranding and platform validation.
- [x] Add provisional TP Agent Studio Tauri names/identifiers for main, dev and Windows; installer coexistence requires runtime acceptance tests.
- [x] Move the canonical application data root and runtime-default ports to fork-specific paths; external history and native transcript defaults are isolated. Remaining hard-coded legacy paths, runtime hooks and installer coexistence still require an end-to-end audit.
- [x] Disable base updater and custom Rust upstream update route for unreleased fork.
- [x] Remove clickable upstream installer links from fork README and clear the disabled Tauri updater manifest list.
- [ ] Replace remaining upstream public signing key, CI release dependencies and signing identities with fork-owned infrastructure.
- [x] Harden the explicit fork data-root guard against parent traversal, missing suffixes and symlinked ancestors; add focused Rust and fork-safety tests.
- [x] Align fork frontend runtime ports and OAuth callback schemes with embedded Rust application identifiers; include production/dev/numbered/E2E parity tests (CI evidence pending).
- [ ] **P0 Cloud ownership:** Fork defaults still reference the ORG2-managed Supabase/web backend and some Cloud parsers still accept only `orgii://` links. Configure fork-owned endpoints, secrets/credential namespaces and redirect allowlists; until then, prohibit real-account cloud onboarding and production distribution. See [Cloud boundary audit](FORK_CLOUD_BOUNDARY.md).
- [ ] Separate workspace-local `.orgii` metadata from upstream workspace metadata with opt-in migration, source-attributed ownership and rollback tests.
- [ ] Run same-machine concurrent-install and migration/rollback tests.
- [ ] Publish fork-built packages only after independent signing and end-to-end smoke tests.

**Acceptance:** a fresh fork installation cannot update from upstream, overwrite upstream binaries, or read/write upstream profiles unless the user explicitly approves migration.

## P1 — Reliability and security

- [x] Replace the production auto-dream acquisition path with a stable OS-level exclusive file lease, plus eight-contender, cross-process exclusion tests and portable rollback.
- [ ] Add multi-process crash/kill/restart, Windows/macOS/Linux lock test evidence and split committed timestamp from in-progress state.
- [ ] Add sandbox profiles for untrusted agent shell commands; separate read/write paths, environment secrets, network and process limits.
- [ ] Introduce versioned, transactional SQLite migrations with verification and recovery procedures.
- [ ] Classify transient vs permanent LLM reflection failures; TTL/backoff rather than permanent blacklist for transient errors.
- [ ] Add session crash/restart, cancel/resume, provider-retry-after-tool and background-process teardown fault injection.
- [x] Catch scheduler execute-factory panics, track dead worker handles, recover the queue on next enqueue, and persist failed session state; added targeted regression tests (final CI pending).
- [x] Continue independent startup reconciliation phases after a partial failure so stale in-flight session cleanup is still attempted; see [multi-session recovery audit](SESSION_STALL_RECOVERY.md).
- [ ] Implement bounded progress/heartbeat diagnostics for genuinely hung provider or Tool futures, with cancellation semantics that never replay side-effectful work.
- [x] Add bounded, synthetic Rust `DialogScheduler` stress tests for 1/5/20/50 concurrent sessions, targeted cancellation, dead-worker no-replay isolation and queue capacity (test code added; CI verification pending). See [Multi-Session Stress Lab](MULTI_SESSION_STRESS_LAB.md).
- [ ] Stress-test 1/5/20/50 concurrent sessions under load and validate clean shutdown/restart on all three platforms.

**Acceptance:** no double-owned memory consolidation; session/tool cancellation leaves no orphaned jobs; migration failures cannot leave an app silently running on a partially upgraded schema.

## P2 — Unified agent experience

- [ ] Define a shared session identity/event provenance contract for native Rust Harness and external CLI sessions.
- [ ] Preserve multi-agent task/call provenance across replay, forks, and resume.
- [ ] Build a unified runtime dashboard: tokens, costs, tool latency, retry reason, memory queue, session CPU/RAM, pending approvals.
- [ ] Add permissions preview and audit receipts for CLI, MCP, desktop and browser execution.
- [ ] Improve agent-team orchestration with role capabilities, checkpoints, budgets and human approval rules.

**Acceptance:** imported and native sessions produce equivalent timeline events; each tool effect has an auditable identity; users can reproduce errors from structured diagnostics.

## P3 — Product features and automation

- [ ] Task templates, scheduling and unattended execution with max-cost and max-runtime limits.
- [ ] Agent workflows that plan, implement, test, review and prepare PRs under explicit branch protection.
- [ ] Memory provenance inspector with conflict handling, expiration and per-workspace privacy controls.
- [ ] Portable session export/import and cross-device encrypted synchronization (opt-in).
- [ ] Consistent UX and full localization; accessibility and performance budgets.

## CI acceptance matrix

| Platform | Build | Unit | Native integration | Install/upgrade | UI E2E |
| --- | --- | --- | --- | --- | --- |
| macOS Apple Silicon | Required | Required | Required | Required | Required |
| Windows 11 x64 | Required | Required | Required | Required | Required |
| Linux x64 | Required | Required | Required | Required | Required |

Do not mark these checks complete based on source inspection; attach real logs, artifact hashes and CI run URLs.

## Upstream sync policy

- Prefer upstream security/fix updates before product-feature merges.
- Keep fork-specific release and identity configuration isolated in owned changes.
- For each upstream merge, rerun the fork-safety gate and release-install acceptance tests.
- Preserve `LICENSE`, copyright notices and upstream commit attribution.
