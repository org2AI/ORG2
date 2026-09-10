# Account-scoped Mobile Remote runtime audit

Scope: native ticket admission and the shared runtime/auth owners required for reconnect. This is a dependent batch after the Desktop Cloud-auth UI change, with no scanner, icon or account settings UI changes.

| Layer                     | Evidence / verdict                                                                                                                                                            |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 Compilation             | `pnpm typecheck:fast` passed on the split tree; targeted suite results recorded in PR. Full Rust build is not passed (disk constraint)                                        |
| 2 Ownership/deduplication | Provider invokes extracted transcript, send, permission, model and roster owners; none is a definition-only abstraction. Platform owns ticket preparation                     |
| 3 Naming                  | `prepareSocketUrl` returns a credential-ready URL, not a durable pairing config; distinguish connection generation from turn intent ID                                        |
| 4 Semantic overload       | Cloud session = account credential; remote session = Desktop chat; transport = replaceable socket; transcript generation = subscription episode                               |
| 5 Defaults                | Initialize defaults missing permissions to read-only. Watch: unknown send-status values currently fall through to failed                                                      |
| 6 Boundaries              | Browser cookie and native ticket are platform implementations; shared Provider does not assemble Cloud Bearer requests                                                        |
| 7 Discoverability         | Controller ownership is explicit; remaining lifecycle risks below prevent unconditional approval                                                                              |
| 8 Wire                    | Generated Rust/TS contract with checksum and fixtures; native request uses Authorization header, trusted endpoint allowlist, no redirect, 4 KB response limit, one-use ticket |
| 9 Entry parity            | Native entry uses real auth; browser cookie/native ticket converge at shared initialize. Development root remains explicitly separate                                         |
| 10 Resolver symmetry      | Native admission reads the refreshed persisted account session and checks user, Cloud origin and expiry; no QR-selected endpoint receives a Cloud token unless allowlisted    |

## Review corrections

- Native ticket admission now has its exact production HTTPS Relay origin in the iOS CSP. The production endpoint/CSP regression checks the shipped configuration.
- Auth-owner cleanup invalidates generations and drains already-issued SDK/Keychain operations before a replacement owner authenticates. Tests cover stale successful/failed restores and a remount during an active persistence write.
- Roster reads now share one in-flight promise, with bounded trailing refresh/load-more intent. Burst, reset/client replacement and rejected-flight retry tests cover request ownership.
- Unknown send-status fallback remains a pre-existing protocol-hardening follow-up. Current desktop producers emit only completed/failed/cancelled; no new status is introduced by this PR.

No historical pairing data was deleted. No schema migration is needed. Rollback reverts the native admission and runtime changes together; the ticket-capable Worker remains a rollout dependency.

| Area               | Verdict | Evidence                                                                            | Change or reason kept                                  | Verification                                          |
| ------------------ | ------- | ----------------------------------------------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------- |
| Background work    | keep    | One roster flight with coalesced trailing intent; one reconnect timer               | Generation/client/reset cleanup retained               | Burst and retry regressions; existing reconnect suite |
| Memory             | keep    | Weak auth-owner map only retains pending drain; one roster flight                   | Settled drains are deleted; reset/unmount drops flight | Remount/reset tests; no RSS measurement               |
| Scope/isolation    | keep    | Retired auth owner cannot initiate stale persistence; new owner waits active writes | Auth and transport generations remain separate         | Success/failure/remount persistence tests             |
| Rendering/hot path | keep    | Existing provider API retained                                                      | No runtime speed claim                                 | Full MobileRemote suite                               |

Verification after integration with develop: `pnpm exec vitest run --config config/vitest.config.ts src/modules/MobileRemote` passed 262 tests in 45 files; `pnpm typecheck:fast` passed; scoped ESLint and `git diff --check` passed. Full Rust/device builds and physical visible/hidden CPU/RSS measurements were not run for this corrective pass. Existing clean worktree lacks Husky bootstrap; commits use explicitly run checks instead.

Performance verdict: blocked pending real-device lifecycle measurements; the reproduced duplicate-request and stale-owner-write failures are fixed and regression-tested. Provider ingestion/raw-source transitions are unchanged and outside this audit.
