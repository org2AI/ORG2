# Native Codex delegated-refresh verification

Date: 2026-09-20. Scope: verify the proposed reuse of an existing local Codex login before redesigning ORG2 credential ownership. No production changes were made during this verification.

## Decision

**Reject launching an additional native Codex process as a complete concurrency solution.** A single native process can refresh an existing managed login without a browser login, but separate native processes still submit the same refresh token concurrently. Replacing auth.json with another account while a refresh is in flight also produces mixed account/token identity.

These are observations of the installed executables using synthetic credentials, not assumptions inferred from the existence of an RPC method.

## Method and isolation

- Executables: npm-installed `codex-cli 0.154.0`; desktop-bundled `codex-cli 0.155.0-alpha.9.2`, both macOS arm64.
- Python stdlib harness: [native_codex_refresh_probe.py](native_codex_refresh_probe.py). Recorded outcomes: [native_codex_refresh_results.json](native_codex_refresh_results.json).
- Each run creates a new temporary HOME, CODEX_HOME, working directory and TMPDIR. Child environments are constructed explicitly instead of inheriting credentials. `cli_auth_credentials_store="file"` avoids using the real OS credential store.
- Only generated, unsigned fixture JWTs and `fixture-*` refresh tokens are written or sent. Real user credentials and live application processes are not inspected or modified.
- `CODEX_REFRESH_TOKEN_URL_OVERRIDE` directs refresh requests to a loopback HTTP server. HTTP/HTTPS/all-proxy settings direct other HTTP traffic to the same server, which rejects it without forwarding. The recorded blocked destinations are startup requests to ChatGPT. No real OAuth endpoint is exercised. This proxy setup is not an OS network sandbox.
- The fake server records request arrival and consumes each token once, rejecting reuse. An event barrier holds responses so overlapping requests and file replacements happen deterministically before completion. Thus duplicate submission is observed independently of the fake server's reuse policy; the resulting rejection assumes single-use rotation semantics, not a measured production-server grace period.
- Every launched process gets a separate process group. Cleanup sends TERM and escalates to KILL after two seconds if needed. RPCs have a 15-second timeout; mock response barriers have a 12-second upper bound.

## Results

| Scenario                                                                    | CLI 0.154.0                                                                                    | Desktop 0.155.0-alpha.9.2                                                                 | Meaning                                                                                                            |
| --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| One process, proactive refresh                                              | R0 → R1 persisted; account/read succeeds                                                       | R0 → R1 persisted; subsequent routing lookup fails because external networking is blocked | Existing login can be refreshed without browser authorization; desktop end-to-end RPC success is not established   |
| Two processes, same CODEX_HOME                                              | Two R0 requests arrive before either response; one succeeds and the other returns account=null | Same duplicate requests and account=null on rejected request                              | No cross-process serialization in this path                                                                        |
| Second process starts before first refresh but calls after first completion | Only one total refresh request; second process adopts disk result                              | Same request count and persisted result                                                   | Guarded reload handles an already-completed rotation, not overlapping requests                                     |
| Account A refresh in flight; atomically replace file with B                 | Final account_id=B, but ID/access token and refresh token belong to A                          | Same mixed identity                                                                       | Completion does not preserve the new login's token bundle                                                          |
| Two overlapping RPCs to one process                                         | Requests serialize as R0 then R1; no duplicate R0                                              | Same                                                                                      | Tested single-process serialization; it does not imply cross-process coordination or request coalescing            |
| Delete auth.json while refresh is in flight                                 | File stays deleted; RPC still returns A from memory                                            | File stays deleted; routing lookup fails                                                  | No file resurrection observed; successful account/read alone is not proof of current persisted login               |
| Separate CODEX_HOMEs with copied R0                                         | Both consume R0; one is rejected                                                               | Same                                                                                      | Isolated profile paths do not make a copied refresh token independent                                              |
| Kill refresher after server accepts R0, before response                     | Process exits; disk remains R0; retry is rejected and account=null                             | Same                                                                                      | Cancellation can strand a rotated token under single-use semantics; process cleanup alone is insufficient recovery |

Both eight-scenario runs completed. CLI baseline/concurrency/switch/separate-home observations also reproduced in an earlier six-scenario exploratory run. Explicit post-run assertions checked the duplicate requests, mixed identity, stale reload, single-process ordering, logout persistence and cancellation recovery outcomes. These assertions confirm the reproductions; they are **not passing safety acceptance tests**.

Desktop limitation: the installed alpha additionally performs workspace routing discovery after refresh. That request was deliberately blocked and produced `workspace routing discovery failed`; only token-endpoint and persistence observations are claimed for those responses.

## Reproduction commands

The following were executed with the respective absolute executable paths supplied through `--binary`:

```sh
python3 -u native_codex_refresh_probe.py --binary /absolute/path/to/npm/native/codex
python3 -u native_codex_refresh_probe.py --binary /absolute/path/to/desktop/native/codex
```

The script prints each scenario and an `ARTIFACT_DIR` containing isolated fixture files, stderr and results. Paths above intentionally omit machine-specific prefixes. Reproduction does not require an API key or user login.

## Product implications and remaining work

1. No evidence supports forcing every imported user to sign in again immediately. Existing access tokens remain reusable while valid; passive adoption of a newer local login remains a possible UX path.
2. Delegation to a newly launched native process does **not** establish a single refresh owner. An ORG2-only mutex/file lock cannot coordinate independent native processes that do not participate in it.
3. Sharing one existing owner/refresh broker could preserve automatic refresh without another browser login, but connecting all relevant applications to it has not been verified and is not implemented here. Do not equate a separate app-server process with access to the existing desktop process.
4. A read-through/adoption design can preserve scan/import convenience but cannot promise unattended refresh when the local owner is inactive. A copied refresh token in another HOME is not an independent authorization.
5. No real-server token grace period, genuine OAuth authorization, Windows behavior, Kiro resume, or CPU/RSS lifecycle matrix was tested. Startup HTTP attempts were observed, so a per-refresh process is also not a demonstrated low-cost background design.

Performance/concurrency verdict: **fail for the proposed unconditional concurrency guarantee**. These probes do not establish cross-process refresh exclusivity. The subsequent fixes preserve best-effort recovery and writeback rather than introducing exclusive refresh ownership. No real credential or historical data cleanup was performed.

## Official interface reference

[OpenAI app-server documentation](https://developers.openai.com/codex/app-server) describes `account/read` with `refreshToken: true` as forcing a refresh in managed ChatGPT mode, and being ignored in external-token mode. That documentation establishes the interface, not a cross-process concurrency guarantee. The loopback override was identified in the installed executable and verified experimentally; it is used only by this harness.
