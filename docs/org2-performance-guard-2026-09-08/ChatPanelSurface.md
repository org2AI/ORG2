# Chat-panel surface ownership

Architecture coverage: compilation, reachability, naming, mutually exclusive
semantic axes, defaults, state ownership, developer clarity, and initialization
parity. Wire identifiers remain unchanged. Backend/provider resolver layers
were skipped because this is frontend-only. No session-switch orchestration
files were changed.

The authoritative selection is now one discriminated state. Existing selection
and content-mode atoms are writable projections rather than independent stores.
Creator target/context, Launchpad visibility, workspace subnavigation and
maximization remain separate axes because their retention semantics differ.
Rendering and UI context snapshots use the same active-surface projection.

For tab-backed work items, the tab owns the payload and the selection retains
only its tab ID. A functional selection update edits that tab synchronously.
Direct navigation without a work-item tab retains one inline payload instead.
The React mirror effect and its patch atom are removed. Runtime-independent
selection types prevent tab factories/models from importing their own state.

| Area               | Verdict | Evidence                                                                 | Change or reason kept                                             | Verification                                                                         |
| ------------------ | ------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Background work    | fix     | Work-item edits previously required a mounted React mirror effect        | Update owning tab at the atom write boundary                      | Regression runs without a mounted ChatPanel                                          |
| Memory             | keep    | One selected variant per Jotai store; tab-backed work items retain an ID | No additional registry, history, timer or cache                   | Variant-transition and store-isolation tests                                         |
| Scope/isolation    | keep    | Work-item matching uses org/project/short-ID identity                    | Preserve existing identity function and functional refresh guards | Same short ID in different orgs and late refresh tests                               |
| Rendering/hot path | fix     | Two independent precedence trees could disagree                          | Render flags use the same surface as UI snapshots; no mirror loop | All-pairs navigation matrix, no-op subscription regression, component/context suites |

Lifecycle: initial session surface; navigation replaces the selected variant;
inactive/hidden edits do not require a React effect; close/revoke actions remove
the owning tab and use existing fallback navigation. No polling, cloud sync,
auth, transport, or persistence policy changes. Existing tab-storage debounce
is unchanged. No historical persisted cleanup is needed or performed.

Verification:

- `pnpm test src/engines/ChatPanel src/store/chatPanel src/store/ui/chatPanel src/services/context`: 1,530 tests passed in 223 files
- `pnpm typecheck:fast`: passed
- `pnpm check:circular`: reports only the pre-existing `SessionHoverCard/HoverCardBase.tsx` / `singletonStore.ts` cycle, independently reproduced without this change; no new cycles
- Changed-file ESLint, formatting, and `git diff --check` passed

Real desktop navigation, hidden/visible CPU/RSS and remount measurements were
not run; computer control was not authorized. No speedup claim is made.

Performance verdict: blocked for real desktop lifecycle/CPU/RSS measurement;
automated state ownership and regression checks pass.
