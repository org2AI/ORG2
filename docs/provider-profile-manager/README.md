# Per-app provider manager

Settings → App connections now presents searchable provider cards for Claude Code CLI, Claude Desktop, and Codex, using ORGII's components, theme tokens, and existing app tabs.

- Search saved profiles by name, endpoint, credential name, or model ID/display name
- Edit a profile, or Duplicate it into an unsaved draft with a fresh identity
- Test a saved profile directly from its card, then Use this connection with that profile's test evidence
- See the configured connection independently of the selected or filtered profile
- Restore original setup through the existing non-force native restore flow

Custom endpoints, Claude role mappings, and Codex-specific model settings remain in the existing editor. This feature changes their management surface; it introduces no new provider protocol, database schema, API DTO, dependency, or persistence format. It builds on PR #1346 and its Claude profile dependencies. Reverting this commit restores the previous profile-list UI while retaining compatible saved profiles.

Dirty edits and in-progress actions disable per-app navigation. A duplicate is never saved or applied automatically. Missing/incompatible credentials block Test/Apply but permit editing and duplication. Failed refreshes clear activation readiness, and failed initial reads show the error instead of an empty catalog.

## Verification

- `pnpm test`: 1,526 files / 11,445 tests passed, including 35 HarnessConnections tests
- `pnpm typecheck:fast`: passed
- `pnpm lint`: passed (Oxlint and full ESLint)
- `pnpm test src/modules/MainApp/Settings/sections/HarnessConnections`: 4 files / 35 tests passed
- `git diff --check`: passed; normal commit hooks passed
- `pnpm check:test-placement`: passed across 504 directories
- Component/controller tests use real React components and controllers with mocked RPC; they cover all three app targets, exact action payloads, duplication, search, cancellation, stale receipts, missing credentials, restore, and read failures
- No Rust code changed; Cargo checks and native provider network tests were not repeated
- No native GUI, dual-instance run, or CPU/RSS measurement performed

## Visual evidence

These are static previews of the actual editor, library, design-system controls, and app CSS, rendered through headless Chromium with synthetic profiles and mocked controller state. They show layout and state presentation; they are not screenshots of a running native app. Interactive behavior is covered separately by component/controller tests. All eight images were visually inspected.

| State               | Preview                              |
| ------------------- | ------------------------------------ |
| Claude, light       | [claude-light.png](claude-light.png) |
| Claude, dark        | [claude-dark.png](claude-dark.png)   |
| Codex               | [codex-light.png](codex-light.png)   |
| 720px narrow layout | [narrow.png](narrow.png)             |
| Empty catalog       | [empty.png](empty.png)               |
| Test in progress    | [testing.png](testing.png)           |
| Initial loading     | [loading.png](loading.png)           |
| Read failure        | [error.png](error.png)               |
