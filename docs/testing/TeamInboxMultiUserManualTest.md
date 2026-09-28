# Team Inbox Dual-Instance Multi-User Collaboration Manual Test

This document verifies the complete flow:

`Session → Work Item → assigned to a team member → collaborative edits → @ mention → reassign / return → reverse handoff`

Run the cases in order. Give each case a unique title so old test data does not affect the results.

## 1. Test Environment

### Instances and Accounts

| Role | Instance | Signed-in account | Cloud Org |
| --- | --- | --- | --- |
| A (initiator) | Instance 1 | `1106510024` | `ORG2–Invite–Test` |
| B (recipient) | Instance 2 | `ahanafish` | `ORG2–Invite–Test` |

Before starting, open the Org menu in the upper-left on each instance and confirm:

- [ ] A shows `Signed in as 1106510024`.
- [ ] B shows `Signed in as ahanafish`.
- [ ] Both instances currently have `ORG2–Invite–Test` selected.
- [ ] Both instances show `Team Inbox`.
- [ ] Do not use the old `/Applications/ORG2.app` installation; use the two development instances built from the current repository.

### Test Data Naming

Record a test run ID first, for example:

```text
TI-20260730-01
```

Use this format for all titles in the run:

```text
[TI-20260730-01] Primary handoff
[TI-20260730-01] Return
[TI-20260730-01] Reverse handoff
```

### Result Record

| Item | Value |
| --- | --- |
| Test date and time | |
| Instance 1 build / PID | |
| Instance 2 build / PID | |
| Account A | |
| Account B | |
| Cloud Org | |
| Test run ID | |

---

## 2. P0 Main Flow: A Hands a Session to B

### TC-01: Create a Session and Open the Handoff Dialog

On instance A:

1. Create a new Session.
2. Enter a request that is easy to identify, for example:

   ```text
   Please review Team Inbox collaboration across two instances and summarize the test results.
   ```

3. Share this Session with `ORG2–Invite–Test`.
4. Drag the Session into Team Inbox, or right-click the Session and select `Create team Work Item…`.

Expected:

- [ ] The original Session card remains in its original position; it is not moved or closed.
- [ ] The `Create from Session` dialog appears.
- [ ] The dialog shows the source Session title or request summary.
- [ ] `Assign to` includes both `1106510024` and `ahanafish`.
- [ ] The default recipient is the current account, `1106510024 (me)`; it does not automatically hand off to someone else.
- [ ] Status, priority, and due date use the same property components as a regular Work Item.

If it fails, record:

- Accounts actually shown under `Assign to`:
- Is B missing:
- Current Org:
- Screenshot:

### TC-02: Set Properties and Hand Off to B

Continue in the handoff dialog on instance A:

1. Change the title to `[test run ID] Primary handoff`.
2. Select `ahanafish` under `Assign to`.
3. Choose a non-default status, for example `In Progress`.
4. Set priority to `High`.
5. Set due date to `Tomorrow`.
6. Enter this Handoff note:

   ```text
   Please update the properties and Todo after accepting, then @mention me to confirm.
   ```

7. Click `Create & hand off`.

Expected:

- [ ] While submitting, the button enters loading/disabled state; repeated clicks do not create duplicates.
- [ ] The dialog closes after a successful submission.
- [ ] Only one corresponding Work Item appears in A's Team Inbox or regular Work Item view.
- [ ] Title, recipient, status, priority, and date match the selections in the dialog.
- [ ] The Work Item retains its source Session.

If it fails, record:

- Exact error text:
- Did clicking Retry succeed:
- Were duplicate Work Items created:
- Screenshot:

### TC-03: B Automatically Receives the Assignment

Keep instance B open to `Team Inbox → Assigned`; do not manually refresh yet.

Expected:

- [ ] The new Work Item appears automatically.
- [ ] The unread badge on the left increases.
- [ ] The card shows the title and `status · priority`, not raw enum values.
- [ ] The card does not expose Markdown markers or literal `\n` escape sequences.
- [ ] After opening details, status is `In Progress`, priority is `High`, and due date is `Tomorrow`.
- [ ] The recipient is displayed as `ahanafish`, not a UUID.
- [ ] The UI shows “Handed off by 1106510024” and the handoff note.
- [ ] While the handoff is Pending, B can see `Accept` and `Return`.

Record propagation timing:

| Item | Result |
| --- | --- |
| Time from successful creation on A until it appears automatically on B | seconds |
| Was a system notification shown | yes / no |
| Was a manual refresh required | yes / no |

Note: Record automatic arrival time as an observation; do not assume a fixed SLA. If it has not appeared after about 15 seconds, click refresh once. Record “appeared only after refresh” as a propagation issue.

---

## 3. P0 Acceptance and Bidirectional Property Sync

### TC-04: B Accepts the Handoff

On instance B:

1. Open `[test run ID] Primary handoff`.
2. Click `Accept`.

Expected:

