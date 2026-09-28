# Agent Org PR8 Stabilization — Unified Fix Handoff

> Status: Pre-implementation handoff; fixes have not started
>
> Date: 2026-08-28
>
> Real reproduction Session: `pr8f test 0828`
>
> Real test environment: packaged Tauri App, `orlando / gpt-5.6-terra`
>
> Target branch relationship: Stack one unified stabilization PR on the final PR8F review head; record the exact base SHA before implementation
>
> Rollout: Keep both PR8F and this stabilization PR in Draft, with the product gate closed. Do not claim PR8F is complete until full acceptance passes.

## 1. Decisions Already Made

This handoff records the final delivery decision made by the user and Codex after investigating issues found in real testing.

### Confirmed

1. Do not rewrite all of PR8S or PR8F. Preserve the established foundation for Coordinator permission isolation, Plan revision, formal receipts, Watchdog repair, completion certificates, and final summaries.
2. Do not split the user-observed problems into several small, interdependent fix PRs.
3. Stack one unified **PR8 Stabilization** on PR8F: fix everything together, perform one real acceptance pass, and do not merge only half of it.
4. Do not create PR8S-H1, PR8S-H2, PR8S-H3, or any other PR8S fix PR. “Original PR8S area” and “original PR8F area” refer only to code/root-cause ownership, not to new delivery splits.
5. The PR has one user-facing outcome: fix the end-to-end lifecycle exposed by `pr8f test 0828`, so messages, coordination, stopping, and final closure form one complete chain.
6. Fix only the four problems the user personally observed. Do not implement PR9 or PR10 along the way, and do not add product features.
7. Keep production code and tests in separate files: Rust tests belong in separate test files or a `tests/` directory; TypeScript/React tests use separate `.test.ts`/`.test.tsx` files; do not consolidate different features into a large general-purpose test file.
8. All visible actions must still be performed with Computer Use in the real packaged App. A debug endpoint may only create isolated fault preconditions or read evidence.
9. Normally, do not ask the user to handle a handoff. Once the system can prove the old Task/Turn/process tree is terminal, automatically release the replacement. Show one user decision only when terminal state genuinely cannot be proven and external effects may remain.
10. The user confirmed option A for `Keep stopped`: if there is no other open work in the current round, formally close the current work episode as Cancelled. A later mission starts a new work episode.

### Product Semantics Confirmed and Required in the Design Before Implementation

The user confirmed these product semantics. Before writing production code, state them explicitly in the authoritative Design; they must not live only in this handoff:

> After the user chooses `Keep stopped`, do not start the current replacement and do not resume the old Task. If there is no other open work in this round, formally close the current work episode as Cancelled. A new mission sent afterward creates a new work episode and is not mixed into the old cancelled closure.

The boundary between normal automatic handoff and exceptional manual decisions is also fixed:

```text
Old Task/Turn/full process tree can be proven terminal
→ system releases handoff automatically
→ replacement continues automatically
→ do not show a user decision

Old execution timed out, crashed, or has genuinely unverifiable external effects
→ create only one typed unknown handoff
→ then let the user choose whether to take over, stop the current task, or cancel the entire work round
```

## 2. Why This Is One Unified PR

PR8S and PR8F were originally split by code ownership:

- PR8S owns Coordinator safety, Task handoff, and completion certificates.
- PR8F owns Plan, formal triggers, Watchdog, and final summaries.

That split makes sense for code review, but a real user workflow does not follow PR boundaries. One user action can cross the message entry point, Coordinator, Member, process, Task, and final report:

```text
User sends a new request while work is in progress
        ↓
Coordinator does not actually receive the message
        ↓
Coordinator uses the wrong parameters when messaging the Tester
        ↓
After the message fails, Coordinator incorrectly cancels the Tester
        ↓
The Tester's background process and result cannot be closed safely
        ↓
Keep stopped leaves a cancelled scope without formal settlement
        ↓
All Members are Idle, but the Team remains Needs attention
```

