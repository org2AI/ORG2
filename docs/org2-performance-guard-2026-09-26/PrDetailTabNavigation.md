# PR detail tab navigation

| Area               | Verdict | Evidence                                                                    | Change or reason kept                                                                      | Verification                                                              |
| ------------------ | ------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Background work    | keep    | Existing detail controller owns load, checks polling and visibility cleanup | No additional timer or subscription; valid PR URLs skip local remote lookup                | Existing checks polling and detail lifecycle suites pass                  |
| Memory             | keep    | Existing scoped PR atom retention and shared bounded detail cache           | Repeated clicks focus the existing tab; no additional registry                             | Chat tab regression verifies repeated clicks                              |
| Scope/isolation    | fix     | Remote-only tabs previously lacked a repository path key                    | Canonical PR URL scopes remote detail state and tab identity; local scopes stay compatible | Different repositories with the same number and delayed responses covered |
| Rendering/hot path | keep    | Shared PrDetailPanel and tabs render existing controls                      | No new detail UI or styling                                                                | Existing panel rendered tests pass                                        |

UI actions now open the existing GitHub PR tab even if local repository resolution is missing or mismatched. URL repository identity owns remote fetches; no local file navigation is enabled without a local path. Local fallback resolution is keyed by path/id and cancelled on replacement. No provider storage, authentication or endpoint policy changes. Existing shared caches still have the previously documented account-switch limitations; this change does not claim to resolve those.

Automated coverage: 92 tests across rail routing, real tab atoms, detail loader, scoped state, checks polling, detail panel and chat PR view. TypeScript checking passes. Native dev receives the production changes. Full native click-through and CPU/RSS measurements could not be performed: native app is unavailable to the UI automation tool, and browser mode reports Tauri IPC unavailable. No performance improvement is claimed.

Performance verdict: blocked for real native visible/hidden idle and repeated-open measurements; scoped lifecycle regressions pass.
