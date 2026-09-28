# Agent Org PR8S User-Observed Issues Handoff

> Status: Investigation complete; fixes not yet implemented
>
> Date: 2026-08-28
>
> User reproduction Session: `pr8f test 0828`
>
> Investigation environment: Current packaged Tauri App, real `orlando / gpt-5.6-terra`
>
> Scope: Records only issues personally observed by the user and attributed to PR8S. It excludes later investigation findings and the PR8F Group message delivery break.
>
> **Delivery decision: Do not create any more PR8S fix PRs. This document retains the root causes and test evidence for the original PR8S area; all production fixes described here will be included in `PR8 Stabilization`.**

## 1. Plain-language summary

PR8S currently has three areas that need rework:

1. When a Tester leaves a background process running, the system cannot reliably stop it automatically;
2. When the Coordinator replies to a Tester, the system incorrectly exposes the `purpose` parameter, which is only for a “Member reporting a risk to the Coordinator.” After the message is rejected, the Coordinator incorrectly cancels the Tester;
3. After `Keep stopped`, the system does not know how to formally close the current round of work.

These problems do not mean the overall PR8S direction is wrong. Coordinator permission isolation, handoff receipts, and completion certificates can remain. The handoff, message-tool contract, and completion-closure boundaries need rework.

First, one point needs to be clear: **the Coordinator can still send messages to Members normally.** The issue is not a ban on Coordinator–Member conversation; the two directions use different rules:

| Direction | How to send | Role of `purpose` |
| -------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| Member → Coordinator | Bind to the current `related_task_id` and provide `purpose` | Proves this is not ordinary progress, but a blocker, decision, risk, or other matter that actually requires Coordinator action |
| Coordinator → Member | Bind to the current `related_task_id` and send an ordinary Task-scoped message | **Do not use `purpose`**; the Coordinator already has coordination authority and does not need it to prove “why it may wake the Coordinator” |

`purpose` classifies messages so Members do not interrupt the Coordinator arbitrarily. It is not a universal “message subject” that every Agent conversation must include.

## 2. Issue list

| What the user sees | Earliest root cause | In plain language | Classification |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | -------------------------------- |
| Tester shows Needs attention and asks the user to handle a stop failure | The old Tester's background process was not fully reclaimed by its Task/Turn owner | The system cancelled the work order but did not fully stop the program it launched | PR8S handoff implementation is incomplete |
| `Keep stopped`, `Continue replacement`, and `Abandon episode` are hard to understand | The UI does not explain each button's scope before the user decides | The user cannot tell whether they are stopping one replacement task or abandoning the whole round of work | PR8S UI contract is unclear |
| Tester finished testing, but Overview shows Needs attention again | The tool schema incorrectly exposed `purpose`, which belongs only to the Member→Coordinator direction, when the Coordinator replied to the Tester | The Coordinator could have replied normally, but the system prompted it to fill in a field intended for the opposite direction | PR8S tool contract is self-contradictory |
| All Tasks are terminal, but there is still no completion certificate | The cancelled scope left by `Keep stopped` has no valid resolution closure | Everyone has stopped, but the system has no settlement record proving how “this round ended” | PR8S completion design and implementation are unfinished |

## 3. Issue 1: Tester cannot be stopped safely and automatically

### What the user sees

- Tester appears to have failed or become stuck;
- Overview shows Needs attention;
- The user must choose `Continue replacement`, `Keep stopped`, or `Abandon episode`;
- After the user chooses `Keep stopped`, all Members become Idle; when the user later sends a message, the Team can work again.

### What actually happened

The Tester still had a background test server running. After the Coordinator initiated cancel-and-replace, the original Task immediately became cancelled. The Tester lost permission to make further tool calls, but the system had not reliably proved that the background child process had stopped.

The system could therefore only mark the external effect as unknown and ask the user whether the replacement should continue. The safety principle—“ask the user when the system truly cannot prove that everything has stopped”—is correct. The error is that the system revoked the Task's permissions too early without first reliably reclaiming the complete process tree launched by that Task.