- [ ] Status changes from Pending to Accepted.
- [ ] The Work Item remains assigned to B.
- [ ] `Return` is no longer shown as an available action.
- [ ] Repeating Accept does not create a second handoff or an invalid state.
- [ ] Instance A sees Accepted when it opens the same Work Item.

### TC-05: B Changes Properties and A Sees the Updates Live

Open the same Work Item in instances A and B at the same time.

On instance B, change these properties in order:

1. Status: `In Progress → In Review`.
2. Priority: `High → Urgent`.
3. Due date: `Tomorrow → Next week`.

Expected:

- [ ] After each change, B's details and left-side card agree.
- [ ] Without reopening the Work Item, A eventually sees `In Review / Urgent / Next week`.
- [ ] A's left-side card updates its status and priority too.
- [ ] Rapid consecutive changes are not overwritten by stale responses.
- [ ] Final values remain consistent after refreshing both instances.
- [ ] Activity shows meaningful property changes, not repeated events with no useful information.

Results:

| Field | B final value | A auto-synced value | Value after refresh |
| --- | --- | --- | --- |
| Status | | | |
| Priority | | | |
| Due date | | | |

---

## 4. P0 Collaborative Todo

### TC-06: B Adds and Completes Todos

On instance B:

1. Add `B-check-sync`.
2. Add `B-submit-summary`.
3. Mark `B-check-sync` complete.

Expected:

- [ ] B shows `1/2`.
- [ ] The completed item has completed styling; the incomplete item remains actionable.
- [ ] A automatically sees the same two items and `1/2`.
- [ ] The state remains the same after refresh.

### TC-07: A and B Make Consecutive Todo Changes

1. A adds `A-additional-verification`.
2. B marks `B-submit-summary` complete.
3. A deletes `A-additional-verification`.

Expected:

- [ ] Both sides end with only the two Todos created by B.
- [ ] Both items are complete and the count is `2/2`.
- [ ] The deleted Todo does not reappear because of a stale write from the other side.
- [ ] B's newly completed Todo is not lost.

---

## 5. P0 Comments and @ Mentions

### TC-08: B Comments and @Mentions A

On the same Work Item in instance B:

1. Click the comment input area.
2. In the `@` member picker, select `1106510024`.
3. Enter:

   ```text
   The properties and Todos are updated. Please review.
   ```

4. Submit the comment.

Expected:

- [ ] The comment appears immediately in the discussion; the author is `ahanafish`.
- [ ] The same author's avatar color remains consistent.
- [ ] The comment is easy to find directly in Discussion and is not buried among ordinary Activity changes.
- [ ] Instance A automatically receives one unread mention under `Team Inbox → Mentions`.
- [ ] The mention card points to the correct Work Item and comment.
- [ ] Instance B does not receive the mention addressed to A.

### TC-09: A Reads the Mention and Marks It Unread Again

On instance A:

1. Open the mention from `Mentions`.
2. Return to the list.
3. In the details, select `Mark as unread`.
4. Open the mention again.

Expected:

- [ ] After the first open, A's unread Mentions count decreases.
- [ ] After `Mark as unread`, the row and Sidebar badge become unread again.
- [ ] Opening it again allows it to be marked read again.
- [ ] B's unread state is unaffected by A's actions.
- [ ] After closing and reopening Team Inbox, A's final read state is still saved.

---

## 6. P0 Reassignment

### TC-10: B Reassigns the Work Item to A

On instance B:

1. Open the Assignee property.
2. Select `1106510024`.

Expected:

- [ ] The Work Item assignee immediately shows `1106510024`.
- [ ] The item is removed from B's `Assigned` list.
- [ ] The item appears unread in A's `Assigned` list.
- [ ] When A opens it, all prior properties, Todos, and comments are present; no data is lost.
- [ ] Activity records exactly one effective reassignment.

---

## 7. P0 Return Flow

Do not use an Accepted Work Item to test Return. Create a second, separate handoff.

### TC-11: A Creates a Second Handoff and B Returns It

1. A creates `[test run ID] Return` from another Session.
2. A assigns it to B.
3. B opens it but does not click Accept; click `Return` directly.
4. Enter a reason:

   ```text
   Please add the acceptance scope before handing this off again.
   ```

5. Confirm the return.

Expected:

- [ ] An empty return reason cannot be submitted.
- [ ] After submission, the handoff status changes to Returned.
- [ ] The return reason is visible on both instances.
- [ ] The Work Item is automatically reassigned to A.
- [ ] The item is removed from B's Assigned list.
- [ ] An unread item appears in A's Assigned list.
- [ ] Properties, Todos, comments, and source Session are all retained.
- [ ] Returned status and return reason persist after refresh.

---

## 8. P0 Bidirectional Handoff

### TC-12: B Hands a Session to A

On instance B:

1. Create a new Session and share it with the same Org.
2. Create `[test run ID] Reverse handoff` from that Session.
3. Select `1106510024` under `Assign to`.
4. Choose a non-default status, priority, and date.
5. Submit.

Expected:

