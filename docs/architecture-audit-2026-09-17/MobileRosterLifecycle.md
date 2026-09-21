# Desktop / iOS roster lifecycle

Scope: one change to keep the paired phone's session roster consistent through Desktop route/sidebar teardown and recover failed roster reads. This is implementation-supporting review, not an all-app audit. Provider-history ingestion, transcript timing, persistence schemas and release automation are unchanged.

## Authority and root cause

The authoritative mobile list response is produced by `src-tauri/src/api/mobile_bridge/adapters/session.rs`: a published Desktop snapshot is used when initialized; the database directory is the fallback before initialization. An initialized empty snapshot is real empty domain data, not a loading placeholder. During the original reproduction Desktop settings navigation produced a response with `source: "desktop_sidebar"`, zero rows and `hasMore: false`; local session records remained present.

The invalid writer was the frontend lifecycle: route teardown released `mobileSidebarPublisher`, which sent `[]`; duplicate hover/docked publishers could invalidate the surviving owner. A rejected same-scope update also caused the retry path to clear the previously valid snapshot. Separately, each sidebar wrote/cleared shared cloud-org selection on mount/unmount. Mobile swallowed list refresh failures, leaving a healthy transport with no usable roster status.

The source fix moves the projection and publication into one `DesktopSessionRosterProvider` above route/view gates. Views consume that owner. Publication failure preserves the same-scope last-good snapshot; actual identity/org invalidation clears before replacement. Cloud selection is read-only derived state: persisted selection intersected with confirmed membership owned by the current endpoint/user. Identity-fenced roster requests cannot commit old-account results. Mobile separately owns `idle/loading/ready/error`, bounded retry, and explicit empty/error presentation.

No stored session, transcript or historical data was deleted or rewritten. No cleanup or migration is required: the corrupted state was a transient published projection, repaired by a successful fresh publication.

## Findings and decisions

| Line / source                                                   | Element                                    | Verdict          | Reason                                                                                      | Suggested change                                                                                  |
| --------------------------------------------------------------- | ------------------------------------------ | ---------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `src/modules/index.tsx:354`; `DesktopSessionRosterProvider.tsx` | Application owner                          | fix              | Route and hover teardown are presentation events, not empty domain data                     | Implemented one provider around Outlet, docked and floating sidebars                              |
| `mobileSidebarPublisher.ts:29`                                  | Publication sequencing and retry           | fix              | Clear-on-error destroyed good rows; a second view could take ownership away                 | Implemented serialized writes, bounded retry, retained valid same-scope snapshot and owner leases |
| `useMobileSidebarSessions.ts:93`                                | Window and identity boundary               | fix              | Detached windows share native snapshot storage; scope strings alone omit account identity   | Primary-window publisher only; endpoint/user plus selected-org publication key                    |
| `org2CloudOrgsAtom.ts:170,248`                                  | Shared scope projection                    | fix              | A view cleanup could clear another consumer's active organization                           | Read-only projection; confirmed roster identity and request identity checks                       |
| `useSidebarOrgScope.tsx:276`                                    | Retained cloud filter preferences          | fix              | Application lifetime cannot retain removed-org or old-account member selections forever     | Reconcile filter map to current identity and confirmed org IDs; reject stale callbacks            |
| `useMobileSessionList.ts:62`                                    | Roster failure lifecycle                   | fix              | Transport online did not establish list readiness; failed invalidations had no recovery     | Roster phase, validation, one retry timer, bounded transient recovery, manual retry               |
| `useSessionMenuItems/index.tsx:235,406`                         | View-only enrichment                       | keep with reason | Headless mobile publication needs list projection, not invisible PR/subagent enrichment     | Enable enrichment only while a sidebar view consumes the provider                                 |
| `session.rs:441`                                                | Native uninitialized versus empty snapshot | keep with reason | A successful empty list must remain distinguishable from absence of any Desktop publication | Keep existing wire/source contract; reject malformed responses on mobile                          |

Paths without a full prefix above are under `src/scaffold/NavigationSidebar/connectors/WorkstationSidebarConnector/`, except cloud atoms under `src/features/Org2Cloud/` and list state under `src/modules/MobileRemote/app/`.

## Ten-layer coverage

