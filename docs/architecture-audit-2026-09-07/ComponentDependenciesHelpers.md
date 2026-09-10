# Component dependency helper extraction

## Scope

Primary audit findings 4, 6, 10 and 11. Prepared on an isolated branch from `develop`; unrelated local edits are excluded.

- `store/ui/queueReorderState.ts` owns the existing single shared drag boolean. QueuedMessages, global drag detection and input-container drag detection reference the same object.
- `features/TeamCollaboration/forkDialogState.ts` owns setup and checkout request atoms plus their contracts. Moving the checkout atom is the equivalent-path sweep: otherwise the same resolver would still import another complete dialog.
- `modules/WorkStation/Browser/shared/urlBarFocus.ts` owns the focus event constant and unchanged double-rAF dispatcher. URL toolbar, viewport and launch actions use the same helper/event name.
- `util/customModelIdentity.ts` owns custom row IDs and placeholder naming/predicates. The KeyVault wizard no longer imports the custom-row renderer to classify a model name.

No persistence formats, wire contracts, model-name semantics, dialog resolution policy or source-data cleanup changed.

## Architecture coverage

Layers 1–2: full frontend typecheck plus focused functional/boundary checks; moved definitions removed from their old UI owners. Layers 3–4: existing symbol names and domain meanings retained. Layer 5: existing null/cancel and model-prefix defaults retained. Layer 6: removed logic-to-UI dependencies. Layer 7: state, focus and identity files now describe their actual responsibilities. Layers 8–10: no wire, initialization or multi-source resolver behavior was changed; native endpoint/init parity was not exercised.

## Lifecycle review

| Area               | Verdict | Evidence                                                                                        | Change or reason kept                                                         | Verification                                                                   |
| ------------------ | ------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Background work    | keep    | URL focus schedules exactly two one-shot animation frames; no new timer/listener registration   | Existing toolbar listener owner and cleanup unchanged                         | `urlBarFocus.test.ts` verifies two-frame ordering and exactly one notification |
| Memory             | keep    | One module-level boolean object and two existing Jotai request atoms                            | No new keyed cache, subscription or growing collection                        | Import sweep and fork tests                                                    |
| Scope/isolation    | keep    | Requests still use the same atom/store boundary and callback contract                           | Only definitions moved; no new cross-account, cross-instance or session state | Existing 32 fork-session tests                                                 |
| Rendering/hot path | fix     | Global drag detection no longer imports QueuedMessages; wizard no longer imports a row renderer | Shared leaf modules                                                           | `dragDetection.test.ts` and combined import-boundary regression                |

Targeted checks: `pnpm exec vitest run --config config/vitest.config.ts src/features/TeamCollaboration/forkSession.test.ts src/features/TeamCollaboration/components/ForkSessionSetupDialog/modelPreselection.test.ts src/modules/WorkStation/Browser/shared/urlBarFocus.test.ts src/app/root/services/GlobalDragDrop/useGlobalDragDrop/utils/dragDetection.test.ts` — 4 files, 38 tests passed. Changed-file ESLint passed. Independent-branch typecheck and import-boundary results are included in the pull request verification.

Performance verdict: **blocked for native runtime measurement**. Static boundaries and tested behavior are verified; actual Tauri visible/hidden/close behavior and CPU/RSS were not measured because local desktop UI control was not authorized. No native performance improvement is claimed.