Normally, the user should not have to decide. If the backend can prove that the old Task, Turn, and complete process tree are terminal, it should release the replacement and continue automatically. Show a user handoff only if stopping times out, crashes, or the external effect truly cannot be verified.

Relevant production entry points:

- `src-tauri/crates/agent-core/src/core/tools/impls/orchestration/agent_org/task_update.rs`
- `src-tauri/crates/agent-core/src/state/commands/session/org_tasks/handoff.rs`
- `src-tauri/crates/agent-core/src/core/tools/impls/coding/exec/registry.rs`
- `src/engines/ChatPanel/InputArea/components/AgentOrgOverviewPanel.tsx`

### In plain language

The Tester started a test server. The Coordinator cancelled the Tester's work order, but the server kept running in the background. Since the work order was cancelled, the Tester no longer had permission to clean it up. The system did not know whether the background program could still have an effect, so it handed the risk to the user.

### What `Keep stopped` currently does

`Keep stopped` means only that:

- The blocked replacement will not start;
- The old Task will not resume;
- The entire Team will not be shut down;
- Other Tasks and later messages may still continue.

Therefore, “I pressed Keep stopped, then sent a message later and the Team continued” is not itself a runtime error. The error is that the button label and explanation led the user to think it meant “cancel the whole task or stop the whole Team.”

### Correct fix boundary

1. Every shell, PTY, background job, and child process started by a TaskExecution must remain bound to its exact Task/Turn owner;
2. After cancel-and-replace, the backend must automatically stop that owner's complete process tree and wait for bounded terminal evidence;
3. Create a user handoff only if stopping times out, crashes, or the outcome truly cannot be verified;
4. Do not give the Coordinator shell access or arbitrary kill authority;
5. Start the replacement only after the old execution is confirmed released;
6. Explain the scope and outcome of each of the three user choices directly on the main card.

### Required tests

- With a real background child process owned by the Tester, cancel-and-replace must terminate the process tree automatically;
- Cover detached children, PTYs, and cases where the shell has returned but a child process is still running;
- A successful stop must not show Needs attention;
- An unknown stop outcome must create only one handoff, with no duplicate after restart;
- Verify how each of the three buttons affects the current Task, replacement, sibling Tasks, and the whole episode;
- Operate all visible buttons and confirmation dialogs through the packaged App's real UI.

## 4. Issue 2: The Coordinator was incorrectly prompted to use `purpose` when replying to the Tester

### What the user sees

The Implementer completed the change, and the Tester also completed testing, but Overview showed Needs attention again, making it look as though the test result had been lost.

### What `purpose` is for

`purpose` serves only this direction:

```text
TaskExecution Member → Coordinator
```

Members should record ordinary work—what they started, which modules they completed, and what they plan to do next—in Task status or TaskOutput. They should not send a message to wake the Coordinator for every update. A Member should send a message with `purpose` only when Coordinator action is actually required:

- `blocker`: I am blocked;
- `decision_required`: the Coordinator needs to make a decision;
- `material_change`: the task has changed substantially;
- `risk`: an important risk was found;
- `requested_reply`: the Coordinator explicitly asked me to reply.

When the Coordinator gives a Member additional instructions, asks about a risk, or requests more testing, the direction is the reverse:

```text
Coordinator → TaskExecution Member
```

Normal conversation is allowed in this direction. The message only needs the correct `related_task_id`; **`purpose` should not appear or be supplied**.

### What happened in this test

After the Tester reported a risk, the Coordinator tried to message the Tester. The tool schema showed the Coordinator `purpose=material_change|blocker|...`, even though the backend allows `purpose` only when a TaskExecution Member messages the Coordinator.

After receiving consecutive tool errors, the Coordinator used cancel-and-replace instead. The cancellation transaction committed first. When the Tester later submitted its completion result, the authoritative Task was already cancelled, so TaskOutput was rejected.

