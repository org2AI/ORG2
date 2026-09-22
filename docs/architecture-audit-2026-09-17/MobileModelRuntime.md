# Mobile model runtime isolation

Contract: mounting, opening, replacing, and unmounting the mobile model picker must never create desktop credential-store reads, subscriptions, or writes. Desktop account defaults and effort persistence retain their existing owner.

Authoritative source: mobile `MobileSessionModelConfig` and account-scoped remote `MobileModelOption[]`, supplied by the connection/session controller. The desktop key vault is not a mobile source. Previously `ModelSelectorPill` called both desktop lookup/effort hooks before applying `effortSegmentOverride`; the override replaced their return value but not their effects. The owning mount path created three credential-store subscriptions and auto-loaded `list_keys` on iOS.

The extraction keeps `ModelSelectorPill` as the desktop adapter. The new `ModelSelectorPillView` requires supplied selection, display label, and effort state; MobileModelPicker imports this view directly. No persistence format or remote wire contract changes. No historical data remediation is necessary: this bug issued unsupported reads, not a new persistent format.

| Layer                     | Result                                                                                                                                                      |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | Full `pnpm exec tsgo --noEmit --pretty false` passes; focused component tests pass                                                                          |
| 2 Dead code/deduplication | Single shared view; removed the mobile-only override; existing desktop entry points retain their default import                                             |
| 3 Naming                  | `ModelSelectorPillView` denotes presentation; index documents desktop ownership                                                                             |
| 4 Semantic overloading    | Local account defaults and remote session selection no longer share a hook boundary                                                                         |
| 5 Defaults                | Historical desktop sessions retain `isActiveSession=false`; mobile config remains authoritative even when catalog is empty                                  |
| 6 Domain leakage          | No executable desktop model hook import in the view or MobileRemote; type-only effort contract imports do not execute KeyVault                              |
| 7 Discoverability         | Required view data makes hidden local account lookup impossible in the presentation component                                                               |
| 8 Wire                    | No wire changes; actual remote callback fixture receives selected model and remote account; desktop list/save boundary is untouched in mobile mount tests   |
| 9 Init parity             | Desktop entry points initialize local hooks; mobile initializes its platform provider and remote effort derivation; tests mount that production mobile path |
| 10 Resolver symmetry      | Mobile model/effort/account all derive from current remote config/catalog; desktop still resolves model and effort via existing local accounts              |

Lifecycle: no config → hidden; read-only config → disabled label; editable config → shared settings; empty/loading/failed catalog preserves current model and existing retry UI. Menu selections call the owning remote callback. Scope replacement recomputes from new props; unmount discards only local menu state. This extraction creates no request whose stale completion needs reconciliation; existing remote controller request generations are unchanged.

Regression: real mobile model hooks run, with call-through spies on `subscribeSharedLocalKeys`, `listKeys`, and `saveKey`. Tests assert zero calls during menu interaction, a new session/account, external local-store publication, and three remounts. Temporarily restoring the old mobile adapter import reproduced three subscriptions and `list_keys` failures. Desktop settings interaction tests preserve effort dispatch and shared menu disposal.

Remaining risks: packaged iOS and real desktop credential persistence were not exercised; browser unit tests do not measure native performance. Existing mobile selection promise handling is unchanged and has two pre-existing standalone typed-ESLint findings.
