# Streaming turn completion

## Problem and behavior

Completed streaming turns intentionally stayed expanded for ten minutes. Loaded turns containing a single reply or tool event also lost their worked-for summary. The header's default collapse state differed from the body projection's default.

The latest turn now completes when its parent engine is idle and no subagent jobs are running for that session. External-history sessions use their normalized session status for the parent signal. Completion immediately defaults the body to collapsed and shows the timing summary, including single-event bodies. Final replies and explicit manual expansion remain visible. Running and interactive-wait turns remain expanded.

Completion is latched per session and user turn to survive optimistic next-dispatch status before the new user event arrives. A new session/turn resets the latch; live child jobs invalidate it, including late child-start notifications. This removes the stale phase, last-event timestamp scan, and both timeout effects. The state is one bounded completion record plus one memoized session-scoped boolean atom.

The owning boundary is the UI projection of session events and runtime state. No malformed persisted transcript was demonstrated. Runtime/event-store writers and persistence formats are unchanged; no historical cleanup or migration is needed. The supplied screenshot had no session identifier, so the evidence is code-path reproduction rather than inspection of that exact session.

## Architecture review

| Layer                       | Verdict | Evidence                                                                                    |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------- |
| 1 Compilation               | pass    | Typecheck and focused lint passed on the isolated PR branch                                 |
| 2 Dead code and duplication | fix     | Remove stale helper/phase/timers; keep shared header/body collapse helpers                  |
| 3 Naming                    | fix     | Remove obsolete stale-phase documentation                                                   |
| 4 Semantics                 | fix     | Parent completion and absence of live children are both required                            |
| 5 Defaults                  | fix     | Header and projection default to collapsed on completion; overrides still win               |
| 6 Domain boundaries         | keep    | Provider status resolution stays at the lifecycle boundary; grouping stays provider-neutral |
| 7 Understandability         | fix     | Two phases and a bounded latch replace delayed collapse                                     |
| 8 Wire protocol             | keep    | Narrow internal worker phase type; no external API, IPC, or persistence change              |
| 9 Entry parity              | pass    | Rendered main-thread path and worker options-only completion have regression coverage       |
| 10 Resolver symmetry        | keep    | Header/body use the same eligibility and default helpers                                    |

Frontend UI audit skipped for this focused bug fix: production TSX behavior changes only the header default. Existing shared Button markup and styling are unchanged; no action-control bypass was introduced. Other concurrent empty-turn layout and transcript cleanup work is excluded from this PR.

## Performance guard

| Area               | Verdict | Evidence                                          | Change or reason kept                                  | Verification                                                                                |
| ------------------ | ------- | ------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Background work    | fix     | Two collapse timers and an event-timestamp scan   | Remove them; completion follows status/job events      | Hook lifecycle regressions and source inspection                                            |
| Memory             | keep    | One completion record and a memoized derived atom | Constant-size state; subscriptions released on unmount | Session switch/return coverage                                                              |
| Scope/isolation    | fix     | Subagent map keyed by parent session              | Read only the displayed session's live-job boolean     | Other-session, parent-first, child-first, last-child, late-start and external-session cases |
| Rendering/hot path | fix     | Completion previously needed deferred effects     | Guarded local latch update; no polling                 | Summary/chevron/manual expansion and worker options-only completion tests                   |

Coverage includes mount/unmount, active-to-idle, interactive waits, next dispatch before transcript, next user turn, session switch/return, child lifecycle transitions, and collapse-disabled surfaces. Hidden documents have no collapse timer to manage. Network, auth, endpoint, and provider-file ingestion paths are unchanged.

No real Tauri visual or CPU/RSS measurement was run: desktop control is opt-in and was not requested. No measured CPU/RSS improvement is claimed. Performance verdict: blocked for real-app measurement; automated lifecycle evidence is listed in the PR's Verification section.

## Verification on the isolated PR branch

- `pnpm test src/engines/ChatPanel/ChatHistory src/engines/ChatPanel/InputArea/components/TurnCollapsePinBar.test.ts src/engines/ChatPanel/hooks/agentStatusTrailMath.test.ts src/engines/ChatPanel/hooks/useAgentStatusTrail.test.ts src/store/session/__tests__/subagentJobAtom.test.ts` — 61 files, 580 tests passed
- `pnpm typecheck:fast` — passed
- `git diff --cached --name-only --diff-filter=ACMR -- '*.ts' '*.tsx' | xargs pnpm exec eslint --max-warnings 0` — passed
- `git diff --cached --check` — passed
- `git diff --cached --name-only --diff-filter=ACMR -z | node scripts/ci/check-changed-file-length.cjs` — passed, 7 production files within 700 lines
- `pnpm check:test-placement` — passed, 577 directories
- `pnpm check:circular` — reports four cycles outside changed paths: icons, SessionCore/composer/slash-command imports (two), and HoverCard

Native Tauri visual evidence and live-provider/CPU/RSS checks were not run. No schema, dependency, or platform-specific backend changed. Rollback is a code revert; transcript data is untouched.
