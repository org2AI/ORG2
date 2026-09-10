# Chat-panel direct owners and explicit width initialization

## Scope

Second phase of the approved state-facade migration, following the local workstation layout phase. Remove `src/store/ui/chatPanelAtom.ts`, preserve its public names through the existing broad UI API, and migrate ordinary consumers to width, visibility, display preferences, selection, surface and miscellaneous state owners. The chat-tab command facade remains a separate later phase.

Acceptance criteria: no remaining static/dynamic/type/mock references to the removed facade; no duplicate atom definitions; CSS width initialized from the actual app store before child rendering; persisted width normalization, hidden/restore semantics and resize debounce preserved; affected/full frontend tests and static checks pass.

## Findings and changes

| Line                                                     | Element                            | Verdict          | Reason                                                                                            | Suggested change                                                                                   |
| -------------------------------------------------------- | ---------------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `src/store/ui/chatPanelAtom.ts:1`                        | Compatibility API                  | fix              | Aggregates unrelated owners and implicitly triggered width initialization for arbitrary consumers | Removed; migrate static imports plus re-export, dynamic loaders and two mocks                      |
| `src/store/ui/chatPanel/widthAtoms.ts:65`                | Import-time CSS mutation           | fix              | First-paint correctness should not depend on incidental imports of a facade                       | Keep persisted atom initialization; expose initializeChatWidthStyles(store) for explicit CSS setup |
| `src/app/root/AppProviders.tsx:19`                       | App store creation                 | fix              | Owns the actual store used by child components and precedes their rendering                       | Initialize CSS from that store immediately after obtaining it; repeated calls use current state    |
| `src/store/ui/index.ts:61`                               | Broad UI API                       | keep with reason | Public surface remains available independently of compatibility files                             | Re-export the existing owners and surface-kind constant directly                                   |
| `src/services/workStation/WorkStationViewService.ts:126` | Dynamic UI state loading           | fix              | One loader combined visibility and maximized state from different owners                          | Load visibility/surface modules in the existing Promise.all, without changing actions              |
| `src/store/ui/chatPanel/widthAtoms.ts:91`                | Width writes, restore and debounce | keep with reason | Existing behavior and resource ownership are unrelated to facade removal                          | Keep the canonical atom, shared timer, storage key and restore state unchanged                     |
| `src/store/chatPanel/chatPanelTabsAtom.ts:1`             | Chat-tab API                       | keep with reason | Still needs a separate consumer classification and command-boundary migration                     | Not changed in this phase                                                                          |

## Architecture and lifecycle

Architecture coverage: ownership, compile/reference graph, naming and boundaries (layers 1–4, 6–7), and explicit startup initialization parity (layer 9). Wire shapes, fallback algorithms and resolver symmetry are not changed (layers 5, 8, 10). TSX changes beyond imports are confined to provider initialization; JSX/styles are unchanged.

Performance guard: startup reads the persisted width once through the existing atom module, then reads current width from the actual store to set CSS. Initialization creates no timer, listener or subscription. Repeated initialization does not reset width or reread localStorage. Resize updates retain the existing 300 ms debounce; hiding retains the previous visible width and does not replace persisted width with zero. Timers/mutable state remain in one module. No CPU/RSS or bundle-size claim is made.

The timing of CSS assignment intentionally moves from module evaluation to provider creation before children render. Separate mobile-remote roots do not consume this desktop chat-width CSS in the inspected source. Actual desktop/mobile GUI and multiple running app instances were not exercised; no computer control was used.

## Publication verification

This phase is published independently against develop `bc396d4d8` as Harry19081. It follows Chloe-JY’s earlier re-export work and #1350; it does not include the other state-facade phases or open #1356.

- `pnpm test src/engines/ChatPanel src/store/chatPanel src/store/session src/services/workStation src/scaffold/NavigationSidebar src/app/root/__tests__ src/store/ui/chatPanel/widthAtoms.test.ts` — 317 files / 2081 tests passed on this independent branch.
- `pnpm typecheck:fast` — passed.
- ESLint (`--fix --max-warnings 0`) and Prettier on all changed/new TypeScript files — passed.
- `pnpm check:circular` — no cycles across 6605 modules.
- `pnpm check:test-placement` — passed across 517 directories.
- `git diff --check` — passed; no old references to the removed compatibility paths found in source/test/tool/config searches.
- Combined integration checkout on develop `bc396d4d8`: `pnpm test` — 1,570 files / 11,664 tests passed with all three reviewed phases together. This is separate evidence from the independent branch checks above. Runtime desktop/multi-window startup, GUI/E2E and release bundling are not exercised; no computer control was used.