The complete error chain was:

```text
Tester reports a risk using purpose=risk
        ↓
Coordinator prepares to reply to the Tester
        ↓
The system incorrectly still exposes purpose to the Coordinator
        ↓
Coordinator mistakenly supplies purpose=material_change / blocker
        ↓
Backend correctly rejects use in this direction
        ↓
Instead of retrying without purpose, Coordinator incorrectly cancels the Tester Task
```

Therefore, this test did not show that the Coordinator needs `purpose`. It showed that **the tool schema was not filtered by sender role and direction, exposing the Coordinator to a parameter that does not belong to it.**

Relevant production entry points:

- Schema: `src-tauri/crates/agent-core/src/core/tools/impls/orchestration/agent_org/send_message.rs`
- Execute-time validation: `src-tauri/crates/agent-core/src/core/tools/impls/orchestration/agent_org/send_message/persistence.rs`
- Cancel-and-replace: `src-tauri/crates/agent-core/src/core/tools/impls/orchestration/agent_org/task_update.rs`

### In plain language

The Tester used a form asking “Why must I interrupt the Coordinator?” to report a risk. The Coordinator could have replied directly, but the system handed it the same form to fill out. After the Coordinator filled it in, the system said, “Only the Tester may use this form.” The Coordinator then incorrectly cancelled the Tester's work order instead of sending a normal reply. When the Tester submitted its completed test report, the system said the work order had been voided and could not accept it.

### Correct fix boundary

1. Generate the actual tool schema according to caller role and message direction;
2. Show and require `purpose` only for actionable facts sent Member→Coordinator;
3. Preserve normal Task-scoped messages for Coordinator→Member, requiring only the correct `related_task_id`; omit `purpose` from that schema;
4. Keep fail-closed execute-time validation to prevent old calls from bypassing the rules;
5. If an old call mistakenly includes `purpose`, the error must clearly say “retry without purpose” and must not encourage escalation to cancel-and-replace;
6. Do not use Task cancellation to let the Coordinator ask an active worker a normal follow-up question;
7. Test a deterministic commit order for cancel and complete; do not silently turn a late result into ordinary narration;
8. The serialized tool schema seen by the Provider must match the Rust execution rules exactly.

### Required tests

- Real schema snapshots for Coordinator, TaskExecution Member, and ordinary SDE;
- The Coordinator→Member schema omits `purpose`, while still allowing a message with the correct `related_task_id`;
- Valid Member→Coordinator cases include the five allowed `purpose` values; ordinary progress must not use them to wake the Coordinator;
- The Coordinator follows up with an active Tester, the Tester receives and replies, and the Task is never cancelled;
- An old call that includes `purpose` returns a direction-specific retry hint and causes zero Task mutations;
- Cover both races: cancel commits first and complete commits first;
- A real Terra scenario includes a risk report and follow-up while the Tester is stopping the server.

## 5. Issue 3: The work round cannot be formally closed after `Keep stopped`

### What the user sees

- All Tasks eventually become completed, failed, or cancelled;
- All Members are Idle;
- Overview still shows Needs attention;
- There is no final report.

### The part of this issue that belongs to PR8S

The unread Group message in PR8F is also a blocker, but it is documented separately in the PR8F handoff. This section records another blocker: after `Keep stopped` cancels the replacement, the old cancelled scope has no completed descendant and no explicit proof of `user_scope_removed`. Therefore, the completion validator cannot issue a delivered certificate.

### In plain language

Everyone appearing to have stopped work does not tell the system whether “this round was completed successfully, partially cancelled, or abandoned entirely.” A settlement record explaining how the cancelled Task was legitimately closed is missing, so the system does not dare declare completion.

### Confirmed product decision to add to the Design

The user has confirmed option A:

