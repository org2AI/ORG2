# Legacy workstation retirement

Remove obsolete workstation routing ownership and the unused browser/replay design and history layers. Supported URL navigation is a store-owned entry request, applied once per navigation identity; tab changes remain the active pane owner. Non-hook navigation uses one adapter, and preload promises are keyed by the three loader identities with failure eviction.

Timestamped browsing history and the unwired replay sidebar Design entry are retired. Back/Forward still uses history/historyIndex. Old stored timestamp fields are preserved without migration, but new visits are no longer timestamp-recorded. The retired token scanner and explicit inspector-enable command are removed with their sole unused callers; active style edits, inspector toggle/disable and polling remain.

Deleted disconnected preview/frame/title-bar chains, property controls, route guard/fallback, redundant browser types and unused metadata/exports. No new replacement layout system is introduced.

## Architecture coverage

| Layer                | Result                                                                                                                                                     |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Compilation          | TypeScript, focused tests and browser Rust checks recorded in PR verification.                                                                             |
| Dead code            | Traced callers through entry points and barrels before deleting disconnected chains.                                                                       |
| Naming               | URL entry intent, station selection and active host distinguished; stale mode/frame comments removed.                                                      |
| Semantic overloading | Back/Forward navigation history remains distinct from retired timestamped visit list. Live inspector Design remains distinct from removed sidebar Design.  |
| Defaults             | Base route preserves station selection; host routes select matching tabs. Existing sidebar session actions retain defaults.                                |
| Boundaries           | Store owns entry action; React hook owns location identity; navigation adapter owns event shape. Retired features removed through frontend/backend owners. |
| Developer clarity    | Removed unused wrappers, adapters, callback contracts and preview-only resources.                                                                          |
| Serialization        | Existing browser records preserved; two unused internal IPC commands retired. Browser's direct regex dependency removed with token scanner.                |
| Entry parity         | Route entry, new browser session, native navigation and URL bar paths covered by focused tests.                                                            |
| Resolver symmetry    | Existing tab preference/factory fallbacks explicit; source navigation resolution unchanged.                                                                |

## Risks and recovery

Direct host URL entry and re-entry change pane selection behavior and warrant native application testing. History and Design pills disappear from the replay sidebar; the single Sessions pill header is hidden. No screenshots were taken because computer control was not authorized. Tests mock native APIs; no full application/platform validation is claimed. Revert this change to restore retired source features, but visits after retirement have no recoverable timestamp metadata. Existing stored records are not deleted.