| Layer                      | Coverage / result                                                                                                                                                                                                 |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Compilation             | `pnpm exec tsgo --noEmit` and changed-file ESLint pass; Rust unchanged, no new Cargo check claimed                                                                                                                |
| 2. Ownership / duplication | Traced AppShell → one provider → desktop projection → IPC; visual consumers no longer publish independently                                                                                                       |
| 3. Naming                  | `DesktopSessionRosterProvider` identifies the owner; historical sidebar atom name retained for consumers but documented as derived application scope                                                              |
| 4. Semantics               | Transport presence, roster readiness, selected org, and confirmed membership are distinct; view disappearance no longer means empty sessions                                                                      |
| 5. Defaults                | Successful `[]` is ready-empty; missing/malformed `sessions` is an error; same-scope failure retains good rows; auth/protocol failures do not auto-loop                                                           |
| 6. Boundaries              | Route components consume domain projection; primary-window ownership prevents detached view publication; selection is store-owned                                                                                 |
| 7. Discoverability         | Owner contract and source-level tests locate responsibility without relying on render order                                                                                                                       |
| 8. Wire                    | Existing Rust snapshot and pagination fields traced; fake RPC tests exercise actual client handling, including structured error codes; new live payload read-back still pending                                   |
| 9. Initialization parity   | Cold settings, ordinary sidebar, hover duplicate and detached consumers covered by provider composition tests; packaged Desktop launch and settings navigation observed; live paired roster validation incomplete |
| 10. Resolver symmetry      | Both list sources must provide a valid `sessions` array; optional legacy pagination remains accepted, advancing cursor required when `hasMore` is true; global search remains intentionally distinct              |

## Initialization and isolation matrix

| Entry / transition                       | Expected invariant                                                   | Evidence                                                 |
| ---------------------------------------- | -------------------------------------------------------------------- | -------------------------------------------------------- |
| Start in settings with no visual sidebar | One application roster owner still publishes                         | Provider test                                            |
| Docked sidebar plus hover                | One data owner; closing either view cannot clear/steal roster        | Provider + publisher tests                               |
| Settings → session → settings            | Same-scope last-good rows survive, fresh data still updates          | Provider lifecycle test                                  |
| Detached session window                  | Cannot publish/clear primary native snapshot                         | Window-gate test; SessionWindow remains outside AppShell |
| Account / endpoint switch, removed org   | Old membership cannot grant active scope or commit stale results     | Actual scope hook/store tests, request-boundary tests    |
| Mobile desktop switch / provider unmount | Cancel retry; old reply cannot overwrite new device                  | Mobile provider tests                                    |
| Mobile background → foreground           | Release old transport/list work; refresh through one reconnect owner | Mobile provider tests                                    |

## Verification and limitations

- Integrated `pnpm exec vitest run --config config/vitest.config.ts` selection: **69 files, 614 tests passed**, recorded in the local integrated-final test log
- `pnpm exec tsgo --noEmit`: passed
- Changed-production/test-file ESLint and Prettier checks: passed
- `git diff --check`: passed
- Follow-up cloud-filter retention cases: two added cases passed within a 14-test focused scope run; scoped ESLint passed
- Specific producing-boundary regressions cover route teardown, duplicate views, failed publication preserving rows, identity invalidation retry, old-account callbacks, malformed roster input, bounded recovery and switch/unmount cancellation
- Both the initial and final packaged builds passed after repairing local dependency symlinks. Desktop was launched and settings / Mobile Remote settings opened successfully; the remote-connection panel showed connected. The iOS native shell served the rebuilt mobile frontend but remained reconnecting; simulator click automation returned `noWindowsAvailable`, preventing manual recovery and live roster read-back. No claim of live iOS/Desktop recovery, Cloud subscriptions, cross-window CPU/RSS, or timing improvement follows from unit tests
- Native IPC still stores one process snapshot without an explicit identity/epoch payload. This change enforces ownership at the main-window frontend boundary; it does not add a native multi-writer fencing protocol

See the companion performance report for retained-state and runtime evidence limits. No publication, account permission or automatic release behavior is changed.

Final build: production webpack and `tauri build --debug --bundles app` passed after the retained-state fixes. The native linker reported its existing large `__eh_frame` debug warning; no release or TestFlight upload was performed. A moved child-cache test was rerun from the directory’s existing `__tests__` convention; test-placement and changed-file length checks passed.

Final runtime read-back: the final packaged app had one cold-launch blank window with `React failed to render within timeout`; a normal Cmd+R reload restored the real roster, and Cmd+, opened settings successfully. No cause is established for that transient launch failure; cold-launch reliability and paired iOS recovery remain unverified risks.

## Isolated PR validation after rebase

See [`MobileRosterBatch.md`](../verification-2026-09-18/MobileRosterBatch.md) for the current branch results and remaining runtime/visual gaps. Earlier counts and simulator notes above describe the original integrated worktree.
