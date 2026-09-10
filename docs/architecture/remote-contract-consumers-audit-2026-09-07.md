# Desktop Relay contract consumers audit

Scope: Desktop TypeScript API wrapper and Rust management-route callsites, relative to #1380.

| Layer                        | Verdict | Evidence / decision                                                                                  |
| ---------------------------- | ------- | ---------------------------------------------------------------------------------------------------- |
| Ownership and boundaries     | keep    | Rust protocol crate remains the canonical wire owner; wrapper imports generated exports              |
| Types                        | keep    | Remove three manual duplicate wire definitions; generated PermissionTier narrows to supported values |
| State machines               | skipped | No new state or transition                                                                           |
| Naming                       | keep    | Existing PairingInitOutput alias retained for callers                                                |
| Wire protocol                | keep    | Five paths retain exact old string values; no runtime payload conversion                             |
| Init parity                  | keep    | Both local and production management calls share constants                                           |
| Dead code / duplication      | keep    | Deletes duplicate interfaces rather than introducing another registry                                |
| Error semantics              | skipped | Request error path unchanged                                                                         |
| Lifecycle / performance      | keep    | No new resources, polling or caches                                                                  |
| Verification / compatibility | blocked | Typecheck and generated-artifact verification apply; full Desktop Rust build remains unverified      |

No UI components changed; visual audit and screenshots are not applicable. No persistence migration or wire-format change. Reverting this consumer-only commit restores manual declarations without altering generated artifacts. Parent #1380 remains Draft due separately documented runtime issues. This audit makes no runtime performance improvement claim.

Verification commands and exact outcomes are recorded in the PR. Full application Rust checks must not be inferred from the protocol crate's passing tests or a staged-file hook's nonblocking diagnostic.
