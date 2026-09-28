# Agent Org PR8F Real Provider Investigation and Fix Handoff

> Investigation status: Cross-checking of the packaged Tauri App, real Provider, SQLite, EventStore, and code write paths is complete; **the fixes in this document have not yet been implemented**
>
> Investigation date: 2026-08-28
>
> Related issue: [org2AI/ORG2#997](https://github.com/org2AI/ORG2/issues/997)
>
> Investigation branch: `codex/issue-997-formal-convergence`
>
> HEAD at investigation time: `182bd899361e1bcbac7f7140f43e77191acd4272`
>
> User reproduction Session: `pr8f test 0828`
>
> Real Provider: account label `orlando` / `gpt-5.6-terra`; no credentials were read or recorded
>
> Current conclusion: PR8F cannot yet be declared complete or Ready. All four user-reported issues have real persistence evidence: two are direct PR8F regressions, one is a PR8S/PR8F cross-boundary race, and one requires additional episode-convergence design. Further work during this investigation also found that Pause/Resume breaks completion proof, Direct replies leak into Group Chat, and the UI exposes an `@Member` entry point that the backend does not yet support.

## 1. Plain-language summary

This was not caused by insufficient model capability or an unresponsive Terra Provider. A normal Direct Member message received a real Terra reply in about 6 seconds, showing that the account, model, and basic runtime path work.

The actual problem is that several “handoff records” in the system do not line up:

```text
The user sends a new request in Group Chat
→ The message is written to the database
→ The Coordinator is woken up
→ But it does not receive that message when it wakes
→ The message stays unread while the UI may appear to show it was handled
```

```text
The Tester is still stopping the test server and preparing to submit its result
→ The Coordinator cancels its Task and creates a replacement first
→ The Tester immediately loses cleanup and submission permissions
→ Although it completed the test, the system rejects its result
→ A background process may still be running, leaving the user to decide how to handle the risk
```

```text
All Tasks become completed or cancelled
→ But the old cancelled work has no provable delivery result
→ New tasks are mixed into the same episode and later succeed
→ The system can neither prove “everything was delivered” nor correctly say “the entire episode was cancelled”
→ It can only show Needs attention
```

More plainly: **An Agent doing work does not mean the system can prove which Task owns that work, whether the result was saved, whether old work stopped safely, or whether the whole episode really ended.** PR8F is intended to complete this formal result chain, so these failures cannot be treated as copy issues or isolated incidents.

## 2. Investigation scope and authoritative sources

This investigation followed these boundaries:

- The Design document is authoritative: `docs/architecture/agent-org-long-lived-team-session-design.md`.
- Issue #997 and the PR8F plan explain delivery goals but do not override Design invariants.
- UI symptoms are only the entry point; root causes must be traced to persisted facts and the earliest production write boundary.
- Debug endpoints are used only to read evidence or create isolated failure preconditions. They do not replace real buttons, input fields, confirmation dialogs, or Session switching.
- This investigation did not modify product code or clean up the user's normal `ORGII_HOME`.

The Design rules most relevant to this investigation:

| Design location | Rule | Relevance to this investigation |
| ----------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Design location | Rule | Relevance to this investigation |
| ----------------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------- |
| Invariant 11, around line 355 | Unmentioned Group Chat user messages belong to the Coordinator | An ordinary Group Chat message cannot be written to Inbox and then remain unread forever |
| Invariant 48, around line 392 | If old execution may have unknown external effects, the user must decide the handoff | Needs attention can be justified for safety, but the worker must retain cleanup ability first |
| Invariants 50–55, around line 394 | Plan, formal trigger, and final summary must have unique persisted identities | PR8F cannot substitute an empty Wake, UI guesses, or Task counts for the formal result chain |
| Activation generation, around line 1256 | Generation is a work-authorization epoch | Pause/Resume must not treat it as a new delivery episode identity |
| §25.11B PR8F, around line 2621 | PR8F owns Plan → formal event → final report | Routing Group user facts to the Coordinator, saving TaskOutput, and producing the final report are all part of the acceptance path |

## 3. Real test environment and verifiable evidence

### 3.1 Packaged App

| Item | Value |
| --------------- | ------------------------------------------------------------------ |
| App bundle      | `<repo>/src-tauri/target/dev-build/bundle/macos/ORG2.app`          |
| Executable | `.../Contents/MacOS/org2` |
| SHA-256         | `934f78cb4298a078b60907f06b71b93f0813b8d589c7d358e66c2f3c64f6678d` |
| Build time | `2026-08-28 08:14:06 +0800` |
| Binary size | `167524048` bytes |
| Isolated ORGII_HOME | `<isolated-orgii-home>` |
| SQLite          | `<isolated-orgii-home>/sessions.db`                                |

This means the evidence came from a real macOS App built from the current branch, not a browser dev server or an older app under `/Applications`.

### 3.2 Reproduction target

| Object | ID |
| ------------ | --------------------------------------------------------- |
| Root Session | `sdeagent-agent-org-ee007dfa-c0d4-4251-80e3-5cc272431dae` |
| Run          | `agent-org-run-ec5d40d6-6808-4936-97bf-9568d35eb22e`      |
| Session name | `pr8f test 0828` |

Persisted state at the end of the investigation:

- Run is still `running`, while all Members appear Idle in the UI.
- There are 8 Tasks: 5 completed and 3 cancelled.
- No completion certificate exists.
- No FinalSummaryReceipt exists, so the final summary never started.
- There are 18 FormalTriggerReceipts; all are resolved and 0 are pending.
- The original user Group Chat message remains unread; the diagnostic Group Chat message added during this investigation is also unread.
- After Pause/Resume, the Run's `activation_generation` changed from 1 to 3, but all 8 Tasks still belong to generation 1.

“All FormalTriggerReceipts are resolved” is important: it proves the final blockage is not “an unprocessed PR8F formal trigger remains.” The contracts for user-message routing, Task episode closure, and the completion candidate itself are invalid.

## 4. Timeline of user-reported issues

The following are UTC timestamps recorded in SQLite/EventStore.

| Time | Event | Result |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 02:25:21 | User sends “我想要做可以任意加注任何额度的加注，现在好像只能加20” (“I want to be able to raise by any amount; right now it seems I can only raise by 20”) | Successfully written to Inbox, but remains unread |
| Around 02:25:21 | Coordinator is woken by a generic Wake | Turn quickly ends without doing work; the user message is not materialized |
| 02:25:58 | Coordinator performs cancel-and-replace on a Tester still cleaning up the test environment | The original Tester Task immediately loses permission |
| 02:26:11–02:26:59 | Tester continues calling task, terminal, message, and await tools | All are rejected because the Turn context is no longer valid |
| 02:27:05 | Tester Turn fails because background work has not settled | External effect is marked unknown; Needs attention appears |
| 02:27:28 | User chooses Keep stopped | Only the replacement Task is cancelled; the entire Team is not stopped |
| 02:30:39 | User resends the request through the Root composer | This time it enters the EventStore Root user-message path, and the Coordinator creates new Tasks normally |
| 02:39:37 and 02:39:46 | Coordinator tries to send material_change/blocker messages to Tester | Backend rejects both because `purpose` is invalid |
| 02:40:13 | Coordinator performs cancel-and-replace again | Tester later finishes, but TaskOutput submission is rejected |
| 02:40:22 | Tester calls task complete | Fails because the Task has already been cancelled |
| Later | Replacement completes; all Tasks are terminal | No completion certificate; Overview still shows Needs attention |

## 5. Issue 1: Tester requires manual user intervention, and Keep stopped is unclear

### 5.1 What the user sees

- Tester appears to have failed testing or become stuck.
- Overview shows Needs attention.
- The user must choose among Continue replacement, Keep stopped, and Abandon episode.
- The user chooses Keep stopped thinking it will “cancel this Task,” then sees failed/idle; after sending another message, the Team resumes work.

### 5.2 What actually happened

First-round Tester Task: `11f522...`.

The Tester still had background test-server process `PID 36050` and was reading results and shutting down the environment. At `02:25:58`, the Coordinator performed cancel-and-replace first. As soon as the original Task was cancelled, all subsequent Tester calls were rejected with `agent_org_turn_context_invalid`:

- `task_get`：02:26:11；
- `inspect_terminals`：02:26:37；
- `org_send_message`：02:26:46；
- `await_output`：02:26:59。

The Tester explicitly reported that it could no longer terminate PID 36050. Turn `7ac6f210...` then failed at 02:27:05 because the Agent Org Turn tried to end before its background work had settled.

The system therefore created handoff receipt `2214fdaa...`, with:

- `external_effect_unknown = 1`；
- `local_effect_count = 0`。

This means “the system cannot prove whether the old execution left an effect running externally.” Under Design invariant 48, asking the user to decide in this situation is the correct safety behavior.

### 5.3 Root cause

The problem is not “why does a safety system need user confirmation?” The order is wrong:

```text
Correct order: Revoke permission for new work → retain limited cleanup permission → prove the old process stopped → then hand off
Current order: Cancel Task → immediately revoke all tool permissions → worker cannot even clean up → report unknown
```

The Coordinator should not receive shell/kill permissions. It schedules work; it does not execute it. The original TaskExecution worker should perform cleanup, using only tightly restricted cleanup tools and doing no further business work.

Production behavior entry points:

- `src-tauri/crates/agent-core/src/state/commands/session/org_tasks/handoff.rs:445`
- `src/engines/ChatPanel/InputArea/components/AgentOrgOverviewPanel.tsx:835`
- Confirmation warning around line 1275 of the same Overview component

### 5.4 What the three options actually mean

| Option | Actual behavior | Plain-language meaning |
| -------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| Continue replacement | Accept or confirm that the old execution has stopped, then let the replacement continue | “I confirm the old worker can no longer have an effect; let the replacement continue.” |
| Keep stopped | Cancel the replacement and do not restart the old Task; sibling Tasks may continue | “Do not proceed with this handoff for now,” not “stop the entire Team” |
| Abandon episode | Cancel all open Tasks in this episode; outcome is Cancelled | “Abandon this entire round of work.” |

The main card currently shows only short labels; explanations are mostly hidden in a subsequent confirmation dialog. The user cannot understand the scope before making a high-impact choice. This is a separate UX defect.

### 5.5 Required fix

1. After cancel-and-replace, the original worker enters a cleanup-only phase.
2. Cleanup-only may stop/read only the terminals, processes, jobs, and necessary results owned by that worker. It cannot continue product changes or create new Tasks.
3. Once cleanup succeeds and the external effect is verifiably terminal, the system completes the handoff automatically without interrupting the user.
4. Show Needs attention only if cleanup times out, crashes, or the result truly cannot be verified.
5. On the main card, Overview must state whether each button affects “the current replacement” or “the entire episode.”
6. After `Keep stopped`, show the exact cancelled Task, sibling Tasks that will continue, and whether the cancelled Task blocks final delivery.

### 5.6 Required regression tests

- Perform cancel-and-replace while the worker owns a real child process; verify the original worker is restricted to cleanup and can stop the process.
- Successful cleanup: do not create an unknown-effect handoff and do not require user confirmation.
- Failed cleanup: create one handoff receipt; still only one after restart and five Watchdog runs.
- Verify the Task scope, episode scope, and final state for each button; do not merely test that a button is clickable.
- Put Rust tests in a separate test file corresponding to handoff or in `tests/`; do not place large test blocks in production files.

## 6. Issue 2: A Group Chat message sent while the Team is working sits unread

### 6.1 What the user sees

The user sends a new request in Group Chat. The UI briefly shows “Coordinator is picking up your message,” but the Team does not respond. After navigating away, pausing, or restarting, the indicator may disappear, making it look as if the message was handled.

### 6.2 Evidence from the original message

Inbox row 25：

- Time: `2026-08-28T02:25:21.423384+00:00`;
- Sender: `_user`;
- Recipient: Coordinator;
- Body: `我想要做可以任意加注任何额度的加注，现在好像只能加20` (“I want to be able to raise by any amount; right now it seems I can only raise by 20”);
- Still unread at the end of the investigation.

Coordinator resume Turn `4583907f...` started about 0.1 seconds after the message was written and ended about 0.3 seconds later, without a materialized input or corresponding EventStore message.

The user later resent it through the regular Root composer, and the message entered EventStore as `user_submit`. The Coordinator created a Task graph normally at 02:30:55, and only then did the team continue working.

### 6.3 Second reproduction through the real UI

Sent through the packaged App's real Group Chat input field and Send button:

`【PR8F诊断-0828-A】请只回复“收到”，不要创建任务。` (“[PR8F diagnostic 0828-A] Reply only ‘Received’; do not create a task.”)

Result:

- Inbox row 41 was added;
- Coordinator Turn `fcfca73e...` was created at 03:20:50.655;
- It completed at 03:20:50.830, after about 175 ms;
- Row 41 remained unread;
- There was no corresponding EventStore input or reply;
- The UI's picking-up indicator persisted until a state change made it disappear.

This was not “the model deciding to ignore the message.” The Provider never received the body.

### 6.4 Root cause

The production Group Chat command still uses the old path:

- First writes to the ordinary user Inbox: `src-tauri/crates/agent-core/src/state/commands/session/org_tasks/group_chat.rs:303`;
- Then sends a generic Wake: around line 364 of the same file.

PR8F changed the Coordinator's production drain from “read all unread Inbox rows in bulk” to “read only the exact FormalTriggerReceipt”:

- `src-tauri/crates/agent-core/src/core/session/turn/processor/inbox_drain/drain.rs:154`
- The formal drain explicitly excludes user-directed rows: `src-tauri/crates/agent-core/src/core/coordination/agent_inbox/store_drain.rs:348`

The generic Wake has no formal receipt to bind to:

- `src-tauri/crates/agent-core/src/core/coordination/orchestration/inbox_wake.rs:98`

Therefore, the current path is:

```text
Message is persisted successfully
→ Generic Wake succeeds
→ Coordinator creates an empty Turn with no input
→ Turn ends immediately
→ Original message remains unread forever
```

### 6.5 Why the UI is misleading

The Group Chat pending state is only a local boolean in React memory:

- `src/engines/ChatPanel/hooks/useAgentOrgGroupChatController.ts:138`
- It is cleared around lines 142 and 163 when the Session/toggle changes.

It is not reconstructed from unread Inbox rows or a formal observation receipt. Thus the same unhandled message may first show “processing” and later show no indicator, making it look complete.

### 6.6 Required fix

Do not restore the Coordinator's blanket unread drain. That would reintroduce the problem PR8F is meant to eliminate: accidentally consuming another Task's message or a user-directed message.

The right direction is to give Root/Group user messages a precise path:

```text
user source id
→ Bind exactly one Coordinator Turn
→ Stable materialized EventStore input
→ Actually observed by the Provider
→ Acknowledge only this source
```

The existing working Root user queue could also be reused, but source identity, deduplication, restart recovery, and precise acknowledgement must be preserved.

Frontend pending state must come from persisted observation state, not an in-memory guess.

### 6.7 Required regression tests

- Send through the real Group Chat while the Coordinator is Working; materialize the message once and acknowledge it precisely.
- Sending while the Coordinator is Idle must behave the same way.
- If a message arrives during a running Turn, retain it for a follow-up; do not mix it into the already materialized batch.
- Pending/observed state must remain consistent after refresh, Session switch, and App restart.
- After five Watchdog runs, there must still be only one source, one materialized input, and at most one active attempt.
- The Coordinator must not incidentally read another Task's message, a Direct Member message, or a row that has not yet been materialized.
- E2E must operate the packaged App's real input field and button; database reads may only prove the result.

## 7. Issue 3: Tester finished testing, but Overview shows Needs attention again

### 7.1 What the user sees

During the second round of work, the Implementer completed support for arbitrary raise amounts and the Tester completed testing, but Overview again showed Needs attention, as though the Tester's result had been lost.

### 7.2 What actually happened

Second-round Tester Task: `8dd5...`.

The Tester reported an all-in risk at 02:39:26. The Coordinator then tried twice to message the Tester:

- 02:39:37，`purpose=material_change`；
- 02:39:46，`purpose=blocker`。

The backend rejected both:

`purpose is valid only for a TaskExecution member's plain message to the Coordinator`

After two consecutive tool errors, the Provider chose cancel-and-replace at 02:40:13. The Tester was still finishing its test and stopping the server. It called task complete at 02:40:22, but the Task had already been cancelled, so submission of the result was rejected.

The resulting facts were:

- The Tester's Turn can be terminal;
- The Tester actually finished the test;
- But the authoritative Task is cancelled;
- There is no Completed TaskOutput validly bound to that Task.

Handoff receipt `2288ca34...` records:

- Old Task: `8dd5...`;
- Replacement: Implementer Task `566648...`;
- External effect: unknown;
- The user later chose Continue replacement;
- The replacement ultimately completed.

### 7.3 Root cause 1: The tool schema exposed a parameter to the Coordinator that the backend would always reject

The `purpose` added by PR8F is intended only for a TaskExecution Member to report a structured actionable fact to the Coordinator. The backend is correct to reject its use by the Coordinator:

- Schema exposure: `src-tauri/crates/agent-core/src/core/tools/impls/orchestration/agent_org/send_message.rs:192`
- Persistence rejection: `src-tauri/crates/agent-core/src/core/tools/impls/orchestration/agent_org/send_message/persistence.rs:52`

The error is that the Coordinator can still see this parameter. It is like giving the model a button that appears in the interface but always returns an error when clicked.

### 7.4 Root cause 2: The Coordinator used cancel-and-replace instead of asking a normal follow-up question

After message sending failed, the Coordinator cancelled the Task that was finishing up in order to contact the worker. This created a cancel/complete race: cancellation committed first, the worker's completion result arrived later, and the system could only reject it.

### 7.5 In plain language

The Tester has reached the finish line with its test report in hand. The Coordinator only wanted to ask a question, but a mistake in the message tool caused it to void the Tester's work order. When the Tester submits the report, the counter says, “This work order has been cancelled; it cannot be accepted.” The user therefore sees “the work is clearly done, but the system says it is not.”

### 7.6 Required fix

1. Generate the `org_send_message` schema dynamically by caller role; the Coordinator must not see `purpose`.
2. Even if an old client or model forcibly sends `purpose`, the error must clearly say “retry without purpose” and must not prompt escalation to cancel-and-replace.
3. The Coordinator policy/prompt must state that a follow-up question or request for more information to an active worker cannot be implemented by cancelling the Task.
4. Define and test deterministic rules for concurrent cancel and task complete; a successfully produced result must not become unowned narration.
5. If cancellation has committed, a late result must become typed late-result evidence for handoff/user review instead of being silently discarded.

### 7.7 Required regression tests

- The Coordinator's tool schema snapshot omits `purpose`; the TaskExecution Member schema includes the allowed values.
- A normal Coordinator follow-up is delivered without creating a self-waking FormalTriggerReceipt.
- After an active Tester reports a risk, the Coordinator follows up, the Tester replies and completes the Task, and no cancellation occurs.
- Cover both commit orders for cancel and complete, with only one authoritative resolution in the end.
- The real Terra scenario must include a risk report and follow-up while the test server is still running.

## 8. Issue 4: All Tasks are finished, but Overview still shows Needs attention

### 8.1 Actual state

At investigation time, all 8 Tasks were terminal:

- 5 completed；
- 3 cancelled；
- 0 in_progress；
- 0 pending。

However:

- No completion certificate;
- No FinalSummaryReceipt;
- Run remains `running`;
- UI shows Needs attention.

The direct UI projections are in:

- `src-tauri/crates/agent-core/src/state/commands/session/org_tasks/run_view.rs:406`
- `src/engines/ChatPanel/InputArea/components/AgentOrgOverviewPanel.tsx:343`

The current logic collapses different causes of “all Tasks terminal but no certificate” into Needs attention, so the UI does not tell the user which closure failed.

### 8.2 First fact blocking completion: unread user message

Quiescence treats an unread user Group Chat row as blocking work:

- `src-tauri/crates/agent-core/src/core/coordination/agent_org_runs/quiescence.rs:618`
- Blocking predicate around line 631.

This is a consequence of issue 2: while the message remains unread, the Run can never prove quiescent convergence.

### 8.3 Second fact blocking delivered completion: a cancelled scope with no successful descendant

Keep stopped cancelled replacement Task `b06e...`. It has no completed descendant, and its cancellation reason is not an explicit `user_scope_removed`.

Relevant completion validator locations:

- `src-tauri/crates/agent-core/src/core/coordination/agent_org_run_completion.rs:1021`
- Cancellation rules after around line 1060;
- Delivered checks after around line 1110.

Therefore, the Delivered outcome does not hold, and the validator correctly rejects it.

But the user's second request was later completed successfully in the same activation:

- If the whole episode is marked Cancelled, the later success is also described as cancelled;
- If it is marked Delivered, the old cancelled leaf has no proof of delivery;
- If it is marked Failed, there is no authoritative Task status of Failed—only a failed Turn.

The system has no valid certificate, so the final summary cannot start either. The FinalSummaryReceipt FSM is not stuck; it never received the prerequisite for creation.

### 8.4 In plain language

The user first said, “Pause this replacement task for now,” and the system recorded it as cancelled. Later, the user assigned new work and that work succeeded. Yet both rounds of work were placed on the same settlement record. At checkout, the system cannot answer whether the record says “everything was delivered” or “the entire order was cancelled.” It keeps asking for attention without telling the user which receipt is missing.

### 8.5 Product/Design decision required first

Recommended design:

- After Keep stopped, close the current episode as Cancelled if no other open work remains;
- A new mission sent later by the user creates a new episode;
- If sibling Tasks are still working, Overview must show which cancelled scope blocks Delivered and provide a precise scope-resolution action;
- If the user is allowed to explicitly remove a scope, write an auditable `user_scope_removed` fact; do not only change the UI or fabricate completed status.

This is outside the original PR8F boundary of “keeping the PR8S handoff/certificate validator unchanged.” Update the Design/Issue before implementing it; do not silently change completion semantics.

### 8.6 Required regression tests

- Keep stopped with no other open work: the episode has a definite Cancelled certificate or explicit terminal resolution.
- Keep stopped while sibling Tasks continue: the UI shows the exact blocking scope instead of generic Needs attention.
- A new mission after the old episode closes uses a new episode identity; the old cancellation does not contaminate the new delivery.
- Every cause of all terminal + no certificate has a typed reason and corresponding action; do not guess and collapse them together.
- Create FinalSummaryReceipt only after creating the completion certificate; show Finalizing only while the receipt is active.

## 9. Additional issues found during continued operation

### 9.1 Pause/Resume breaks completion evidence

Using the real Pause and Resume controls in the packaged App produced:

- Pause episode `e87b...`.
- Generation 2 after Pause and generation 3 after Resume.
- Current Run `activation_generation = 3`.
- All eight Tasks remained at generation 1.

Two code paths interpret generation differently. Quiescence and Run View count Tasks across the whole Run (`quiescence.rs:556`, among others). The completion candidate queries only the current generation and returns NotApplicable when it finds zero Tasks (`agent_org_run_completion.rs:376`).

The Design around line 1256 explicitly defines activation generation as a work-authorization epoch: who may continue working after this Resume. It is not episode identity for the delivered work. In plain language, Pause/Resume issued a new access card, but settlement treated that as a new order. The old Tasks remained on Overview while the certificate logic saw none.

Existing Pause tests near `src-tauri/crates/agent-core/src/state/commands/session/org_tasks/tests.rs:1880` mainly finish Tasks by direct table updates. They do not verify Task generation, episode identity, and final certificate after Resume. Button-level tests could therefore pass while real settlement fails.

Fix completion graph/evidence so it does not use the authority epoch as an episode discriminator. Introduce or reuse a true episode/work-scope identity, or prove how one Task graph converges across authorization epochs. Do not rewrite all old Task generations; that would destroy historical authorization evidence.

### 9.2 Direct Member assistant reply leaks into Group Chat

A real Planner Direct page sent:

`PR8F-DIAG-0828-C Reply only ACK. Do not create or edit anything.`

The backend correctly recorded `turn_kind=user_directed_work`, source `direct_member`, and a real Terra ACK from Planner. The Task board and `work_revision` did not change, proving that the Direct channel itself worked. But after returning to Coordinator Group Chat, the UI showed Planner's `@Coordinator ACK`. The user's original Direct text was absent; only the assistant reply was wrongly inserted into Group Chat.

The frontend projection caused this: `src/engines/ChatPanel/hooks/useGroupChatMergedEvents.ts:195` merges every Member Session EventStore stream, while `src/engines/ChatPanel/utils/groupChatUtils.ts:484` treats any non-Coordinator `agent_message` as addressed to Coordinator by default (around lines 493–494). This violates the Design's visibility rule: Direct user messages and replies cannot leak into the Group transcript. Backend provenance is correct, but display loses it.

Fix the authoritative projection: Group feed admits only events with typed group/root-group provenance, not events guessed from sender identity or nearby timestamps. This sits near the PR8/PR9 transcript-projection boundary, but blocks real end-to-end PR8F acceptance.

### 9.3 UI offers `@Planner`, which backend explicitly rejects

Selecting Planner from the real Group Chat `@` menu and sending diagnostic B returned:

`agent_org_turn_context_invalid: PR3 does not admit legacy Member group/inbox producer "sde-planner" without typed authority`

No Inbox row was inserted, so backend rejection was atomic. The contract conflict is that `useAgentOrgGroupChatController.ts:242` offers all members while `group_chat.rs:375` rejects every non-Coordinator recipient. The Design assigns Group-mention UserDirectedWork to PR9, not PR8F.

Until PR9 typed routing lands, hide or disable `@Member` and explain in plain language that Coordinator receives group messages and users should open a Member Session for direct chat. Do not let users choose an option that yields an internal architecture error.

Existing E2E also conflicts: `tests/e2e/specs/core/agent-org-group-chat-ui.spec.mjs:734` has a Planner mention scenario; lines 807–857 expect Planner persistence/read/reply; the Coordinator case around 862–902 asserts only that a row was written, not that it was read and answered. Thus no current evidence establishes the complete Group Chat chain on this build.

### 9.4 Opening the normal user DB reports an incomplete canonical schema

A direct Computer Use reopen of the App did not inherit the terminal's isolated `ORGII_HOME`. It inadvertently opened the user's normal DB and showed:

`partial Agent Org runtime schema: found 14 of 27 canonical tables; only an empty namespace or the complete current manifest is accepted`

That process was stopped and the App was restarted with the same isolated `ORGII_HOME`. The isolated DB recovered and retained issue state. This is **not classified as a new PR8F bug**: the locked product decision excludes migration of external user data, and canonical DDL is verified only in a fresh isolated DB. It is an important test-environment warning: a manual packaged-App restart must retain the same isolation rather than double-clicking into different data.

## 10. What actually worked

Positive controls rule out a blanket Provider failure:

- Packaged App started and restarted from the isolated DB.
- `orlando / gpt-5.6-terra` completed a real Direct Member Turn.
- Planner's Direct ACK returned in about six seconds.
- Direct messaging did not change the Task graph or `work_revision`.
- All 18 FormalTriggerReceipts resolved, with none left pending twice.
- Invalid `@Planner` Group writes were rejected before persistence, with no dirty Inbox row.
- FinalSummary did not start without a certificate.

The failures are concentrated in message routing, role/tool contracts, cancel/completion races, episode closure, and frontend provenance projection.

## 11. Why the prior “all-scenarios real-device test” claim was unsupported

The earlier real Terra test covered a shorter happy path: immutable Plan, normal Task completion, Final Summary, and restart readback. Failure paths relied mainly on fake providers or isolated fixtures. It did not cover these real combinations:

- Default Group Chat while Coordinator is Working.
- Tester reporting material change/risk while holding a real background server.
- Coordinator incorrectly using `purpose` when messaging a worker.
- Cancel concurrent with Task completion.
- A second mission after Keep stopped.
- Cancelled scope and later successful work in one episode.
- Completion certificate after Pause/Resume.
- Direct assistant reply leaking into Group Chat.
- Real `@Member` selection from Idle.
- UI picking-up state reconstructed across refresh/restart.

Calling the prior result “all-scenarios real Provider test passed” is inaccurate. Keep the PR in Draft. Do not claim `Performance verdict: pass` or closure of Issue #997 until fixes and real retesting finish.

## 12. Performance and lifecycle conclusion

The conclusion is based on actual DB and Turn records rather than code shape alone:

| Check | Observed result | User impact |
| --- | --- | --- |
| Each Group Chat send | Writes one durable unread row and starts an empty Coordinator Turn | Messages accumulate; Provider/Turn scheduling does useless work. |
| Unread acknowledgement | Never happens | Data grows; Quiescence stays blocked. |
| UI pending | Exists only in page memory | State disagrees with DB after switch/restart. |
| Group transcript | Merges Member streams and guesses provenance | Direct replies leak; projection cost rises with data. |
| Watchdog/Formal receipt | 18/18 resolved in this run | Not the cause of current repeated wakeups. |

**Performance verdict: fail.** This is not about lacking a polished CPU figure: each message demonstrably creates a durable backlog and an empty Turn. The performance guard rejects known unbounded accumulation and useless background work. A later five-minute CPU/RSS profile, SQL counters, rows visited, and `Command+5` request counts will quantify impact but cannot reverse the current correctness/lifecycle failure.

## 13. Recommended fix order and ownership

| Order | Fix | Suggested owner | Reason |
| --- | --- | --- | --- |
| 1 | Precisely materialize/ack Group user messages without restoring blanket drain | PR8F | Direct gap in Issue #997 result chain; blocks Quiescence. |
| 2 | Dynamic Coordinator message schema without invalid `purpose` | PR8F | Currently induces cancel-and-replace and lost results. |
| 3 | Cancel/complete race and cleanup-only authority | PR8S stacked fix plus PR8F integration tests | Old worker must clean up; Coordinator must not get execution tools. |
| 4 | Keep stopped/new-mission episode closure | Update Design/Issue first | No unique correct product meaning yet; validator changes cannot guess it. |
| 5 | Separate Pause/Resume generation from completion evidence | PR8S/PR8F integrated fix | Resume can otherwise prevent certification forever. |
| 6 | Typed provenance in Group feed, isolated from Direct | PR8/PR9 projection | Backend has source information; frontend must stop guessing. |
| 7 | Hide/disable `@Member` before PR9 | Current UI contract fix | Do not expose an entry point backend certainly rejects. |
| 8 | Typed Needs attention reason and plain-language buttons | Alongside owning fix | Explain missing receipt and each button's scope. |

Do not “quick-fix” this by restoring blanket Coordinator unread drain, hiding cancelled Tasks, changing cancelled to completed, granting Coordinator shell/process-kill rights, rewriting historical activation generations, deleting unread rows or user DB, or substituting debug endpoints for real Group Chat, Pause, Resume, handoff, and Retry controls.

## 14. Decisions to lock before implementation

### Decision A: Keep stopped episode semantics

The Design must say whether Keep stopped with no other open work immediately closes the current episode as Cancelled or keeps an explicitly removable scope. The former is recommended; a new mission creates a new episode.

### Decision B: Multiple missions in one Root Session

Activation generation expresses authorization epoch only, not episode ID. Select a real episode/work-scope identity and state whether Pause/Resume spans an episode (normally it should not).

### Decision C: `@Member` before PR9

Until typed group UserDirectedWork routing is available, the UI should show only Coordinator rather than unusable Member mentions and direct users to the Member's Direct Session.

## 15. Real acceptance script after the fix

Rebuild the current branch's packaged App; record branch, HEAD, bundle, and binary SHA-256. Use a fresh isolated `ORGII_HOME` and temporary Git workspace, with Provider fixed to `orlando / gpt-5.6-terra`.

### Main scenario

1. Create a Team to plan, implement, run, and verify a local Texas Hold'em game, with separate durable implementation and test report TaskOutput/Artifacts.
2. Use the real Plan card for Request Changes and Approve. After approval, Planning Task must be Completed, not Cancelled.
3. Implementer starts a real local server; Tester reports material change/risk while it remains running.
4. Coordinator sends a valid ordinary follow-up to Tester without canceling the Task. Tester replies, stops the server, and saves Completed TaskOutput.
5. While Team is Working, send a Group Chat request to support arbitrary bet amounts. Coordinator must read it exactly once and create or adjust work.
6. Switch among Coordinator, Planner, Implementer, and Tester Sessions. Direct Planner conversation must not appear in Group transcript.
7. Before PR9, Group Chat must not offer unavailable `@Planner`; if PR9 has landed, verify typed authority, read, and reply end to end.
8. Trigger cleanup through real Stop/handoff. Worker first stops its own background process; show a user decision only if stopping cannot be proved.
9. Cover Continue replacement, Keep stopped, and Abandon episode in separate focused runs, checking actual scope and plain-language button descriptions.
10. Continue the same Task graph after real Pause and Resume; a correct completion certificate must still be generated.
11. After all Tasks become terminal, show Finalizing only while FinalSummaryReceipt is active; enter Idle after the final report is persisted.
12. Exit and restart the App with the same isolated environment. Plan, TaskOutput, certificate, final summary, message observation, and episode outcome must remain visible.

### Required backend evidence

- One materialized EventStore input and precise ack per Group user source.
- No permanently unread user row or empty Coordinator resume Turn.
- One authoritative resolution for a cancel/complete race.
- Process tree genuinely terminal after cleanup.
- Completion validator still sees the Task graph across Pause/Resume.
- Exactly one valid completion outcome per episode.
- FinalSummaryReceipt created only after certificate.
- Failed summary does not auto-retry; real Retry button creates the next attempt.
- Direct source absent from Group projection.
- Five Watchdog ticks do not increase receipt/materialized-input/Turn counts.

### Test organization

- Put Rust tests in separate module test files or `tests/`, not large `#[cfg(test)]` blocks in production files.
- Use separate `.test.ts`/`.test.tsx` files for TypeScript/React tests.
- Split Group routing, handoff cleanup, completion episode, Pause/Resume, transcript projection, and final summary into small owning-boundary suites.
- Extend the matching E2E spec where possible. If a formal-convergence spec is needed, split scenarios so one long script does not own every state machine.

## 16. Diagnostic changes left by the investigation

The isolated DB contains recognizable diagnostic facts; a successor should not mistake them for original user actions:

1. Group Chat diagnostic A: text `【PR8F诊断-0828-A】请只回复“收到”，不要创建任务。` (“PR8F diagnostic 0828 A: reply only ‘received’; do not create a task”); Inbox row 41 remains unread and triggered empty Turn `fcfca73e...`.
2. `@Planner` diagnostic B was rejected before backend persistence and has no Inbox row.
3. Planner Direct diagnostic C sent `PR8F-DIAG-0828-C Reply only ACK. Do not create or edit anything.`, got a real Terra ACK, and leaked the assistant reply to Group Chat.
4. One real Pause/Resume increased activation generation from 1 to 3, demonstrating completion-generation mismatch.

These changes exist only in `<isolated-orgii-home>`. Normal user ORGII_HOME was not modified; no Team/Session was deleted and no code was changed.

## 17. Handoff completion criteria

Compilation, unit tests, or a happy path alone cannot finish the repair. Reconsider PR8F as Ready only when all hold:

- [ ] Group Chat messages have precise source → observation → ack.
- [ ] Coordinator no longer receives a `purpose` schema backend must reject.
- [ ] Active workers can perform restricted cleanup after cancellation.
- [ ] Cancel/complete races do not lose TaskOutput.
- [ ] Keep stopped and new missions have explicit, auditable episode boundaries.
- [ ] Pause/Resume does not hide old Task graph from completion candidate.
- [ ] Direct replies do not enter Group Chat.
- [ ] Unavailable `@Member` is hidden before PR9.
- [ ] Needs attention gives specific reason, affected scope, and button consequences.
- [ ] Real Terra and packaged App pass the main scenario above.
- [ ] Restart, five Watchdog ticks, failures, and Retry preserve unique receipt/input/attempt.
- [ ] Five-minute performance profile, SQL/query plan, and request counts are complete with no unread backlog or empty Wake.
- [ ] New Rust/TypeScript/E2E tests are separated by function and from production code.

Until then, keep the public conclusion:

```text
PR8F status: Draft / not ready
Real-provider verdict: fail
Performance verdict: fail
User data migration: intentionally not covered
Destructive cleanup: not performed
```
