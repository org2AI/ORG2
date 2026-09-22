# Shared hover card architecture review

Acceptance criteria: one generic owner for hover state/presentation, no old generic SessionHoverCard imports, no eager session data loading, reusable trigger and metadata primitives, PR formatting preserved, and unrelated workspace edits excluded.

| Layer                  | Result                                                                                                                                                           |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation          | TypeScript and changed-file ESLint run on isolated branch.                                                                                                       |
| 2 Deduplication        | Generic base/state/placement/URL/time helpers moved to HoverCard. Domain adapters consume shared trigger and metadata components; duplicate diary shell removed. |
| 3 Naming               | SessionHoverCard owns session data and deferred content; HoverCard owns generic presentation. No compatibility aliases.                                          |
| 4 Semantic overloading | Domain adapters supply IDs and content; the base owns only preview interaction.                                                                                  |
| 5 Defaults             | Existing PR radius retained; diary single-commit previews adopt shared 500ms entry delay, retain zero trigger leave delay, and join the singleton.               |
| 6 Domain leakage       | Shared trigger imports no session renderer/data; custom rendering remains in its domain.                                                                         |
| 7 Discoverability      | Shared tokens and generic components live together under components/HoverCard.                                                                                   |
| 8 Wire protocol        | Not applicable: no transport/persistence/API changes.                                                                                                            |
| 9 Init parity          | One moved singleton for consumers and dismissal callers; session details remain deferred.                                                                        |
| 10 Resolver symmetry   | Not applicable: no data fallback/resolver changes.                                                                                                               |

Tests cover deferred mount, current-prop updates, missing identity, active-owner replacement, action dismissal, session loading boundaries, PR rendering and actual PR-to-diary-commit switching. Spotlight placement tests cover the import-only migration. No backend checks needed. Runtime visual/CPU checks remain unrun without computer-control authorization.
