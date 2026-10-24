# Independent Fork Engineering Guide

This repository is the independent development fork maintained at **TheerasakPing/ORG2**.
Upstream: https://github.com/org2AI/ORG2 (tracked on branch `develop`).
**TP Agent Studio** is the provisional product name. Fork-specific desktop IDs and paths are being introduced, but complete isolation and production release readiness are still unverified.

## Current safety status

- **Fork exists** with its own GitHub ownership and history.
- **Not independently distributable yet.** Do not install test builds side by side with upstream ORG2.
- The base Tauri updater has `plugins.updater.active=false`, an empty endpoints list and `bundle.createUpdaterArtifacts=false`. Fork README no longer links to upstream production installers.
- The custom Rust `check_app_update` command is also fail-closed while `FORK_UPDATER_READY=false`. This prevents silently installing upstream's release packages through a separate code path.
- Original two-tone desktop icon artwork and generated macOS/Windows/Linux icon assets are introduced for production and Dev, with the default macOS live Dock variant included (see [branding guide](docs/fork/TWO_TONE_BRANDING.md)).
- Base and development Tauri identities, deep-link schemes, macOS signing placeholders, application data defaults, runtime ports, and external history defaults have been moved to **TP Agent Studio**. **This does not yet prove complete profile isolation**: external tool hooks, sidecars, inherited assets/credentials and fresh-install behavior require integration tests.
- The inherited `release.yaml` workflow is guarded to run **only** in `org2AI/ORG2`, not this fork. Do not tag/publish production releases until a separate fork release workflow has been validated.

## Fork strategy

1. Maintain `develop` as the integration branch and use feature branches and PRs for every production change.
2. Keep attribution and the existing `LICENSE` intact. This project is under **AGPL-3.0-or-later**; derivative distribution and network use must comply with its source-availability and notice obligations. Do not imply that the original upstream developers endorse the fork.
3. Track upstream separately using `git remote add upstream https://github.com/org2AI/ORG2.git` in local clones. Import security and correctness fixes deliberately, preferably through reviewed merge commits; never overwrite fork-owned release, updater, storage, or identity settings.
4. Keep reusable code in focused modules, maintain regression tests, and avoid changing production invariants merely to hide UI defects.
5. Prioritize macOS Apple Silicon, Windows 11 x64, and Linux x64 parity in CI, packaging, and runtime acceptance tests.

## Before enabling independent installation

- Choose final product name, domains, app ID and deep-link schemes. Update main and platform-specific Tauri configurations together.
- Partition every mutable state root (SQLite, settings, account tokens, sidecars, caches, session data, logs, WebSocket local ports, single-instance control). Provide explicit opt-in migration from upstream with backup and rollback.
- Replace upstream update endpoints in both `src-tauri/tauri.conf.json` and `src-tauri/src/app_update.rs`, as well as any frontend release/download links; generate **fork-owned updater signing keys**.
- Replace upstream Apple signing identity, Windows signing configuration, GitHub environments, release URLs and permissions. Never reuse another publisher's private key.
- Add and pass fresh-install, side-by-side-install, upgrade, rollback, and uninstall-with-data-retention tests on each platform.
- Only after those gates pass: set `FORK_UPDATER_READY=true`, re-enable updater artifacts, and configure the fork's signed release channels.

## Development and verification

```bash
pnpm install --frozen-lockfile
pnpm run download:sidecars
pnpm run tauri:dev
node scripts/fork/check-safety.mjs
node scripts/fork/check-identity.mjs
pnpm typecheck
pnpm test
cd src-tauri
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --no-fail-fast
```

CI file `.github/workflows/fork-safety.yml` checks the release-safety and desktop-identity posture independent of Rust/Node dependencies. The above commands are validation targets, **not claims that tests have passed on this fork**.

## Contribution and upstream notice

The original ORG2 source, licensing and attribution remain the foundation of this fork.
See [roadmap](docs/fork/ROADMAP.md). Any shipped modifications should record their author, purpose, test evidence and user-facing migration impact.