Delivering by PR8S/PR8F file ownership would make it easy to repeat the failure: “each segment passes alone, but the chain breaks when connected.” Therefore, treat this as one end-to-end stabilization problem:

> **When a user adds a request during Agent Org work, a Member reports risk, or the Coordinator coordinates or stops execution, the system must end the current work round safely, recoverably, and with an understandable result.**

“Delivering together in one PR” does not mean putting all logic in one module. Each authoritative fact still has one writer; all of them must simply be correct together in one PR and one real acceptance journey.

## 3. Four User Problems This Unified PR Must Fix

| User observation | Earliest root cause | Required stabilization result |
| --- | --- | --- |
| Tester shows Needs attention and requires manual handling after stop fails | Cancelling a Task does not fully stop its background child processes through the exact Task/Turn owner | Automatically stop executions whose terminal state can be proven; ask the user once only when the state is genuinely unknown |
| A Group message sent while the Team is working has no effect | Group message is written to the old Inbox, while the PR8F Coordinator reads only the new exact input; writer and reader are disconnected | Persist messages in a FIFO queue and acknowledge only after the Provider actually observes them; do not hard-interrupt the current Member |
| Tester finishes testing but then shows Needs attention again | When replying to Tester, Coordinator sends `purpose`, which is valid only for Member → Coordinator; the error escalates into cancel-and-replace | Use schemas that are correct for both send directions; ordinary follow-up messages arrive without cancelling the active Tester |
| Every Task is terminal, but Overview still shows Needs attention | An unread Group message and the cancelled scope from `Keep stopped` both block the completion certificate | Give each blocker a clear identity; observing a message clears its blocker; issue the unique certificate once the episode is fully closed |

## 4. Four User Contracts That Must All Hold

### 4.1 Group Messages: Queue by Default; Do Not Hard-Interrupt

A Group user message without a specific Member mention belongs to the Coordinator Root.

```text
send
→ persistent source / FIFO sequence
→ if Coordinator is busy, wait for the next Turn
→ materialize exact input
→ Provider actually observes it
→ exact acknowledgement
```

Do not:

- Write only to the ordinary Inbox and then create an empty Wake.
- Restore the Coordinator's blanket unread drain.
- Guess that a message was handled using a frontend-local boolean.
- Cancel a running Member Task to process an ordinary Group message.
- Expand this fix into PR9's full `@Member` GroupMention feature.

### 4.2 Coordinator and Member: Conversation Is Allowed, but Direction Rules Differ

`purpose` is not a generic “topic” for all messages. It classifies Member-to-Coordinator inputs and prevents ordinary progress updates from repeatedly waking the Coordinator.

| Direction | Valid input | Notes |
| --- | --- | --- |
| Member → Coordinator | Exact `related_task_id` + `purpose` | Only `blocker`, `decision_required`, `material_change`, `risk`, or `requested_reply` may be sent |
| Coordinator → Member | Exact `related_task_id`, without `purpose` | Coordinator may ask ordinary follow-up questions, add requirements, and respond to risks |

Generate the schema seen by the Provider based on caller role and send direction; the execution side must still fail closed. If an old call mistakenly includes a parameter for the opposite direction, return a clear, retryable direction error, make zero Task mutations, and do not prompt cancel-and-replace.

### 4.3 Stopping a Task: Stop the Full Execution Without Giving Coordinator Work Tools

Coordinator schedules work; it does not get shell, process-kill, test, or file-edit permissions.

Shells, PTYs, background jobs, and child processes started by TaskExecution must always be bound to the exact Task/Turn owner. The order for cancel-and-replace is:

```text
commit cancellation fence / handoff receipt
→ stop the complete process tree of the exact old owner
→ wait for bounded terminal evidence
→ allow replacement only after release
→ show user handoff only if state is unknown
```