- [ ] The exact same handoff dialog is used as for A → B.
- [ ] Sender is `ahanafish`; recipient is `1106510024`.
- [ ] A automatically receives an unread Assigned item and a Pending handoff action.
- [ ] A can Accept or Return.
- [ ] There are no missing fields or read-only states unique to this direction.

---

## 9. P1 Idempotency, Recovery, and Isolation

### TC-13: Drag the Same Session In Again

1. Choose a Session for which a Work Item has already been created successfully.
2. Drag it into Team Inbox again and submit.

Expected:

- [ ] The existing linked Work Item is reused, or the UI clearly says it already exists.
- [ ] No second Work Item is created.
- [ ] No second Pending handoff is created.

### TC-14: Retry After a Submission Failure

If it is safe to simulate a network failure:

1. Open the handoff dialog and fill in title, recipient, properties, and note.
2. Temporarily disconnect the network or cause the cloud request to fail.
3. Submit.
4. Restore the network and retry.

Expected:

- [ ] On failure, a clear error is shown; the dialog does not close silently.
- [ ] Title, recipient, properties, and note are retained.
- [ ] Retrying after recovery creates only one Work Item.
- [ ] B ultimately receives the assignment only once.

### TC-15: Isolate Data When Switching Orgs

1. A opens Team Inbox.
2. Switch to another Org or personal space.
3. Switch back to `ORG2–Invite–Test`.

Expected:

- [ ] After switching away, Team Inbox data from the previous Org is no longer shown.
- [ ] On return, the correct data reloads.
- [ ] A slow request does not write members or Work Items from the old Org back into the current UI.

### TC-16: Search, Filters, and Empty States

On either instance:

1. Open `All / Mentions / Assigned` in turn.
2. Search for this test run ID.
3. Search for text that does not exist.
4. Clear the search.

Expected:

- [ ] Each tab's name, list contents, and empty-state meaning are consistent.
- [ ] Unread badges count only items in the corresponding filter.
- [ ] No results show `No matches`, not a false indication that the Inbox is empty.
- [ ] Clearing the search restores the original list.

---

## 10. P1 UI and Responsive Checks

### TC-17: Property Component Consistency

Compare the handoff dialog, Team Inbox details, and regular Open Work Item details:

- [ ] Status, Priority, and Due date icons, labels, and color tokens are consistent.
- [ ] Dropdown options map to the same final values.
- [ ] `Tomorrow` does not appear cramped, overlap, or render as a raw ISO timestamp.
- [ ] Property pills wrap when the window narrows; they do not overflow horizontally.
- [ ] Dropdown layers appear above the Modal and are not clipped.

### TC-18: Keyboard and Submission Lock

- [ ] Tab moves through title, recipient, properties, note, and buttons in a sensible order.
- [ ] Escape closes the dialog before submission.
- [ ] While submission is loading, Escape, Cancel, and property changes do not create duplicates or an intermediate state.
- [ ] Dropdown menus can be opened, selected, and closed from the keyboard.
- [ ] If the selected member becomes invalid before submission, the UI explains why instead of showing only an unclickable button.

Note: Full screen-reader naming/combobox semantics for the shared `Select` remain a component-level audit item. This case records actual keyboard behavior and visible labels; do not mark the incomplete app-wide accessibility sweep as passed.

---

## 11. Final Pass Criteria

### Core End-to-End Flow

- [ ] A → B creation, delivery, and reading succeed.
- [ ] B can see and act on the Pending handoff.
- [ ] Accept succeeds and syncs across instances.
- [ ] Status / Priority / Due date sync bidirectionally and persist.
- [ ] Todos support collaboration in both directions without data loss or resurrection of deleted items.
- [ ] After B @mentions A in a comment, only A receives an unread item in Mentions.
- [ ] Read/unread state is isolated per user and persists.
- [ ] Reassignment moves the Assigned projection and resets unread state for the new recipient.
- [ ] Return saves its reason and atomically reassigns the item to the sender.
- [ ] The reverse B → A handoff uses the same UI and state machine.
- [ ] Retrying or dragging in again does not create duplicate Work Items/handoffs.

### Must Not Occur

- [ ] A known member name is not replaced by a UUID.
- [ ] No raw enum such as `in_progress` or `in_review` is displayed.
- [ ] No raw ISO date appears in user-facing text.
- [ ] Read state does not leak between A and B.
- [ ] Data from the previous Org is not shown after switching Orgs.
- [ ] A single submission does not create multiple Work Items.

---

## 12. Defect Report Template

Copy the template below and create a separate entry for each issue:

```md
### [FAIL] TC-XX: Issue title

- Time:
- Instance operated: A / B
- Signed-in account:
- Current Org:
- Work Item title:
- State before operation:
- Steps:
  1.
  2.
  3.
- Actual result:
- Expected result:
- Did it recover automatically after waiting:
- Did it recover after clicking refresh:
- Did it recover after restarting:
- Screenshot:
- Exact error text:
```
