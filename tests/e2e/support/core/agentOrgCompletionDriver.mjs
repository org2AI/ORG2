/* global browser, process */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  orgSqlLiteral as literal,
  readOrgEvidence as rows,
} from "./agentOrgTerminalDriver.mjs";
import {
  RUN_ID,
  configureCreatorForDefaultAgentOrg,
  execJS,
  getApiAccount,
  openAgentOrgOverviewPanel,
  selectPreferredModel,
  selectRenderedDefaultAgentOrg,
  selectRenderedExecMode,
  sendFromRenderedCreator,
  waitForAgentOrgRunView,
} from "./agentOrgUiDriver.mjs";

export async function runCompletionWaitScenario({ postJson }) {
  if ((process.env.E2E_PROVIDER_MODE ?? "mock") !== "mock")
    throw new Error("Controlled completion race requires mock provider");
  const account = await getApiAccount();
  await configureCreatorForDefaultAgentOrg({
    account,
    model: selectPreferredModel(account),
  });
  await selectRenderedExecMode("build");
  await selectRenderedDefaultAgentOrg();
  const root = await sendFromRenderedCreator(
    `Run E2E_AGENT_ORG_COMPLETION:member_end_wait_${RUN_ID}`
  );
  let runId;
  await waitForAgentOrgRunView(
    root,
    (view) => {
      runId = view?.context?.runId;
      return Boolean(runId);
    },
    "completion wait Team"
  );
  let candidate;
  await browser.waitUntil(
    async () => {
      const raw = rows(
        `SELECT completion_candidate_json FROM agent_org_runtime_run_progress WHERE org_run_id=${literal(runId)}`
      )[0]?.completion_candidate_json;
      candidate = raw ? JSON.parse(raw) : null;
      return Boolean(
        candidate &&
        rows(
          `SELECT 1 FROM session_turn_intents WHERE session_id=${literal(candidate.session_id)} AND turn_intent_id=${literal(candidate.turn_intent_id)} AND status='completed'`
        ).length
      );
    },
    {
      timeout: 30000,
      interval: 100,
      timeoutMsg:
        "Did not observe a successful coordinator waiting for the still-running member",
    }
  );
  const during = rows(
    `SELECT context.turn_intent_id,intent.status FROM agent_org_runtime_turn_contexts context JOIN session_turn_intents intent USING(session_id,turn_intent_id) WHERE context.org_run_id=${literal(runId)} AND context.turn_kind='task_execution'`
  );
  if (!during.some((turn) => turn.status === "running"))
    throw new Error("Member-end race window was not actually exercised");
  if (
    rows(
      `SELECT id FROM agent_org_runtime_run_completion_certificates WHERE org_run_id=${literal(runId)}`
    ).length
  )
    throw new Error("Candidate certified before member end");
  await postJson("/agent/test/session/provider-request-capture", {
    action: "arm",
    clear: true,
  });
  let finalView;
  await waitForAgentOrgRunView(
    root,
    (view) => {
      finalView = view;
      return (
        view?.finalSummary?.status === "persisted" && view?.runStatus === "idle"
      );
    },
    "event-driven completion and persisted report"
  );
  const dispositions = rows(
    `SELECT inbox.id,inbox.payload_kind,inbox.read_at,resolution.resolution_kind,resolution.reason FROM agent_org_runtime_inbox inbox LEFT JOIN agent_org_runtime_inbox_delivery_resolutions resolution ON resolution.inbox_id=inbox.id WHERE inbox.org_run_id=${literal(runId)}`
  );
  const idle = dispositions.filter((row) => row.payload_kind === "member_idle");
  if (
    !idle.length ||
    idle.some(
      (row) =>
        row.read_at !== null || row.resolution_kind !== "system_reconciled"
    )
  )
    throw new Error(
      `Idle notifications were not system reconciled: ${JSON.stringify(idle)}`
    );
  const later = rows(
    `SELECT context.*,intent.status FROM agent_org_runtime_turn_contexts context JOIN session_turn_intents intent USING(session_id,turn_intent_id) WHERE context.org_run_id=${literal(runId)} AND context.turn_kind='coordinator' AND NOT EXISTS(SELECT 1 FROM agent_org_runtime_final_summary_receipts summary WHERE summary.coordinator_session_id=context.session_id AND summary.turn_intent_id=context.turn_intent_id) AND context.context_id>(SELECT context_id FROM agent_org_runtime_turn_contexts WHERE session_id=${literal(candidate.session_id)} AND turn_intent_id=${literal(candidate.turn_intent_id)})`
  );
  if (later.some((turn) => !["cancelled", "coalesced"].includes(turn.status)))
    throw new Error(
      `Unexpected coordinator turns after saved authorization: ${JSON.stringify(later)}`
    );
  const summaries = rows(
    `SELECT status,attempt,event_id FROM agent_org_runtime_final_summary_receipts WHERE org_run_id=${literal(runId)}`
  );
  if (summaries.length !== 1 || summaries[0].status !== "persisted")
    throw new Error(
      `Expected one durable report: ${JSON.stringify(summaries)}`
    );
  const capture = await postJson(
    "/agent/test/session/provider-request-capture",
    { action: "drain", clear: true, disarm: true }
  );
  const requests = capture.captures ?? [];
  const coordinatorRequests = requests.filter(
    (request) => request.sessionId === root
  );
  if (
    requests.length >= 32 ||
    coordinatorRequests.length !== 1 ||
    coordinatorRequests[0].toolNames.includes("org_run_complete")
  )
    throw new Error(
      `Expected only the report Provider request after authorized wait: ${JSON.stringify(requests.map(({ sessionId, iteration, toolNames }) => ({ sessionId, iteration, toolNames })))}`
    );
  await openAgentOrgOverviewPanel("event-driven completion");
  const rendered = await execJS("return document.body.innerText;");
  const folder = process.env.E2E_EVIDENCE_DIR;
  if (folder) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "completion-wait.json"),
      JSON.stringify(
        {
          root,
          runId,
          candidate,
          during,
          dispositions,
          later,
          summaries,
          providerRequests: requests,
          finalView,
          rendered,
        },
        null,
        2
      )
    );
    await browser.saveScreenshot(join(folder, "completion-wait.png"));
  }
}

