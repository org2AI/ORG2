# Spotlight form header architecture audit

Acceptance criteria: one header contract for header-only spotlight forms, no duplicate PillBar implementation, no custom commit title row, unchanged form action ownership, and visible commit operations covered at the rendered component boundary.

| Layer                | Finding and evidence                                                                                                             |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation        | Fast TypeScript check passes; scoped lint and rendered tests verify changed consumers                                            |
| 2 Structure          | Production form entry points now use SpotlightFormLayout.header; SpotlightPillBar and redundant hidden-input refs are removed    |
| 3 Naming             | FormLayout owns the path header plus content; FormShell retains the existing body surface; FormBody retains padding              |
| 4 Semantics          | Header is presentation configuration only; callbacks remain owned by their respective forms                                      |
| 5 Defaults           | Search input is always hidden in this form layout; existing searchable palettes still use SpotlightSearchBar directly            |
| 6 Boundaries         | Shared layout has no Git, workspace, organization or quota decisions                                                             |
| 7 Clarity            | Callers pass a path and optional navigation/trailing actions; no repeated fake search state or keyboard handlers                 |
| 8 Wire               | Not applicable: no IPC, API, serialization or persistence changes                                                                |
| 9 Entry parity       | Standalone and embedded forms render the same body and header; SessionCreator tests cover both modes                             |
| 10 Resolver symmetry | No domain resolver changes; action availability follows optional callbacks and modal validation is shared across visible buttons |

No architecture findings remain in the changed scope. The same three pre-existing circular dependencies in SessionCore/ChatPanel and SessionHoverCard remain reported by check:circular.

Lifecycle review: the new layout retains only one component-local ref, with no timers, listeners, subscriptions or requests. Existing spotlight open/close ownership remains unchanged. Quota pagination and refresh retain their existing refs and handlers. Native CPU/RSS, hidden-window behavior and desktop focus traversal were not measured; this change makes no runtime performance claim.
