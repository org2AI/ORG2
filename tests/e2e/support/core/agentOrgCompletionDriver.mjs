/* global browser, process */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  orgSqlLiteral as literal,
  readOrgEvidence as rows,
} from "./agentOrgTerminalDriver.mjs";
import {
  RENDER_TIMEOUT_MS,
  RUN_ID,
  clickRenderedMemberSwitcher,
  configureCreatorForDefaultAgentOrg,
  execJS,
  getApiAccount,
  js,
  openAgentOrgOverviewPanel,
  selectPreferredModel,
  selectRenderedDefaultAgentOrg,
  selectRenderedExecMode,
  sendFromRenderedCreator,
  waitForAgentOrgRunView,
} from "./agentOrgUiDriver.mjs";

async function clickRunControl(selector, label) {
  await browser.waitUntil(
    async () =>
      execJS(`
        const elements = Array.from(document.querySelectorAll(${JSON.stringify(selector)}));
        return elements.some(element => {
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return !element.disabled && rect.width > 0 && rect.height > 0 &&
            style.display !== "none" && style.visibility !== "hidden";
        });
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      interval: 50,
      timeoutMsg: `${label} did not become actionable`,
    }
  );
  if ((await execJS(js.visibleClick(selector))) !== "clicked") {
    throw new Error(`${label} did not click`);
  }
}

export async function runCompletionWaitScenario({
  postJson,
  pauseResumeBeforeMemberExit = false,
}) {
  if ((process.env.E2E_PROVIDER_MODE ?? "mock") !== "mock")
    throw new Error("Controlled completion race requires mock provider");
  const account = await getApiAccount();
  await configureCreatorForDefaultAgentOrg({
    account,
    model: selectPreferredModel(account),
  });
  await selectRenderedExecMode("build");
  await selectRenderedDefaultAgentOrg();
  const scenarioId = pauseResumeBeforeMemberExit
    ? `member_end_wait_pause_resume_before_complete_${RUN_ID}`
    : `member_end_wait_${RUN_ID}`;
  const root = await sendFromRenderedCreator(
    `Run E2E_AGENT_ORG_COMPLETION:${scenarioId}`
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
  const waitForCandidate = async () => {
    await browser.waitUntil(
      async () => {
        const raw = rows(
          `SELECT completion_candidate_json FROM agent_org_execution_run_progress WHERE org_run_id=${literal(runId)}`
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
  };
  if (pauseResumeBeforeMemberExit) {
    await browser.waitUntil(
      async () => {
        const tasks = rows(
          `SELECT status,activation_generation FROM agent_org_execution_tasks WHERE org_run_id=${literal(runId)}`
        );
        const turns = rows(
          `SELECT intent.status FROM agent_org_execution_turn_contexts context JOIN session_turn_intents intent USING(session_id,turn_intent_id) WHERE context.org_run_id=${literal(runId)} AND context.turn_kind='task_execution'`
        );
        return (
          tasks.length === 1 &&
          tasks[0].status === "in_progress" &&
          turns.some((turn) => turn.status === "running")
        );
      },
      {
        timeout: 30000,
        interval: 50,
        timeoutMsg:
          "Pause/Resume scenario never reached the started-before-completion window",
      }
    );
  } else {
    await waitForCandidate();
  }
  let during = rows(
    `SELECT context.turn_intent_id,intent.status FROM agent_org_execution_turn_contexts context JOIN session_turn_intents intent USING(session_id,turn_intent_id) WHERE context.org_run_id=${literal(runId)} AND context.turn_kind='task_execution'`
  );
  if (!during.some((turn) => turn.status === "running"))
    throw new Error("Member-end race window was not actually exercised");
  if (
    rows(
      `SELECT id FROM agent_org_execution_run_completion_certificates WHERE org_run_id=${literal(runId)}`
    ).length
  )
    throw new Error("Candidate certified before member end");
  let pauseResumeEvidence = null;
  if (pauseResumeBeforeMemberExit) {
    const beforePause = await postJson(
      "/agent/test/agent-org/pause/evidence",
      { org_run_id: runId }
    );
    const generationBeforePause = beforePause.durable.activation_generation;
    await openAgentOrgOverviewPanel("completion generation Pause");
    await clickRunControl(
      '[data-testid="agent-org-overview-pause-button"]',
      "completion generation Pause"
    );
    let paused = null;
    await browser.waitUntil(
      async () => {
        paused = await postJson("/agent/test/agent-org/pause/evidence", {
          org_run_id: runId,
        });
        return (
          paused.durable.run_status === "paused" &&
          paused.active_runtime_count === 0 &&
          paused.durable.handoffs?.length > 0 &&
          paused.durable.handoffs?.every((handoff) =>
            ["released", "runtime_absent"].includes(handoff.drain_status)
          )
        );
      },
      {
        timeout: 15_000,
        interval: 50,
        timeoutMsg: `completion generation did not finish draining: ${JSON.stringify(paused)}`,
      }
    );
    await postJson("/agent/test/session/provider-request-capture", {
      action: "arm",
      clear: true,
    });
    await clickRunControl(
      '[data-testid="agent-org-overview-resume-button"]',
      "completion generation Resume"
    );
    let resumed = null;
    await browser.waitUntil(
      async () => {
        resumed = await postJson("/agent/test/agent-org/pause/evidence", {
          org_run_id: runId,
        });
        return (
          resumed.durable.run_status === "running" &&
          resumed.durable.activation_generation === generationBeforePause + 2 &&
          resumed.durable.tasks?.every((task) => task.status === "completed")
        );
      },
      {
        timeout: 15_000,
        interval: 50,
        timeoutMsg: `completion generation did not resume original completed work: ${JSON.stringify(resumed)}`,
      }
    );
    pauseResumeEvidence = { beforePause, paused, resumed };
    during = rows(
      `SELECT context.turn_intent_id,intent.status FROM agent_org_execution_turn_contexts context JOIN session_turn_intents intent USING(session_id,turn_intent_id) WHERE context.org_run_id=${literal(runId)} AND context.turn_kind='task_execution'`
    );
  }
  if (!pauseResumeBeforeMemberExit)
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
    `SELECT inbox.id,inbox.payload_kind,inbox.read_at,resolution.resolution_kind,resolution.reason FROM agent_org_execution_inbox inbox LEFT JOIN agent_org_execution_inbox_delivery_resolutions resolution ON resolution.inbox_id=inbox.id WHERE inbox.org_run_id=${literal(runId)}`
  );
  const idle = dispositions.filter((row) => row.payload_kind === "member_idle");
  const idleHandled = pauseResumeBeforeMemberExit
    ? idle.every(
        (row) => row.read_at !== null || row.resolution_kind === "system_reconciled"
      )
    : idle.every(
        (row) =>
          row.read_at === null && row.resolution_kind === "system_reconciled"
      );
  if (!idle.length || !idleHandled)
    throw new Error(
      `Idle notifications were left unresolved or handled by the wrong path: ${JSON.stringify(idle)}`
    );
  const certificateOwner = rows(
    `SELECT coordinator_session_id AS session_id,coordinator_turn_intent_id AS turn_intent_id FROM agent_org_execution_run_completion_certificates WHERE org_run_id=${literal(runId)} ORDER BY created_at DESC,id DESC LIMIT 1`
  )[0];
  candidate ??= certificateOwner;
  if (!candidate?.session_id || !candidate?.turn_intent_id)
    throw new Error("Persisted completion has no exact coordinator owner");
  const later = rows(
    `SELECT context.*,intent.status FROM agent_org_execution_turn_contexts context JOIN session_turn_intents intent USING(session_id,turn_intent_id) WHERE context.org_run_id=${literal(runId)} AND context.turn_kind='coordinator' AND NOT EXISTS(SELECT 1 FROM agent_org_execution_final_summary_receipts summary WHERE summary.coordinator_session_id=context.session_id AND summary.turn_intent_id=context.turn_intent_id) AND context.context_id>(SELECT context_id FROM agent_org_execution_turn_contexts WHERE session_id=${literal(candidate.session_id)} AND turn_intent_id=${literal(candidate.turn_intent_id)})`
  );
  if (later.some((turn) => !["cancelled", "coalesced"].includes(turn.status)))
    throw new Error(
      `Unexpected coordinator turns after saved authorization: ${JSON.stringify(later)}`
    );
  const summaries = rows(
    `SELECT status,attempt,event_id FROM agent_org_execution_final_summary_receipts WHERE org_run_id=${literal(runId)}`
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
  const requestShapeMatches = pauseResumeBeforeMemberExit
    ? coordinatorRequests.length === 3 &&
      coordinatorRequests.filter((request) =>
        request.toolNames.includes("org_run_complete")
      ).length === 2 &&
      coordinatorRequests.filter((request) => request.toolNames.length === 0)
        .length === 1
    : coordinatorRequests.length === 1 &&
      !coordinatorRequests[0].toolNames.includes("org_run_complete");
  if (requests.length >= 32 || !requestShapeMatches)
    throw new Error(
      `Unexpected Provider requests after the completion boundary: ${JSON.stringify(requests.map(({ sessionId, iteration, toolNames }) => ({ sessionId, iteration, toolNames })))}`
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
          pauseResumeEvidence,
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
    `SELECT * FROM agent_org_execution_tasks WHERE org_run_id=${literal(runId)}`
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
    `SELECT * FROM agent_org_execution_inbox WHERE org_run_id=${literal(runId)} AND payload_kind='task_assigned'`
  ).filter((row) => JSON.parse(row.payload_json).task_id === delivery.id);
  if (deliveries.length !== 1 || deliveries[0].created_at < retest.updated_at)
    throw new Error(
      `Final consumer woke before replacement verification: ${JSON.stringify(deliveries)}`
    );
  const reports = rows(
    `SELECT * FROM agent_org_execution_final_summary_receipts WHERE org_run_id=${literal(runId)}`
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
  const executionSources = rows(
    `SELECT json_extract(args_json,'$.agentOrgExecution.sourceKind') AS source
     FROM events WHERE session_id=${literal(root)} AND event_type='agent_org_execution'`
  ).map((row) => row.source);
  if (
    executionSources.filter((source) => source === "user_input").length !== 1 ||
    !executionSources.includes("member_messages") ||
    executionSources.filter((source) => source === "final_summary").length !== 1
  )
    throw new Error(
      `Actual coordinator wakes have incorrect persisted sources: ${JSON.stringify(executionSources)}`
    );
  const unassociatedMail = rows(
    `SELECT id FROM events WHERE session_id=${literal(root)}
     AND json_extract(result_json,'$.agentOrgInboxTranscript')=1
     AND json_extract(result_json,'$.agentOrgExecution.turnIntentId') IS NULL`
  );
  if (unassociatedMail.length)
    throw new Error(
      `Fresh Inbox transcripts lost persisted execution identity: ${JSON.stringify(unassociatedMail)}`
    );
  await clickRenderedMemberSwitcher("coordinator", root);
  await browser.waitUntil(
    async () =>
      execJS(`
      const headers = Array.from(document.querySelectorAll('[data-testid="agent-org-execution-header"]'));
      return headers.some(header => header.textContent.includes('Inbox messages')) &&
        headers.some(header => header.textContent.includes('Final report'));
    `),
    {
      timeout: 15000,
      interval: 100,
      timeoutMsg: "Private history lost the real wake sources",
    }
  );
  const navigationLabels = await execJS(`
    return Array.from(document.querySelectorAll('[aria-label^="Go to turn"]'))
      .map(button => button.getAttribute('aria-label'));
  `);
  if (
    !navigationLabels.some((label) =>
      label.includes("Coordinator · Inbox messages")
    ) ||
    !navigationLabels.some((label) =>
      label.includes("Coordinator · Final report")
    ) ||
    navigationLabels.some(
      (label) =>
        label.includes("agent-org-execution-") ||
        label.includes("not loaded yet") ||
        label.includes("[Agent Org inbox message")
    )
  )
    throw new Error(
      `Private history lost readable execution previews: ${JSON.stringify(navigationLabels)}`
    );
  const folder = process.env.E2E_EVIDENCE_DIR;
  if (folder) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, "rework.json"),
      JSON.stringify(
        {
          root,
          runId,
          tasks,
          deliveries,
          reports,
          executionSources,
          navigationLabels,
          rendered,
        },
        null,
        2
      )
    );
    await browser.saveScreenshot(join(folder, "rework.png"));
  }
}
