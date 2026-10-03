/* global browser, process */
import {
  closeSync,
  fstatSync,
  mkdirSync,
  openSync,
  readSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  orgSqlLiteral as literal,
  readOrgEvidence as rows,
} from "./agentOrgTerminalDriver.mjs";
import {
  RUN_ID,
  openRenderedGroupChatView,
  sendRenderedChatPrompt,
  waitForAgentOrgRunView,
} from "./agentOrgUiDriver.mjs";

function wakeLog(runId, memberId) {
  const folder = join(process.env.E2E_ORGII_HOME, "logs");
  const name = readdirSync(folder)
    .filter((name) => name.startsWith("orgii.log."))
    .sort()
    .at(-1);
  if (!name) return [];
  const fd = openSync(join(folder, name), "r");
  try {
    const size = fstatSync(fd).size;
    const data = Buffer.alloc(Math.min(size, 262144));
    readSync(fd, data, 0, data.length, size - data.length);
    return data
      .toString()
      .split("\n")
      .filter(
        (line) =>
          line.includes(runId) &&
          line.includes(`member_id=${memberId}`) &&
          line.includes("wake request finished")
      );
  } finally {
    closeSync(fd);
  }
}

function save(name, evidence) {
  if (!process.env.E2E_EVIDENCE_DIR) return;
  mkdirSync(process.env.E2E_EVIDENCE_DIR, { recursive: true });
  writeFileSync(
    join(process.env.E2E_EVIDENCE_DIR, name),
    JSON.stringify(evidence, null, 2)
  );
}

export async function probeObsoleteAssignmentWake(runId, { postJson }) {
  const task =
    rows(`SELECT task.id,task.owner,session.session_id,session.agent_definition_id
    FROM agent_org_execution_tasks task JOIN agent_org_execution_member_materializations member
      ON member.org_run_id=task.org_run_id AND member.member_id=task.owner AND member.status='succeeded'
    JOIN agent_sessions session ON session.session_id=member.session_id
    WHERE task.org_run_id=${literal(runId)} AND task.status='completed' LIMIT 1`)[0];
  if (!task)
    throw new Error(
      "No production-completed task for obsolete notification test"
    );
  const intents = () =>
    rows(
      `SELECT turn_intent_id,status FROM session_turn_intents WHERE session_id=${literal(task.session_id)} ORDER BY turn_intent_id`
    );
  const before = intents();
  const budget = () =>
    rows(
      `SELECT * FROM agent_org_execution_recovery_attempts WHERE org_run_id=${literal(runId)} AND target_key=${literal(task.owner)}`
    );
  const budgetBefore = budget();
  const inboxIds = [];
  await postJson("/agent/test/session/provider-request-capture", {
    action: "arm",
    clear: true,
  });
  for (let index = 0; index < 2; index += 1) {
    const prior = wakeLog(runId, task.owner).length;
    // Existing test adapter delivers a late notification through the real
    // producer and wake hook; it never changes Task status or certification.
    const result = await postJson(
      "/agent/test/agent-org/startup-recovery/wake-seeded-task",
      {
        org_run_id: runId,
        task_id: task.id,
        member_id: task.owner,
        recipient_agent_id: task.agent_definition_id,
      }
    );
    inboxIds.push(result.inbox_id);
    await browser.waitUntil(
      () => {
        const log = wakeLog(runId, task.owner);
        return log.length > prior && log.at(-1).includes("outcome=NoReadyWork");
      },
      {
        timeout: 10000,
        interval: 100,
        timeoutMsg: "Late assignment did not take the production no-work path",
      }
    );
  }
  const capture = await postJson(
    "/agent/test/session/provider-request-capture",
    { action: "drain", clear: true, disarm: true }
  );
  if ((capture.captures ?? []).length)
    throw new Error("Obsolete assignment started a provider request");
  const after = intents();
  const budgetAfter = budget();
  if (JSON.stringify(before) !== JSON.stringify(after))
    throw new Error("Empty wake created or failed a member intent");
  if (JSON.stringify(budgetBefore) !== JSON.stringify(budgetAfter))
    throw new Error("Empty wake spent a recovery reservation");
  const inbox = rows(
    `SELECT inbox.id,inbox.read_at,resolution.resolution_kind,resolution.reason,
       (SELECT COUNT(*) FROM agent_org_execution_inbox observer WHERE observer.causation_inbox_id=inbox.id) AS observers
     FROM agent_org_execution_inbox inbox LEFT JOIN agent_org_execution_inbox_delivery_resolutions resolution
       ON resolution.inbox_id=inbox.id WHERE inbox.id IN (${inboxIds.join(",")})`
  );
  if (inbox.length !== 2 || inbox.some((row) => row.read_at !== null))
    throw new Error("Empty wake acknowledged unread work");
  if (
    inbox.some(
      (row) =>
        row.resolution_kind !== "cancelled" ||
        row.observers !== 0 ||
        JSON.parse(row.reason).code !== "obsolete_task_assignment"
    )
  )
    throw new Error(
      "Obsolete assignment remained actionable or notified the coordinator"
    );
  save("obsolete-wake.json", {
    runId,
    task,
    before,
    after,
    budgetBefore,
    budgetAfter,
    inbox,
    capture,
    log: wakeLog(runId, task.owner),
  });
}

export async function sendNewWorkAfterObsoleteWake(root, runId) {
  const before = rows(
    `SELECT task_id,turn_intent_id FROM agent_org_execution_turn_contexts WHERE org_run_id=${literal(runId)} AND turn_kind='task_execution' ORDER BY context_id`
  );
  const marker = `member_end_wait_new_input_${RUN_ID}`;
  await openRenderedGroupChatView();
  await sendRenderedChatPrompt(`Run E2E_AGENT_ORG_COMPLETION:${marker}`);
  const view = await waitForAgentOrgRunView(
    root,
    (view) =>
      rows(`SELECT id FROM agent_org_execution_tasks WHERE org_run_id=${literal(runId)}
        AND status='completed' AND instr(subject,${literal(marker)})>0`)
        .length === 1 &&
      view?.finalSummary?.status === "persisted" &&
      view?.runStatus === "idle",
    "fresh user work executes after obsolete wakes",
    90000
  );
  const after = rows(
    `SELECT task_id,turn_intent_id FROM agent_org_execution_turn_contexts WHERE org_run_id=${literal(runId)} AND turn_kind='task_execution' ORDER BY context_id`
  );
  if (
    after.length !== before.length + 1 ||
    before.some(
      (old) => after.filter((next) => next.task_id === old.task_id).length !== 1
    )
  )
    throw new Error(
      "New input either did not run or reran previously certified work"
    );
  save("new-work-after-obsolete-wake.json", {
    root,
    runId,
    before,
    after,
    view,
  });
}