> When the user chooses `Keep stopped` and no other open work remains, immediately end the current work round as Cancelled. A new mission sent afterward automatically starts a new work round. (Original: “用户选择 `Keep stopped`，并且已经没有其他 open work 时，立即把当前工作轮次结束为 Cancelled；之后用户发送的新 mission 自动开始新的工作轮次。”)

`Keep stopped` closes the currently stopped scope. If other work remains in the round, that work continues; if no work remains, the round closes as Cancelled. A later mission creates a new work episode and must not remain mixed into the old cancelled closure. This meaning must be added to the authoritative Design before implementation.

### Correct fix boundary

1. Define a stable work episode identity spanning Tasks, replacements, handoffs, and completion certificates;
2. Keep `activation_generation` as the work-authorization version; it must not also serve as the episode identity;
3. `Keep stopped` must produce an explicit, verifiable scope resolution;
4. Bind each new mission to an explicit current or new episode; do not infer it from the Root Session and time;
5. Have Run View return a typed blocker instead of collapsing every cause into generic Needs attention;
6. Issue a completion certificate only when full resolution closure holds; the UI must not infer success.

### Required tests

- Sibling Tasks still exist after Keep stopped;
- No open Tasks remain after Keep stopped;
- The user sends a second mission after Keep stopped;
- The three closure cases: replacement completed, replacement cancelled, and episode abandoned;
- When all Tasks are terminal but closure is incomplete, show the specific reason and a real action to resolve it;
- When closure is complete, issue only one certificate and allow the final summary to close afterward;
- Episode, Tasks, and certificate remain consistent after refresh, Session switch, and App restart.

## 6. Stabilization workstreams and estimates

These are three workstreams within the same `PR8 Stabilization`, used to organize implementation and review. They are not three separate PRs and cannot be merged or declared complete independently:

| Fix | P50 / P90 review lines | Substantive files P50 / P90 |
| ---------------------------------------------------- | ---------------------: | -----------------: |
| H1: Exact process-tree stopping, handoff, and button explanations | 3,200 / 6,500 | 18–28 / 35–50 |
| H2: Generate message-tool schema by role and direction | 800 / 1,800 | 6–10 / 12–18 |
| H3: Keep stopped / work episode / completion closure | 5,000 / 9,000 | 28–40 / 50–65 |

These estimates include independent Rust tests, independent TypeScript/React tests, rendered E2E, a real Provider, and packaged App acceptance. The 13 locale files are estimated separately. Files overlap across workstreams, so their counts cannot simply be added. The deduplicated total budget and scope gate for the unified PR are defined in `agent-org-pr8-stabilization-handoff.md`.

If H3 finds that episode semantics for other lifecycle paths must also be rewritten, update the Design and budget first; do not expand scope while implementing.

## 7. Explicitly out of scope for this document

- Group Chat user messages not being read: belongs to PR8F;
- General implementation review of PlanRevision, FormalTriggerReceipt, Watchdog, or FinalSummaryReceipt;
- PR9 `@Member` GroupMention;
- PR10 Group transcript projection;
- Migration of the user's normal database.

## 8. Completion criteria

Fixes in the original PR8S area of `PR8 Stabilization` are complete only when all of the following hold:

- A Tester that can be stopped safely and automatically no longer requires user intervention;
- A normal automatic handoff never asks the user to decide;
- A genuinely unknown external effect creates only one typed handoff;
- Coordinator→Member messages remain available as normal Task-scoped messages, without exposing the Member→Coordinator-only `purpose`;
- Member→Coordinator messages include `purpose` only when coordination is truly needed;
- A normal Coordinator follow-up reaches the active Tester without cancelling it;
- The scope of `Keep stopped` is clear to the user;
- Every work round can reach a clear Delivered, Cancelled, Failed, or typed-blocker outcome;
- Real Terra plus the packaged App covers background processes, handoff, a second mission, and the final certificate;
- Rust tests live in separate test files or the `tests/` directory; TypeScript/React tests use separate `.test.ts`/`.test.tsx` files; unrelated functions are not concentrated in a large omnibus test file.
