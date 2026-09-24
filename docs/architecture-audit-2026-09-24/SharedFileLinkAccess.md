# Shared-link attachment authorization

Implements Share Sessions finding F3. Guest transcript reads previously used a replay token, while attachments used member-only RPCs. Signed-in guests now pass the same replay token to attachment lookup/get; the server reuses the transcript resolver.

Server counterpart: [ORGII-cloud-infra #147](https://github.com/org2AI/ORGII-cloud-infra/pull/147). Deploy the additive RPCs before releasing the client. This change does not deploy to production.

## Authoritative boundaries

- The server resolves the authoritative organization/session from the token. It does not trust client coordinates or metadata source aliases. Out-of-scope IDs, anonymous callers, expired/revoked links, metadata-only access, soft retention, and deleted resources are rejected.
- Member reads/writes and upload admission remain unchanged. Guests cannot upload. There are no public object URLs, recipient-local file reads, or alternate-permission retries after denial.
- The imported replay supplies the token through a mounted React Context shared by path references and explicit `orgii-file` links. Tokens are absent from copyable URLs, the DOM, and download names.
- Token/account/endpoint changes cancel requests and discard stale results. Loaded results remain token-bound. Existing abort and Blob URL cleanup runs on unmount.
- No historical data is modified. Historical files with only metadata-alias association remain denied until their provenance is separately verified and migrated.

## Ten-layer review

| Layer                 | Finding                                                                                             |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Compilation           | `pnpm typecheck:fast` and changed-file ESLint passed                                                |
| Structure/duplication | One file RPC client; Context in a leaf module avoids a lazy Viewer cycle                            |
| Naming                | Existing member names retained; guest APIs explicitly use `_by_share`                               |
| Semantics             | JWT is caller identity; share token is replay capability; neither substitutes for the other         |
| Defaults              | No token uses member APIs; a token requires guest APIs without downgrade on denial                  |
| Boundaries            | Model text cannot supply the capability; it comes from the imported share context                   |
| Understandability     | Guest access uses matching file authorization rather than requiring membership                      |
| Wire                  | Tests inspect serialized bodies: guest requests omit client org/session; content hash checks remain |
| Entry points          | Both path lookup and explicit file IDs carry capability; member entry points omit it                |
| Resolver symmetry     | Lookup/get share expiry, revocation, retention, and deletion checks                                 |

## Lifecycle and performance

| Area               | Verdict | Evidence                                               | Change or reason kept                     | Verification                                                      |
| ------------------ | ------- | ------------------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------- |
| Background work    | keep    | Reads still start on Viewer mount/reference change     | No polling, timers, or workers added      | Viewer request-count tests                                        |
| Memory             | keep    | Context lives with its mount; one current file         | No global token/cache registry            | Unmount/abort regressions                                         |
| Scope/isolation    | fix     | Guest capability previously missing from file requests | Token/endpoint scope; token-bound results | Delayed results after token switch, endpoint switch, and sign-out |
| Rendering/hot path | keep    | Context memoized by endpoint/token                     | Ordinary renders do not restart requests  | Single-mount request coverage and compiler lint                   |

| Lifecycle                                       | Evidence/limit                                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Mount, close, reopen                            | jsdom coverage; previous requests are abortable                                                      |
| Sign-in/out, token change                       | Stale-result regressions; no real-account E2E                                                        |
| Endpoint change                                 | No forwarding another endpoint's token; existing endpoint identity check retained                    |
| Revocation, expiry, retention, deletion         | Companion SQL rejects reads; already downloaded bytes cannot be recalled                             |
| Visible/hidden, offline recovery, two instances | No new desktop measurement; existing timeout/lifecycle retained                                      |
| Raw provider history                            | No Codex/Claude rewrite/rotation run; ingestion is unchanged and no compatibility acceptance claimed |

Performance verdict: blocked. Desktop CPU/RSS, two-instance HTTP/JWT, and the full foreground/background matrix remain unverified. This is an authorization fix, not a measured performance improvement.

## Verification and rollout

- Original `pnpm exec vitest run --config config/vitest.config.ts src/features/Org2Cloud/sharedSessionFilesClient.test.ts src/features/Org2Cloud/SharedSessionFileViewer.test.ts src/features/Org2Cloud/sharedSessionFileReference.test.ts`: 3 files / 33 passed.
- `pnpm typecheck:fast` and ESLint for seven changed TS/TSX files passed.
- Isolated backend SQL: content/revision lookup, missing path, nine denial cases, guest upload denial, and function execute permissions passed.
- No controls/layout changed. Changed components introduce no native button/input or clickable substitute. Context-only changes do not need visual screenshots.
- An older server still fails guest attachment reads without these RPCs; body reads remain independent. Merging only the client cannot restore guest attachment access.
- Client rollback restores the original member APIs. Additive server APIs may remain or have execute permission revoked; no data deletion or persisted-format rollback is required.

This English translation preserves the original evidence limits. Later test runs, including the 48-test integration result after #2119, are recorded in the PR description.
