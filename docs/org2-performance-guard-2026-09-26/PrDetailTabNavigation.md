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

## Title retention across remounts

The complete metadata-plus-checks snapshot expired after 7.5 seconds, and failed checks never retained a complete snapshot. Remounted rails therefore lost previously loaded titles. The shared loader now retains successful metadata separately in a bounded 32-entry memory cache, seeds it while revalidating, and uses case-insensitive repository keys. Freshness invalidation retains display metadata; full clear removes both caches; generation and request order reject late cache writes. CI refresh still uses the original request and coalescing path. True cold loads explicitly display loading until metadata settles; failure keeps the existing retry behavior. GitHub remains authoritative, attachment storage still contains URLs only, and no persisted-data cleanup is needed.

Verification: 55 tests across the shared loader, attachment hook, rail labels and branch consumers pass, including the actual shared loader with a checks failure followed by remount past the TTL and a delayed renamed title. TypeScript, changed-file ESLint and typed lint pass (0 new/increased findings). No new timer or additional request is introduced; the additional metadata cache is capped at 32 entries and follows existing clear/invalidate ownership. Native timing/CPU/RSS and account-switch behavior remain unverified under the limitations above.

## Returning from the workstation

The detail controller calls shared freshness invalidation during forced refresh or reconciliation. Clearing display metadata there caused precisely the opened PR to lose its title when the chat rail remounted. Freshness invalidation now keeps the display-only seed while dropping the complete checks result and advancing the request epoch. It still forces a new read; old in-flight answers cannot repopulate either cache. Full clear continues to purge both. The rail synchronously projects that seed before committing attachment rows, avoiding a loading-placeholder frame, and retains an existing CI verdict during background metadata refresh.

| Area               | Verdict | Evidence                                                   | Change or reason kept                                                    | Verification                                                                                                |
| ------------------ | ------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| Background work    | keep    | Existing detail reconcile and rail refresh paths           | No added timer, listener or request; invalidation still forces freshness | Repeated invalidation tests count fresh requests                                                            |
| Memory             | keep    | Existing 32-entry shared metadata cache                    | No new cache; full clear purges display seeds                            | Shared loader bound/clear regressions                                                                       |
| Scope/isolation    | fix     | Invalidation previously erased display continuity          | Keep last-known seed, advance epoch, reject old writes                   | Delayed pre-invalidation results cannot overwrite seed                                                      |
| Rendering/hot path | fix     | Parent focus gate unmounts the rail when workstation opens | Synchronously seed rows before publishing them                           | Three repeated hide/show cycles through the production mount predicate; every committed row keeps its title |

58 targeted tests pass; TypeScript and changed-file ESLint pass. Tests cover the producing cache boundary and the rail's parent mount condition, not just labels. This fixes transient runtime state; GitHub metadata and provider attachment URLs require no persistent cleanup. Production files are synced to dev. Native GUI automation and real CPU/RSS measurements remain unavailable; performance verdict remains blocked for those measurements.
