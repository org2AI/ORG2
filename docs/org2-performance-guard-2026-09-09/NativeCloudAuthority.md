# Native cloud replay authority

## Failure and invariant

A real new Codex session had a complete native rollout with its user prompt, assistant commentary, package.json tool call/result and final answer. The live EventStore persisted only two assistant messages. Cloud upload preferred any populated EventStore and published those two rows. Remote streaming import persisted them but produced no turn headers, then failed with `Failed to hydrate streamed replay turn window`.

The native provider transcript is authoritative whenever the CLI binding says native. The cloud owner now includes the native root revision in its existing execution revision stamp, even without continuation children. That selects the existing canonical root-plus-child reader, rejects unavailable/changed reads, invalidates cold partial-cache proofs, and preserves unchanged-pass skipping. Legacy chunk-backed and non-CLI sources keep their existing reader. There is no added polling, timer, listener, cache or database format.

The transient writer is `session_runner/helpers.rs::persist_and_broadcast_streaming_complete`; its partial output is legitimate. The defect was the consuming upload boundary treating it as complete. No UI filter or manually seeded history was introduced.

## Verification

- `pnpm test src/features/Org2Cloud/org2CloudSessionSync src/features/Org2Cloud/org2CloudSyncEngine`: 152 passed across 15 files, including native root with populated partial cache, unchanged-pass skip, root-only revision change, unstable/unavailable roots, legacy behavior and two cold owners.
- `pnpm typecheck`, changed-file ESLint, `git diff --check`: passed. An initial direct Vitest command omitted the repository config and collected no tests; corrected to the package script above.
- Production frontend and both signed macOS bundles built. Integration includes #1465, #1485, #1486 and #1487 plus this change.
- Two actual ORG2 instances on the same Mac, independent homes/provider roots/accounts. No model or transport mocks, cache injection or database repair.
- Before fix: new Astra source published 2 assistant-only events and A failed to import. Native source retained all history.
- After fix: a fresh Astra source with a real read-only package.json tool request published 6 events at epoch 1; A's first open displayed the complete turn. B began with 31 and project marker 白桦. A Astra answered 33; B Astra received it and answered 36. A's new native UUID and B's original UUID both remain in the selected repository checkout.
- On that same history B switched to Claude. Opus rejected an ordinary continuation with provider `reasoning_extraction`; the request settled idle. Fable 5.1 High then retained package/version/marker and answered 37. A reopened the cloud view, selected Astra, and answered 38; B displayed 38. The refusal remained in history. Earlier Opus conversion on the 青松 history succeeded (17 → 20), followed by A Astra 22 and B Astra 23.
- Source native JSONL and receiving Chat were inspected, including original tool use/result and all prior user/assistant pairs. Switching provider generates the appropriate native session binding; returning to the original account can reuse its original UUID.
- Fleet ledger: 2901 → 2903 rows, 2 added test roots, 0 removals, 0 deletion/access changes. Two existing native Codex roots repaired assistant-only replay (counts 2 → 13 and 1 → 12; epochs 2 → 3 and 1 → 2). No count decreases. The fixed fresh source reached 16 events at epoch 1; the earlier malformed test source recovered at epoch 2. These are legitimate authority corrections, not a claim of zero epoch changes.

## Performance and lifecycle

| Area               | Verdict | Evidence                                                | Change or reason kept                                   | Verification                                                                   |
| ------------------ | ------- | ------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Background work    | keep    | Existing scoped sync-pass owner                         | Add root revision to the existing clean stamp; no timer | Unchanged second pass skips canonical read                                     |
| Memory             | keep    | Canonical full replay already returns a complete result | No retained body cache introduced                       | Real short-session roundtrips; earlier #1465 large-reader results are separate |
| Scope/isolation    | keep    | Existing endpoint/account/org cursor identity           | No new global cache or credentials path                 | Primary + isolated Instance 2 with distinct local accounts                     |
| Rendering/hot path | fix     | Remote import cannot index an assistant-only replay     | Correct producer source instead of filtering UI         | Fresh cloud turn renders on first open                                         |

Two minimized instances were sampled with calibrated libproc counters, four attributed processes each. A 59.3-second settled observation averaged about 4.92% CPU for A and 1.40% for B (one core = 100%); summed physical footprint was stable at approximately 819.2 / 606.8 MiB. Earlier post-interaction cooldown was noisier. This is not zero whole-app CPU, a controlled develop comparison, or proof of document visibility timing. Existing user data/background services were present, and other work was active on the machine. Root revision queries add filesystem metadata work to an already scheduled pass; changed native roots still require a complete canonical replay. A large cold catalog can do more correct initial work than the former partial-cache shortcut.

| Provider                | Raw transition                  | App/UI state                               | Topology/boundary      | Expected invariant                     | Observed evidence                                                        |
| ----------------------- | ------------------------------- | ------------------------------------------ | ---------------------- | -------------------------------------- | ------------------------------------------------------------------------ |
| Codex Astra             | create + real tool output       | fresh B; first A open                      | B → cloud → A          | Full user/tool/answer replay           | 6 events, epoch 1, first open succeeds                                   |
| Codex Astra             | append / new UUID               | both open; normal restart between packages | B → A → B              | Context and checkout preserved         | 31 → 33 → 36, native files inspected                                     |
| Claude Opus / Fable 5.1 | convert from Codex              | existing conversation                      | B conversion → A Astra | Native history survives runtime switch | Opus earlier pass; later provider refusal preserved; Fable 37 → Astra 38 |
| Both                    | compact / rotate / large export | not rerun for this upload fix              | not run                | No unsupported coverage claim          | See #1465 source-reader evidence, separate scope                         |

Already-open cloud replay can require reopening (#1467). Team Chat comments are separate from native user messages. Official native App foreground continuation was not repeated by this cloud test; conversion project assignment is a separate follow-up. No account/endpoint switch, revocation, Windows/Linux or second physical computer certification is claimed.

Performance verdict: blocked for a blanket whole-app idle/full-lifecycle certification; functional upload/roundtrip checks pass. The measured run does not demonstrate near-zero whole-app idle CPU, and no controlled attribution to this change was performed.

## Recovery

Existing malformed cloud replay is repaired by the ordinary authoritative sync pass, with its existing epoch reconciliation. No native histories or cloud rows were deleted. Revert the bundled frontend change to roll back; complete native histories remain intact, although the old incomplete-upload defect would return.
