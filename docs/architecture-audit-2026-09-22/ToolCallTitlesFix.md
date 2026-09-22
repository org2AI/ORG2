# Tool call title consistency

## Contract and ownership

A CUA JS call with a nonempty string `args.title` displays that description in desktop chat, replay details/lists, and mobile. Other tools retain registry labels and domain-title semantics. Known spellings are `js`, `cua_repl.js`, `mcp__cua_repl.js`, and `mcp__cua_repl__js`. Missing, blank, and non-string titles use the existing label fallback.

The authoritative value remains the stored event's `args.title`. The shared `getToolCallTitle` resolver supplies presentation policy. Nothing writes a replacement title to persistence. Historical pollution/remediation: none; existing events can render correctly without a migration.

Path: original event args → ToolCallBlock / historical IDE projection / live IDE overlay / replay heading and sidebar. The mobile path is event args → shared Rust snapshot/upsert projection → optional bounded `toolArgumentTitle` → transcript reducer → the same frontend resolver → row and modal.

`toolArgumentTitle` preserves the raw argument's semantic identity; it is not a promise that every tool uses it as a call description. `toolSummary` remains separate because it may be a URL, file path, query, or domain name. An identical mobile subtitle is omitted only when it duplicates an explicitly resolved call title.

## Lifecycle and edge cases

| State / transition               | Invariant                                                                                             | Evidence                                                              |
| -------------------------------- | ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Running → completed / failed     | Keep invocation title; retain existing status painting.                                               | FallbackAdapter, MobileToolCall and Rust projection tests.            |
| Failure → retry                  | Updated event title replaces its previous title.                                                      | Live overlay and mobile reducer tests.                                |
| New event / selection switch     | Another event cannot inherit the previous call's title.                                               | Live overlay identity test.                                           |
| Load history / result hydration  | Merge call args by call identity before resolving replay labels.                                      | deriveIDEState test.                                                  |
| Blank / malformed / absent title | Existing tool label remains readable.                                                                 | Resolver and chat renderer tests.                                     |
| Unrelated domain title           | A document/task/message title does not replace tool semantics.                                        | Resolver, desktop fallback, and mobile rendered tests.                |
| Long title / narrow viewport     | Constrain text width and retain full title in hover text; status stays visible.                       | Shared title props, light/dark preview screenshots.                   |
| Open mobile details              | Dialog accessible name uses the same title as the row.                                                | MobileToolDetailModal test.                                           |
| Old server/client                | Missing field retains old label + summary behavior; unknown optional field is ignored by old clients. | Old-server MobileToolCall test and unchanged optional JSON transport. |

No new requests, retries, permission gates, interactive controls, or local workflow state are introduced. Existing request ordering and scope ownership are unchanged. Rollback is a code revert; no database or wire-version migration is needed.

## Ten-layer review

| Layer                | Result                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation        | TypeScript native checker passed; standard tsc exceeded its default heap. See verification report for Rust result.                |
| 2 Duplication        | One frontend resolver owns the allowlist and title validation across all affected views.                                          |
| 3 Naming             | `toolArgumentTitle` deliberately denotes an argument, not a generic summary or registry label.                                    |
| 4 Semantic overload  | Business titles, invocation descriptions, and mixed-purpose summaries remain distinct.                                            |
| 5 Defaults           | Registry/name fallbacks remain for unknown tools and unusable titles.                                                             |
| 6 Domain boundaries  | Rust transports a bounded argument; presentation policy stays in shared frontend code.                                            |
| 7 Clarity            | Resolver documents why unconditional title promotion is invalid.                                                                  |
| 8 Wire               | Optional field limited to 512 UTF-8 bytes plus the existing truncation marker; raw args/code are not added to the mobile payload. |
| 9 Entry parity       | Both session-history and live-wire projections share attach_mobile_tool_projection; tests cover both.                             |
| 10 Resolver symmetry | Chat, replay history/live/list/details, and mobile use the same title policy before their existing label fallbacks.               |

Unrelated architecture, provider ingestion, identity, and background-resource ownership are outside the change.
