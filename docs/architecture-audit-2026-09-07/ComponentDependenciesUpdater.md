# ComponentDependenciesUpdater

The six action/hook-only consumers no longer import the full AppUpdater UI. `state.ts` owns atoms and read hooks, `actions.ts` defers service loading until a command runs, and `service.tsx` owns the one module coordinator and scheduler lifecycle. `index.tsx` owns confirmation UI and starts/stops automatic work after settings load. Progress notifications remain in the service because manual commands must keep existing toast behavior before the deferred UI mounts.

Acceptance criteria: all six caller imports migrated; shared state identity preserved; imports/manual commands start no automatic work; scheduler startup and cleanup remain unchanged; existing download/confirmation/relaunch tests pass.

## Architecture coverage

| Layer                     | Verdict and evidence                                                                                                                                   |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 Compilation             | Changed-file ESLint and full-project `pnpm run typecheck:fast` pass in the isolated updater branch                                                     |
| 2 Dead code / duplication | No old API re-exports retained; one coordinator construction, one scheduler factory, one atom declaration per state; all callers migrated              |
| 3 Naming                  | Commands retain existing names; service/state/actions boundaries explicitly name their roles                                                           |
| 4 Semantic overloading    | Coordinator means update operation serialization; scheduler means automatic trigger lifecycle; atoms are projections; UI owns confirmation display     |
| 5 Defaults                | notify/force/confirmed/silentDownload defaults and timeout/retry constants preserved                                                                   |
| 6 Cross-domain leakage    | Hook readers do not import updater rendering or service; event consumers load service on demand                                                        |
| 7 Comprehensibility       | Component documentation updated to show all entry points                                                                                               |
| 8 Wire protocol           | Not changed; no payload, IPC, endpoint or serialization edits, so no new wire exercise                                                                 |
| 9 Init parity             | Manual and mounted service paths share coordinator/state; explicit mount alone starts automatic work; cancellation before provenance completion tested |
| 10 Resolver symmetry      | Build-provenance resolution and cache remain the same single service function; no field fallback changes                                               |

## Performance guard

| Area               | Verdict | Evidence                                                                                                | Change or reason kept                                                                   | Verification                                                              |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Background work    | keep    | AppUpdater effect remains the only production scheduler start; cancellation and stop retained           | 10-second startup, 2-hour visible cadence, 750 ms debounce, existing backoff unchanged  | New repeated-mount/cancel tests; existing nine scheduler tests            |
| Memory             | keep    | One coordinator, provenance atom, pending separate-install promise; no added cache or listener registry | Preserve singleton lifetime and installer serialization                                 | Lazy/direct action test observes one in-flight check and same update atom |
| Scope/isolation    | keep    | Existing process/window updater domain and instrumented store retained                                  | No auth, endpoint, store, or persistence format changes                                 | Existing channel/provenance/separate-install tests                        |
| Rendering/hot path | fix     | Six small consumers now import action/read modules                                                      | Lazy actions defer service loading; read hooks remain narrow derived-atom subscriptions | Static import sweep; no runtime speed or bundle-byte claim                |

Lifecycle matrix: import/manual-only creates no automatic timers; mount waits for provenance; unmount cancels pending setup and removes scheduler timers/listeners; repeated mounts retain no scheduler resources. Existing scheduler tests cover active concurrency, hidden visibility, focus return, offline/online retry, bounded backoff and late-failure disposal. Identity/org/provider lifecycle is not changed by this extraction. Native primary/secondary process behavior and real WebView CPU/RSS were not exercised.

## Verification

- `pnpm test src/scaffold/AppUpdater src/engines/ChatPanel/ChatPanelStartPage.test.ts src/engines/ChatPanel/ChatPanelStartPage.lifecycle.test.ts src/engines/ChatPanel/hooks/useChatPanelCreationContent.test.ts`: 10 files, 51 tests passed
- Changed-file ESLint with `--max-warnings 0`: passed; exact owned file list is the updater action/state/service/UI/test files plus six consumers and three ChatPanel test mock migrations
- `git diff --check`: passed
- `pnpm run typecheck:fast`: full-project TypeScript check passed on this independent branch
- Production bundle build and before/after bundle analysis were not run for this branch; no bundle-byte or startup improvement is claimed
- No GUI control, native installation/relaunch, or before/after bundle/CPU/RSS measurement performed; the confirmed result is dependency separation and unit-tested lifecycle parity

Performance verdict: blocked for a measured runtime improvement claim because native measurements and before/after chunk evidence are not available for this branch. Focused lifecycle correctness checks pass.