On a normal path where terminal state can be proven, fully automate the flow. Do not show the user Continue replacement, Keep stopped, or Abandon episode. Do not fake convergence by hiding unknown state, assuming success, or giving Coordinator arbitrary kill permission.

### 4.4 Work Rounds: Know How Each Round Ends

A Root Session may carry multiple missions, but every mission round needs a stable work-episode identity.

- `activation_generation` represents only the current work-authorization version; it cannot also serve as the work episode.
- Tasks, replacements, handoffs, scope removal, and completion certificates must trace to the same episode.
- `Keep stopped` must produce explicit, verifiable scope resolution.
- A new mission must not remain mixed into the previous round's cancelled closure.
- Run View returns typed blockers instead of collapsing different causes into generic Needs attention.
- `FinalSummaryReceipt` may consume only an issued completion certificate; it cannot substitute for missing closure.

## 5. Authoritative State and Single Writers

The unified PR must not create a parallel set of facts.

| Fact | Sole authority | Invalid substitute |
| --- | --- | --- |
| Whether a Group user message is queued/observed | Persistent source, FIFO/Turn binding, EventStore observation | React-local pending state, empty Wake, timestamp guess |
| Whether Member → Coordinator input warrants a wake | Task binding + typed `purpose` + exact receipt | Body keywords, ordinary narration |
| Whether Coordinator → Member message is valid | Coordinator Turn authority + related Task binding | Reuse of Member-only `purpose` |
| Whether old execution has been released | Terminal evidence from Task/Turn/process owner | Task status set to cancelled, fixed wait duration |
| Whether replacement may start | Committed handoff release gate | UI click, free-form Coordinator text |
| Whether cancelled scope is closed | Work-episode resolution link | Change cancelled to completed, hide Task |
| Whether a Run can complete | Certificate issued by completion validator | Count of all-terminal Tasks, Member Idle, frontend inference |
| Whether final report is complete | Active `FinalSummaryReceipt` + EventStore event | Typing atom, timer, free-form text |

## 6. Implementation Order Within One PR

These are review commits/workstreams, not work that can be declared complete as separate PRs:

1. **Design and episode contract**
   - Add `Keep stopped`, new-mission, work-episode, and certificate rules to the Design.
   - Update state/unique-key/index impacts and failure semantics.
2. **Generate message-tool schemas by direction**
   - Separate Member → Coordinator and Coordinator → Member.
   - Fix misleading errors and cancel escalation.
   - Add a real serialized schema snapshot.
3. **Group → Coordinator Root FIFO**
   - Connect the old Group producer to the exact Root UserDirectedWork queue.
   - Add stable source, Turn, observation, and recovery.
   - Remove the authoritative semantics of empty Wake and guessed local pending state.
4. **Exact Task/Turn/process stopping**
   - Process-tree ownership, release gate, unknown handoff.
   - Clarify the scope of the three handoff buttons.
5. **Work episode and completion closure**
   - Unify Task/replacement/resolution/certificate around an episode.
   - Add typed Needs attention blockers.
   - Recheck certificate and final-summary wiring.
6. **Wire, UI, locale, and complete acceptance**
   - Keep Rust DTO, Tauri command, TypeScript types, and real wire consistent.
   - Cover all 13 locales.
   - Gather separate E2E, fault, restart, and performance evidence.
   - Complete the full journey in one real Terra Session.

No workstream may manufacture a pass by hiding an error state in the UI or directly editing a test database.

## 7. Explicitly Out of Scope

This PR does not include:

- PR9's full `@Member` GroupMention, Linked Inbox, or multi-member fan-out.
- PR10's final Group transcript projection and default rollout.
- A rewrite of ordinary SDE Plan mode.
- A second Coordinator dispatcher or second Provider lane.
- New Task states.
- Shell, file, test, browser, or external-mutation tools for Coordinator.
- External user-database migration.
- Unrelated cleanup, formatting, or opportunistic refactoring.
- Deleting unread rows, cancelled Tasks, or historical evidence only to make this Session appear healthy.

