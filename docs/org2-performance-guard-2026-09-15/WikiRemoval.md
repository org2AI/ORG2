# Wiki removal lifecycle review

| Area               | Verdict | Evidence                                                                                          | Change or reason kept                 | Verification                                                                                              |
| ------------------ | ------- | ------------------------------------------------------------------------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Background work    | keep    | One openLink call per user activation; no wiki fetcher, timer, worker, or retry loop              | Reuses existing browser/system opener | Menu tests assert exactly one call and close-before-open order; openLink tests cover destination/fallback |
| Memory             | fix     | WikiModal lazy module, static article catalog, local query/selection and visibility state removed | No retained wiki state remains        | Production reference sweep and typecheck                                                                  |
| Scope/isolation    | keep    | Public fixed URL; no account or organization data in request                                      | Available with developer mode on/off  | Parameterized menu tests                                                                                  |
| Rendering/hot path | fix     | Local filtering/article rendering and modal mount path removed                                    | Menu delegates to shared navigation   | Menu and onboarding suites                                                                                |

## Lifecycle matrix

| Dimension                         | Applicable behavior and evidence                                                |
| --------------------------------- | ------------------------------------------------------------------------------- |
| App start/idle/active/shutdown    | No wiki-specific work until a click; no retained resource to dispose            |
| Visible/hidden/focus return       | No wiki timers or listeners to run while hidden or restart on focus             |
| Online/offline                    | Browser owns page loading and network failure; no new app retry owner           |
| Identity/scope                    | Public URL is identity-independent; no account/org cache introduced             |
| Session/instance/source/transport | No session, source ingestion, synchronization, or instance-global state changes |
| UI open/close                     | Shared menu closes before navigation; no wiki modal can remain mounted          |

Performance verdict: pass for the applicable removal and resource-ownership invariants, evidenced by source trace, 51 targeted tests, typecheck, and lint. No CPU/RSS improvement is claimed. Real browser launching and desktop rendering were not measured; computer control was not authorized.
