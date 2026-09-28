# Agent Org PR8F user-observed issues handoff

> Status: Investigation complete; fixes not yet implemented
>
> Date: 2026-08-28
>
> Related issue: [org2AI/ORG2#997](https://github.com/org2AI/ORG2/issues/997)
>
> User reproduction session: `pr8f test 0828`
>
> Investigation environment: current packaged Tauri App, real `orlando / gpt-5.6-terra`
>
> Scope: This document records only issues personally observed by the user and attributed to PR8F. PR8S process stopping, incorrect Tester cancellation, and completion closure have been moved to a separate PR8S handoff document.
>
> **Delivery decision: This document retains only the root cause and test evidence for the original PR8F area. Fixes described here and fixes for the original PR8S area will be combined into one `PR8 Stabilization`; separate fix PRs will no longer be opened.**

## 1. The simplest conclusion

Of the four issues observed by the user, PR8F directly caused one core error:

> While the Team was working, the user sent a Group message. It was saved successfully, but went into the old inbox that the Coordinator no longer reads.

In plain terms: **the letter reached the old mailbox, but nobody checks it anymore.**

This error can also indirectly cause “all Tasks have finished, but Overview still says Needs attention,” because the unprocessed user message keeps the Team from formally closing out.

## 2. What the user sees

While the Team is working, the user sends:

`我想要做可以任意加注任何额度的加注，现在好像只能加20`

(“I want to be able to bet any amount; right now it seems limited to 20.”)

The user then observes:

- The message appears in Group Chat;
- the UI may show that the Coordinator is receiving it;
- the Team does not actually respond;
- the message remains there indefinitely;
- after switching Session, refreshing, or a state change, the waiting indicator may disappear;
- later, after all Tasks are terminal, Overview may still show Needs attention.

The Terra Provider did not actively ignore the message. Actual evidence shows that the Provider never received the message body.

## 3. How the design should work

When an ordinary Group message does not name a specific Member, the Coordinator Root handles it.

When the Coordinator is busy, the default behavior should be persistent FIFO queuing:

```text
User sends a Group message
        ↓
Persist it and bind a stable source identity
        ↓
Coordinator is busy: queue it for the next Coordinator Turn
        ↓
Materialize it exactly as Provider-visible input
        ↓
Provider observes and responds
        ↓
Acknowledge only this source as processed
```

It should not:

- hard-interrupt the current Member Task;
- wait for all Member Tasks to finish before handling it;
- send only a Wake with no message body;
- guess from frontend memory whether the message has been processed;
- restore the Coordinator’s blanket drain of the entire unread Inbox.

Full `@Member` GroupMention belongs to PR9; however, the Root message path for “no Member target or addressed only to the Coordinator” must continue working after PR8F.

## 4. What actually happened

### Legacy writer

The Group Chat send command continues to use the legacy path:

1. writes an ordinary user Inbox row;
2. calls generic Coordinator wake.

Relevant entry points:

- `src-tauri/crates/agent-core/src/state/commands/session/org_tasks/group_chat.rs`
- `src-tauri/crates/agent-core/src/core/tools/impls/orchestration/inbox_wake.rs`

### New PR8F reader

To eliminate duplicate triggers and incorrect bulk acknowledgments, PR8F changed the Coordinator’s formal input to read only exact FormalTriggerReceipt records:

- `src-tauri/crates/agent-core/src/core/session/turn/processor/inbox_drain/drain.rs`
- `src-tauri/crates/agent-core/src/core/coordination/agent_inbox/store_drain.rs`

A user-directed Group row is not a FormalTriggerReceipt, so it does not appear in the new Coordinator input batch.

### Resulting break in the flow

```text
Group message written to ordinary Inbox
        ↓
Generic wake creates a Coordinator Turn
        ↓
Coordinator queries only FormalTriggerReceipt
        ↓
User message not found
        ↓
Turn has no input and ends quickly
        ↓
Original message remains unread indefinitely
```

This is a compatibility regression caused by PR8F replacing the consumer without migrating the legacy producer; it is not a design requirement that user messages become ineffective.

## 5. Why the UI can mislead the user

The current Group Chat “receiving message” indicator is mainly a pending state held in React page memory; it is not reconstructed from a persistent observation receipt.

As a result:

- the message may still be unread even though the UI says it is being processed;
- after navigating away, local state is cleared, making it look as if the message was processed;
- after the Coordinator’s empty Turn ends, the UI cannot prove whether the Provider saw the body.

Relevant frontend entry point:

- `src/engines/ChatPanel/hooks/useAgentOrgGroupChatController.ts`

## 6. Effect on “Needs attention” remaining at the end

When the user sees all Tasks terminal but the Team still says Needs attention, there are two independent blockers:

1. the PR8F blocker covered here: the Group user message is still unread;
2. the PR8S blocker: after `Keep stopped`, the cancelled scope has no valid completion closure.

Fixing only the issue in this document can remove the “unprocessed user message” blocker, but cannot replace PR8S’s episode/completion fix. Conversely, fixing only PR8S completion cannot delete or disguise this unread user message.

## 7. Correct fix boundaries

1. Root/Group user messages must reuse the existing Root UserDirectedWork queue or establish an equivalent exact source receipt;
2. persist a stable source id, causation, target Coordinator, Turn identity, and FIFO sequence for every message;
3. commit the business message and persistent doorbell in the same transaction; in-memory wake is only an optimization;
4. when the Coordinator is busy, leave the message for the next Turn; do not mix it into the already materialized current Turn;
5. after Provider success, acknowledge only the source actually observed by the current Turn;
6. on crash, restart, or response loss, reuse the original message and identity; do not generate duplicate transcript input;
7. frontend pending/queued/observed state must come from persistent facts, not guesses based on local booleans;
8. do not restore the Coordinator’s blanket unread drain;
9. do not register ordinary user Group messages as FormalTriggerReceipt; formal work triggers and the UserDirectedWork queue remain two distinct, precise input sources;
10. ordinary SDE must not add Agent Org receipts, queries, timers, or listeners.

If implementation shows that a second Coordinator dispatcher, a new Task state, or a new general GroupMention protocol is required, stop immediately and update the Design; all of these are outside this fix’s scope.

## 8. Required tests

### Backend owning-boundary tests

- Send a Root Group message while the Coordinator is Working and while Idle;
- retain a later row for a busy Coordinator until the follow-up Turn;
- materialize and acknowledge each source only once;
- reuse the same message identity after response loss, Turn crash, and App restart;
- ensure the Coordinator does not also read another Task, Direct Member, or unmaterialized row;
- prevent incorrect finality while a message is pending, and remove the blocker exactly when it is observed;
- five Watchdog ticks must not duplicate messages, Wake events, or Provider Turns;
- database state has no side effects before or after Run View/page reads;
- no extra Agent Org work on the ordinary SDE path.

### Rendered E2E tests

- send through the real Group Chat input and Send button in the packaged Tauri App;
- send a new request during active work; the UI clearly shows Queued, then Observed/response;
- state remains consistent after Session switch, refresh, App exit, and restart;
- do not use a debug endpoint in place of input, sending, or observing the Provider response;
- `Command+5` and backend evidence together show there is no request storm or empty Wake.

### Real Provider tests

- use the fixed `orlando / gpt-5.6-terra`;
- run a real Member Task and send a second Group request before it finishes;
- the current Member Task is not hard-cancelled;
- the Coordinator reads the second request in the correct subsequent Turn;
- SQLite, EventStore, source/Turn identity, and Provider request counts agree;
- the message and response remain visible after restart.

## 9. Estimate

| Category | P50 | P90 |
| ------------------------------- | --------: | --------: |
| Production: Rust, wire, React | 1,200 | 2,800 |
| Unit, recovery, concurrency, E2E, real measurements | 1,800 | 3,700 |
| UI/mechanical adjustments and evidence | 500 | 1,000 |
| **Total review lines** | **3,500** | **7,500** |
| **Substantive files** | **22–32** | **40–55** |

The current PR8F implementation itself is 17,487 review lines. After this fix, the expected total is approximately:

- P50: 20,987 review lines;
- This fix reaching P90: 24,987 review lines.

This remains below the Design’s 36,000 review-line P90 stop threshold, but substantive files must be recounted during implementation. Do not reduce the scope by cutting real Provider, packaged App, restart, concurrency, or performance tests.

## 10. Explicitly out of scope for this document

- Tester background process and handoff: belongs to PR8S;
- `purpose` conflict in the Coordinator tool schema: belongs to PR8S;
- `Keep stopped` and completion closure: belongs to PR8S and requires a Design update;
- PR9 `@Member` GroupMention;
- PR10 final Group transcript projection;
- external user database migration.

## 11. Completion criteria

The user-observed messaging issue can be considered fixed only when all of the following are true:

- Group messages sent during active work are not lost and do not produce empty Wake events;
- when the Coordinator is busy, messages are persistently FIFO-queued instead of hard-interrupting the current Task;
- observed is shown only after the Provider has actually seen the body;
- pending state remains truthful after refresh, Session switch, and restart;
- each message has only one source, one materialized input, and one valid response;
- the fix does not restore blanket Inbox drain;
- user messages no longer incorrectly block final completion;
- the complete second-message scenario succeeds with real Terra + packaged App;
- Rust tests live in separate test files or the `tests/` directory; TypeScript/React tests use separate `.test.ts` / `.test.tsx` files; unrelated functionality is not accumulated in a large omnibus test file.