Additional problems found later stay in the original investigation documents and do not automatically expand this PR's scope.

## 8. Test Organization

### 8.1 Owning-Boundary Tests

Rust:

- Process ownership and stopping the complete child-process tree.
- Handoff/release/replacement concurrency, timeout, and restart.
- Schemas, execution, and Store authority for both message directions.
- Group source/FIFO/materialize/ack/replay.
- Work episode, Keep stopped, second mission, and completion closure.
- Certificate and final-summary uniqueness and ordering.
- Fail closed for every unknown enum/status.

TypeScript/React:

- Queued/observed state comes from persistent projection.
- Coordinator/Member message UI does not leak internal parameters.
- The three handoff actions communicate their exact impact.
- Typed Needs attention causes and available actions.
- Consistent projection after refresh, Session switch, and restart.

Test file conventions:

- Do not put large Rust test blocks in production files.
- Put different Rust features in separate test files or the corresponding `tests/` directory.
- Use separate `.test.ts`/`.test.tsx` files for TypeScript/React.
- Split rendered E2E by Group FIFO, handoff, and episode/finality. Do not grow a single large spec to cover everything.

### 8.2 Real Packaged App: Two Texas Hold'em Runs

Use a fresh isolated `ORGII_HOME`, temporary git workspace, and the current-branch BuildFast App. Record branch, HEAD, bundle path, and executable SHA-256. Fix the Provider to `orlando / gpt-5.6-terra`.

Perform every visible action with Computer Use. Do not use a debug endpoint instead of sending a message, approving a plan, switching Sessions, stopping, confirming, or retrying.

#### Round One: Build a Texas Hold'em Game from Scratch

1. In the real Group Chat, request: “Plan, implement, run, and verify a local Texas Hold'em game,” and explicitly require separate, persistent implementation-report and test-report TaskOutput/Artifact.
2. Exercise the real flow: Planner submits a plan, the user approves it verbatim, Implementer implements, and Tester runs the app and tests.
3. Tester must start a real test server or equivalent background child process, proving process ownership and the normal terminal path.
4. Risk reports and replies between Coordinator and Member use the correct bidirectional message rules.
5. Do not show a user handoff decision for executions that can be stopped normally and automatically.
6. After every Task is terminal, generate exactly one completion certificate.
7. Finalizing covers only the active `FinalSummaryReceipt`; persist the final report in Coordinator EventStore.
8. Refresh, switch among Planner/Implementer/Tester/Coordinator Sessions, quit, and restart the App. The first round's plan, TaskOutput, Artifact, certificate, and final report must remain visible.
9. Do not send the second-round change until the first round is confirmed fully closed.

#### Round Two: Implement “Arbitrary-Stake Raises” in the Same Session

1. Send this through the real Group input: “I want raises to accept any amount, but it looks like they are limited to 20.”
2. Verify that the system creates a new work episode instead of reopening or mixing into the completed closure from round one.
3. Coordinator actually observes the message and creates the modification/testing work for this round. The message must not sit in the old Inbox or create an empty Wake.
4. Implementer actually changes the game so legal raises are no longer fixed at 20, while preserving poker-rule constraints.
5. While round-two work is active, send a related follow-up through the real Group input. Verify that it appears as Queued, enters the FIFO, and does not cancel the Member currently working.
6. Tester reports one risk using `purpose=risk` or another valid reason that requires Coordinator action. Coordinator replies to Tester normally and omits `purpose`.
7. Tester verifies arbitrary amounts, minimum legal raise, all-in, invalid input, and key regressions, then submits a separate test TaskOutput/Artifact.
8. After every second-round Task is terminal, issue that episode's unique completion certificate and create a second persistent final report.
9. Switch Sessions, refresh, quit, and restart the App. Both episodes' plans, Tasks, results, and final reports remain separate and readable.

