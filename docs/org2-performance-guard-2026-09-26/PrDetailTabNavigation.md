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

## Pane ownership correction

The rail dispatches to EditorTabService plus revealMyStation, not the chat-panel tab opener. This keeps the selected conversation mounted beside the existing workstation PR renderer. No new background resources or caches. Six focused tests pass; the real store test verifies opening two PRs and refocusing one without changing the chat tabs object or selected conversation. Previously opened chat-pane PR tabs are not destructively migrated.

## First-load PR title

The attachment reader previously held PR metadata until the subsequent head-checks request settled. The shared loader now offers an optional metadata callback backed by its existing in-flight request. Original callers, late joiners and cache hits receive metadata before checks finish, without another GitHub request or new cache/timer. The rail rejects callbacks from hidden/unmounted/replaced effects, paints title/lifecycle immediately, and preserves metadata if checks fail. Shared request promise identity and existing final-result publication remain unchanged.

Tests cover cold load with blocked checks, late joins, cache hits, callback exceptions, metadata rejection, checks failure retaining title, and late previous-session metadata. Native GUI timing remains manually verifiable; no measured performance improvement is claimed.

## Workstation PR tab title

The workstation factory previously formatted only the PR number. It now includes the title; the mounted detail renderer updates tab metadata from the existing scoped PR detail when available, including restored tabs and remote renames. Equality checks prevent redundant writes; no extra request, listener or timer is introduced. The shared truncated tab label and tooltip both use this title. Three regressions cover initial opening, restored title hydration/rename, and number-only loading fallback.
