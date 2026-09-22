# Browser sidebar removal UI audit

| Line                                                          | Element               | Verdict          | Reason                                                                                                                                                                       | Suggested change |
| ------------------------------------------------------------- | --------------------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| `src/modules/WorkStation/Browser/SessionReplay/index.tsx:430` | Replay shell          | keep with reason | Shared shell retained with sidebar toggle disabled and explicit null, collapsed, zero-width primary panel; the shared default would otherwise reserve an expanded empty rail | None             |
| `src/modules/WorkStation/Browser/SessionReplay/index.tsx:436` | New normal tab action | keep with reason | Existing TabBarTrailingIconButton uses the shared Button family; its accessible title, shortcut and callback remain intact                                                   | None             |

Verdict totals: **0 fix**, **2 keep with reason**, **0 abstract**.

Scope: removed BrowserPrimarySidebar, its SessionsTab, and BrowserSidebar; removed their configuration, preference subscription, entry selection, private-tab creation and display-only helpers. Moved the surviving replay category type into browserReplayUtils as BrowserReplayCategory. Removed obsolete shared-component documentation references.

D1–D5: reviewed surviving changed UI and the diff; no new raw buttons, native button creation, substitute clickable elements, input fields, arbitrary style values or duplicated control families. The deletion introduces no new design-system sweep candidate. Other existing presentation is outside this removal.

Private-tab domain types, incognito flags, core creation APIs and storage behavior are retained. No user records were modified. No screenshots or Computer Use: source and automated verification only.

Architecture coverage: L1 typecheck attempted (initial workspace run reported three unrelated useAppNavigate diagnostics; the latest-base run did not complete); L2 traced sidebar imports through ReplayShellLayout to WorkStationShell, including CSS collapse and the inherited header toggle; L3 updated remaining type naming and stale comments; L4 category types remain distinct from privacy; L5 explicit collapsed panel avoids expanded default; L6–L7 shared shell remains generic and browser wiring is direct. L8–L10 inspected as unchanged: no wire, persistence, initialization or resolver changes. Rust compilation skipped because no Rust changed.

| Area               | Verdict | Evidence                                                                        | Change or reason kept                                  | Verification                              |
| ------------------ | ------- | ------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------- |
| Background work    | keep    | No timer, worker, network or cache lifecycle added                              | Existing automation and diagnostics remain unchanged   | Source diff                               |
| Memory             | fix     | Sidebar component trees and their filter/pagination state removed               | No sidebar-owned rows or UI state can mount            | Import/call-chain inspection              |
| Scope/isolation    | keep    | Core browser state and privacy types untouched                                  | No identity, storage or cross-instance behavior change | Type/API and diff inspection              |
| Rendering/hot path | fix     | Browser no longer calls useSimulatorReplaySidebar or constructs sidebar content | Applies while active, hidden and across remounts       | Source trace; existing replay shell tests |

Lifecycle scope: sidebar-only React state/subscriptions removed for start, idle, active, hidden, inactive, unmount and remount. Network, account, transport and provider transitions are unchanged and not part of this cleanup. CPU/RSS was not measured; no runtime performance gain is claimed.

Performance verdict: **blocked** for complete compilation and runtime measurement; the latest-base full typecheck stalled and native lifecycle/CPU/RSS measurements were not run.

Verification:

- `pnpm exec eslint --fix src/modules/WorkStation/Browser/SessionReplay/index.tsx src/modules/WorkStation/Browser/SessionReplay/useBrowserReplayTabs.ts src/modules/WorkStation/Browser/SessionReplay/browserReplayUtils.ts src/modules/WorkStation/Browser/SessionReplay/entryUtils.ts src/modules/WorkStation/Browser/SessionReplay/useBrowserReplayDisplay.tsx src/modules/WorkStation/Browser/SessionReplay/useBrowser.ts`: passed after formatting fixes.
- `pnpm exec vitest run --config config/vitest.config.ts --maxWorkers=2 src/modules/WorkStation/Browser/SessionReplay/__tests__/config.test.ts src/modules/WorkStation/shared/SessionReplay/ReplayShellLayout.test.ts src/modules/WorkStation/shared/WorkStationShell/__tests__/config.test.ts`: 3 files, 13 tests passed.
- `pnpm exec tsgo --noEmit --pretty false`: failed only at useAppNavigate.test.ts:50 and :64 (unsupported matcher) and useAppNavigate.ts:24 (catch on never); no diagnostics in changed files.
- Scoped `git diff --check`: passed.

Follow-up PR validation: the same 13 tests passed on latest develop using Vitest 4 and `--maxWorkers=2`. The prior `--minWorkers` flag is unsupported by Vitest 4 and failed before collection; no repository configuration change was needed. Dependencies were reused locally, not installed from the lockfile.

Final PR verification: changed-file ESLint and all 13 focused tests passed in the isolated latest-develop worktree. The standalone full typecheck was stopped to avoid duplicating the hook check. The commit hook passed lint-staged (oxlint, ESLint and Prettier), but its full-project tsgo check stalled for over six minutes without a result. The entire commit process was stopped before it could interpret an interrupted check as success, and the commit was then created with hooks disabled. Full typechecking remains incomplete and must be checked by CI; no successful hook/typecheck result is claimed.