export async function runReworkScenario() {
  if ((process.env.E2E_PROVIDER_MODE ?? "mock") !== "mock")
    throw new Error("Controlled rework protocol requires mock provider");
  const account = await getApiAccount();
  await configureCreatorForDefaultAgentOrg({
    account,
    model: selectPreferredModel(account),
  });
  await selectRenderedExecMode("build");
  await selectRenderedDefaultAgentOrg();
  // Only provider responses are scripted. Launch, task tools, wake, inbox,
  // completion and report persistence all run through production paths.
  const root = await sendFromRenderedCreator(
    `Run E2E_AGENT_ORG_REWORK:${RUN_ID}`
  );
  let finalView;
  await waitForAgentOrgRunView(
    root,
    (view) => {
      finalView = view;
      return (
        view?.runStatus === "idle" && view?.finalSummary?.status === "persisted"
      );
    },
    "repair, new verification, explicit consumer dependency patch and final report"
  );
  const runId = finalView.context.runId;
  const tasks = rows(
    `SELECT * FROM agent_org_runtime_tasks WHERE org_run_id=${literal(runId)}`
  );
  const task = (suffix) =>
    tasks.find((row) => row.subject === `E2E_AGENT_ORG_REWORK:${suffix}`);
  const original = task("implementation");
  const review = task("review");
  const repair = task("repair");
  const retest = task("retest");
  const delivery = task("delivery");
  if (tasks.length !== 5 || tasks.some((row) => row.status !== "completed"))
    throw new Error(
      `Rework did not close exactly five real tasks: ${JSON.stringify(tasks)}`
    );
  if (
    repair?.replaces_task_id !== original?.id ||
    retest?.replaces_task_id !== review?.id ||
    JSON.stringify(JSON.parse(retest.blocked_by_json)) !==
      JSON.stringify([repair.id]) ||
    JSON.stringify(JSON.parse(delivery.blocked_by_json)) !==
      JSON.stringify([retest.id])
  )
    throw new Error(
      `Rework dependencies do not bind the new version: ${JSON.stringify(tasks)}`
    );
  if (
    !JSON.parse(review.output_json).content.includes("Defect observed") ||
    !JSON.parse(retest.output_json).content.includes(
      "Repaired version verified"
    )
  )
    throw new Error(
      "Old defect evidence was rewritten or replacement verification is missing"
    );
  const deliveries = rows(
    `SELECT * FROM agent_org_runtime_inbox WHERE org_run_id=${literal(runId)} AND payload_kind='task_assigned'`
  ).filter((row) => JSON.parse(row.payload_json).task_id === delivery.id);
  if (deliveries.length !== 1 || deliveries[0].created_at < retest.updated_at)
    throw new Error(
      `Final consumer woke before replacement verification: ${JSON.stringify(deliveries)}`
    );
  const reports = rows(
    `SELECT * FROM agent_org_runtime_final_summary_receipts WHERE org_run_id=${literal(runId)}`
  );
  if (reports.length !== 1 || reports[0].status !== "persisted")
    throw new Error(
      `Rework needs exactly one durable report: ${JSON.stringify(reports)}`
    );
  await openAgentOrgOverviewPanel("repaired delivery");
  const rendered = await execJS("return document.body.innerText;");
  if (!rendered.includes("E2E_AGENT_ORG_REWORK:delivery"))
    throw new Error(
      "Repaired delivery task was not visible in the real team overview"
    );
  const folder = process.env.E2E_EVIDENCE_DIR;
  if (folder) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "rework.json"),
      JSON.stringify(
        { root, runId, tasks, deliveries, reports, rendered },
        null,
        2
      )
    );
    await browser.saveScreenshot(join(folder, "rework.png"));
  }
}