#### Focused Fault Scenarios

The main scenario must complete naturally; do not deliberately break round one or two just to force a handoff. Create a separate isolated focused run to cover:

1. One cancel-and-replace where the old process can be proven terminal; handoff is automatic with zero user decisions.
2. Use only an isolated fault fixture to make the old execution genuinely unknown; verify that only one decision card appears.
3. Use the real buttons to verify the exact scope of Continue replacement, Keep stopped, and Abandon episode.
4. Choose Keep stopped with no other open work; the current episode is automatically Cancelled. Then send a new mission and verify it enters a new episode.
5. Still run existing PR8F regressions for Stop, Pause, Resume, Archive, Delete, and Retry. The final Delete confirmation must continue to follow Computer Use safety-confirmation rules.

Read SQLite, EventStore, source/receipt IDs, Task/Output digests, Turn/process owner, certificate, and Provider/runtime request counts at the same time. A debug endpoint cannot substitute for the UI paths above.

### 8.3 Failure and Recovery

- Group commit succeeds but wake is lost.
- Provider response is lost.
- Coordinator/Tester Turn crashes.
- Detached child process or stop timeout.
- Cancellation and completion commits occur in either order.
- App restarts while queued/running/persisting.
- Completion/EventStore/final-summary failure.
- Five Watchdog ticks do not duplicate source, handoff, certificate, or Provider Turn.

## 9. Performance and Lifecycle Requirements

- With no new message or trigger, add no per-Team timer, Provider wake, shell/process, or business-Inbox write.
- Each Group message has one materialized input per source.
- A later row arriving during an active Coordinator Turn triggers at most one follow-up.
- When there is no missing doorbell, Watchdog remains an indexed, read-only no-op.
- Handoff timeout/restart does not retain duplicate runtime, job, or replacement.
- After failure/Idle, there are zero automatic Provider retries for five minutes.
- Ordinary SDE listeners, timers, requests, and message persistence remain at baseline.
- Combine `Command+5`, backend counters, and real CPU/RSS/request data to support performance conclusions; code shape alone is not measurement.

## 10. Conservative Estimate and Scope Gates

This estimate is incremental to the final PR8F head. Review lines are additions + deletions.

| Category | P50 | P90 |
| --- | ---: | ---: |
| Production: Rust, SQL, wire, React | 5,900 | 12,250 |
| Unit, concurrency, recovery, E2E, real measurement | 7,650 | 14,850 |
| Locales, mechanical changes, Design/audit/evidence | 1,450 | 2,700 |
| **Total review lines** | **15,000** | **29,800** |
| **Substantive files** | **70–100** | **120–165** |

List the 13 locales and evidence documents separately; workstreams may touch the same core files, so file counts cannot simply be added.

Scope gates:

- Recalculate at 10,500 review lines (70% of P50).
- If the forecast exceeds 29,800 review lines or 165 substantive files, pause and update the Design, Issue, and budget.
- If the forecast exceeds 44,700 review lines (P90 × 1.5), reassess whether to split, but do not deliver a non-runnable partial chain.
- Stop immediately for confirmation if adding a second dispatcher, new Task state, full PR9/PR10 source/projection, external migration, or Coordinator work tools.
- Do not reduce scope by removing real Provider, packaged-App, process, restart, concurrency, fault, or performance tests.

## 11. Architecture Review Gates

Before final delivery, provide evidence for every layer:

