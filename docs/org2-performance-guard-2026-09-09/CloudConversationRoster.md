# Cloud continuation roster demand

## Authoritative boundary and failure

A real shared native Claude session successfully produced its initial Opus reply. Its cloud row held the complete two-event replay at epoch 1. A later explicit continuation never reached the provider: the queue logged `Cloud conversation family metadata is not ready` on successive recovery attempts while Team Sessions remained Loading.

The authoritative metadata is the authenticated cloud session listing. `dispatchQueuedCloudConversation` read only the identity-bound frontend cache; its only loader lived inside the sidebar hook. A cold, hidden or unmounted sidebar could leave a valid user intent waiting without any execution-owned operation able to satisfy that prerequisite. The actual run proves the missing-cache execution failure; it does not prove why the operating system's window visibility did not recover. CUA coordinate actions returned `noWindowsAvailable` and Dock access timed out.

## Change and invariant

The existing loader is now a store-scoped callable shared by the sidebar and explicit execution. The queue awaits it only when family metadata is not ready, then rechecks bound identity before using the result. Passive sidebar visibility and focus gates are unchanged. Concurrent requests for the same endpoint/user/org share the same in-flight promise; completion and failure release it. The cache still has its existing 64-entry bound and identity labels. No new timer, retry owner, completed-body cache, dependency or wire/schema change is introduced.

The source-level invariant is: an accepted user action can acquire its own required authenticated roster without relying on a mounted visible sidebar, and cannot consume another account's late response. Definitive absence after a successful listing still fails closed. Existing queue recovery handles transient listing failures. Historical remediation: none; no sessions, cloud rows or user credentials were edited by this fix.

## Verification

- The new execution-boundary test failed before the fix with the exact live error. It passes without mounting any sidebar after the change.
- `pnpm test src/features/Org2Cloud/org2CloudRemoteSessionsAtom src/features/Org2Cloud/SessionConversation/cloudConversationQueueAdapter.test.ts src/features/Org2Cloud/SessionConversation/conversationTurnRunner.test.ts` — 43 passed across four files.
- The lifecycle tests verify hidden passive loading remains off, two explicit callers share one promise, the shared result reaches the mounted hidden subscriber, an account change discards the old response, and failure releases the request for the next action retry.
- `pnpm typecheck:fast`, changed-file ESLint and normal pre-commit checks — passed. A first check using another checkout's node_modules lacked `jsqr`; installing this checkout's frozen lockfile resolved that environment mismatch without changing the lockfile.
- Integration packages containing native replay PR #1465 plus this change were built and signed for both independent app identities. An existing blocked secondary Opus turn reached the provider after upgrade (that particular prompt received a provider safety rejection); an ordinary follow-up completed successfully in the same native session. Main Fable 5.1 initial and continuation requests both completed. Main then opened the secondary conversation, displayed its exact previous answer, and completed an Opus continuation in a new native UUID. Unit call counts are not a claim about whole-app CPU, RAM or rendered latency.

| Area               | Verdict | Evidence                                                       | Change or reason kept                                                              | Verification                                                                       |
| ------------------ | ------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Background work    | fix     | Queue previously retried a cache prerequisite it never loaded  | Explicit action-owned fetch, existing retry owner; passive hidden work remains off | Hidden lifecycle and execution regressions                                         |
| Memory             | keep    | Store-scoped weak ownership; only active promises are retained | Existing 64-entry row/version caps; finally releases requests                      | Same-promise concurrency and failure/retry tests                                   |
| Scope/isolation    | keep    | Endpoint/user/org request key and response identity check      | No cross-account result commit or absence bypass                                   | Late account-switch response test and existing admission tests                     |
| Rendering/hot path | keep    | Existing row identity retention and narrow hook subscriptions  | No UI layout or new render subscription                                            | Hook lifecycle tests; real secondary queue recovery and main continuation verified |

Architecture review covered authoritative ownership, async control flow, identity, cancellation/retry ownership and shared request lifecycle. React guidance applied to explicit-action ownership and single-flight work; Next.js/server patterns and UI design-system auditing do not apply. Rollback is a bundle revert; no data migration or cleanup is needed.

## Runtime scope and remaining boundaries

The receiving main Chat showed the complete secondary Opus answer and the new main answer, with terminal idle state. This verifies the explicit-action roster prerequisite in actual packages, including a previously durable blocked request. It does not prove passive list freshness: the secondary team listing remained stale during this run. Window focus/coordinate operations were unreliable (`noWindowsAvailable`), so no precise focus-return latency is claimed. Automatic replay refresh remains a separate issue.

A new continuation selected the first matching local clone rather than the source checkout when both existed. This is a separate existing checkout resolver issue, not fixed in this roster change. No historical session was relocated.

During the mixed startup/request/UI workload, four attributed GUI processes per instance were sampled for roughly 14–16 minutes: main mean CPU 4.66%, p95 16.11%, peak physical footprint 931.1 MiB; secondary mean 3.48%, p95 4.19%, peak 635.0 MiB. Provider CLI children were not included. These uncontrolled interaction/visibility measurements are not an idle budget or A/B improvement claim. The sampler was stopped after collection.

Performance verdict: blocked for full lifecycle certification because reliable visible/hidden/focus timing and fully controlled passive refresh timing were not completed. The action-owned request, concurrency, identity, and cleanup tests pass; actual blocked-queue recovery and successful provider execution pass.

Subsequent roundtrip verification: secondary continued the same shared conversation after main's new-UUID answer. Both its Chat and native JSONL included the remote answer followed by the new local answer. Main reopened and rendered the latter. After main restarted with #1486, another new native child used the correct source checkout and completed successfully. Secondary then normally restarted and displayed that new answer on opening the original conversation. This supersedes the earlier reverse-reception gap; it does not prove passive idle freshness.