| Layer | Question to answer |
| --- | --- |
| 1. Compilation and warnings | Do Rust, TypeScript, Tauri wire, and E2E targets all pass? |
| 2. Duplication and dead code | Were old Group Inbox + generic wake, incorrect schema, and parallel episode semantics removed rather than leaving a second path alongside them? |
| 3. Naming | Does each of `activation_generation`, work episode, `purpose`, and source receipt express one concept? |
| 4. State dimensions | Are Team, Task, handoff, message observation, episode, and final summary kept separate? |
| 5. Exhaustiveness and defaults | Do unknown status/kind/reason values fail closed rather than defaulting to Pending/Idle/success? |
| 6. Scope isolation | Does ordinary SDE and the not-yet-shipped PR9/PR10 entry path incur zero extra work? |
| 7. Single writer | Does message observation, process release, scope resolution, and certificate each have one transaction owner? |
| 8. Data contract | Do Provider schema, Rust DTO, Tauri command, TypeScript types, and actual wire agree? |
| 9. Initialization symmetry | Do fresh DB, restart, recovery, and fault fixtures use the same canonical schema and resolver? |
| 10. Resolver symmetry | Do normal, restart, and fault paths produce the same postcondition? |

## 12. Delivery and Merge Strategy

1. Keep the current PR8F in Draft; do not merge early on the grounds that “the main code is done.”
2. First organize the PR8F worktree into a reviewable final head and record its SHA.
3. Create `codex/agent-org-pr8-stabilization` or an equivalent branch from that head.
4. Set the stabilization PR's base to the PR8F branch and review all workstreams in one PR.
5. Accept PR8F and Stabilization as one release train; do not claim the user workflow is complete from PR8F alone.
6. After full acceptance, decide with reviewers whether to keep the stacked merge or fold the fixes back into PR8F. Either way, do not leave the final main branch with the known broken chain and an open gate.
7. Start the PR description with the sections `Problem`, `Solution`, and `Potential risks`; list commands actually run, real UI evidence, unrun items, and rollback method.
8. Before release, inspect for secrets, personal paths, isolated test directories, debug logs, build artifacts, and unrelated formatting. None may enter the PR.

## 13. Definition of Done

PR8 Stabilization is Ready only when all of the following are true:

- A Group message sent during work is durably queued and precisely observed by Coordinator.
- Bidirectional Coordinator/Member conversation rules are correct; the Provider does not see invalid reverse-direction parameters.
- An ordinary message failure does not escalate into cancelling an active Tester.
- A Tester process tree that can be stopped automatically no longer requires manual intervention.
- A genuinely unknown state produces only one understandable, recoverable handoff.
- The normal automatic-handoff path shows no user decision.
- The scope of `Keep stopped` is clear before the user clicks.
- If Keep stopped is chosen with no other open work, the current episode is automatically Cancelled.
- The first full Texas Hold'em delivery and the second “arbitrary-stake raise” change can each be completed and persisted independently within the same Session.
- The second mission is not mixed into the first round's closure.
- Each work round has one unique Delivered, Cancelled, Failed, or typed-blocker outcome.
- Completion-certificate/final-summary ordering is correct and recoverable after restart.
- All four problems initially observed by the user stop reproducing in the same real Terra packaged-App scenario.
- Owning tests, full regression, performance, and ordinary-SDE isolation evidence are complete.
- PR9, PR10, and other additional findings have not been silently brought into scope.

## 14. Detailed Evidence Index

- Detailed root causes and test evidence for the original PR8S area (not a separate fix PR): `docs/architecture/agent-org-pr8s-user-observed-issues-handoff.md`
- Detailed root causes and test evidence for the original PR8F Group FIFO area (not a separate fix PR): `docs/architecture/agent-org-pr8f-user-observed-issues-handoff.md`
- Full real-Provider investigation timeline: `docs/architecture/agent-org-pr8f-real-provider-investigation-handoff.md`
- Authoritative design: `docs/architecture/agent-org-long-lived-team-session-design.md`
- Issue: [org2AI/ORG2#997](https://github.com/org2AI/ORG2/issues/997)

If a detailed document conflicts with the Design, the updated Design is authoritative. If this handoff conflicts with real production evidence, stop and investigate the earliest write boundary first; do not work around the conflict by filtering the UI or deleting historical data.
