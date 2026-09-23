/* global browser, process */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  orgSqlLiteral as literal,
  readOrgEvidence as rows,
} from "./agentOrgTerminalDriver.mjs";
import {
  RUN_ID,
  clickRenderedMemberSwitcher,
  configureCreatorForDefaultAgentOrg,
  execJS,
  getApiAccount,
  invokeE2E,
  js,
  openAgentOrgOverviewPanel,
  openRenderedSidebarSession,
  selectPreferredModel,
  selectRenderedDefaultAgentOrg,
  selectRenderedExecMode,
  sendFromRenderedCreator,
  waitForAgentOrgRunView,
  waitForApp,
} from "./agentOrgUiDriver.mjs";

export async function runSummaryStopScenario(window, { postJson }) {
  if ((process.env.E2E_PROVIDER_MODE ?? "mock") !== "mock")
    throw new Error(
      "Deterministic report Stop windows require the mock provider"
    );
  const account = await getApiAccount();
  await configureCreatorForDefaultAgentOrg({
    account,
    model: selectPreferredModel(account),
  });
  await selectRenderedExecMode("build");
  await selectRenderedDefaultAgentOrg();
  await postJson("/agent/test/session/provider-request-capture", {
    action: "arm",
    clear: true,
  });
  const root = await sendFromRenderedCreator(
    `Run E2E_AGENT_ORG_COMPLETION:member_end_wait_summary_stop_${window}_${RUN_ID}`
  );
  const started = await waitForAgentOrgRunView(
    root,
    (view) =>
      view?.finalSummary?.status === "running" &&
      Boolean(view?.finalSummary?.certificateId) &&
      view?.taskOverview?.completed === 1,
    `report ${window} Stop window`
  );
  const runId = started.context.runId;
  const first = started.finalSummary;
  const certificates = rows(
    `SELECT id FROM agent_org_runtime_run_completion_certificates WHERE org_run_id=${literal(runId)} AND id=${literal(first.certificateId)}`
  );
  if (certificates.length !== 1)
    throw new Error("Running report has no durable work certificate");
  let providerRequests;
  await browser.waitUntil(
    async () => {
      providerRequests =
        (
          await postJson("/agent/test/session/provider-request-capture", {
            action: "drain",
            clear: false,
            disarm: false,
          })
        ).captures ?? [];
      return providerRequests.some(
        (request) =>
          request.sessionId === root && request.toolNames.length === 0
      );
    },
    {
      timeout: 10000,
      interval: 150,
      timeoutMsg: "Report provider request never started",
    }
  );
  await postJson("/agent/test/session/provider-request-capture", {
    action: "disarm",
  });
  const tasksBefore = rows(
    `SELECT id,status,output_json FROM agent_org_runtime_tasks WHERE org_run_id=${literal(runId)} ORDER BY id`
  );
  const executionsBefore = rows(
    `SELECT session_id,turn_intent_id FROM agent_org_runtime_turn_contexts WHERE org_run_id=${literal(runId)} AND turn_kind='task_execution' ORDER BY context_id`
  );
  await clickRenderedMemberSwitcher("coordinator", root);
  let streamWindow;
  if (window === "stream")
    await browser.waitUntil(
      async () => {
        // Formal report deltas can be outside the current transcript page.
        // This read-only probe proves the timing; Stop still clicks the UI.
        streamWindow = await invokeE2E("inspectChatState");
        return (
          streamWindow?.activeSessionId === root &&
          streamWindow?.streamingDelta?.text?.includes("REPORT_STREAM_STARTED")
        );
      },
      {
        timeout: 15000,
        interval: 150,
        timeoutMsg: "Report provider did not reach its streaming window",
      }
    );
  const stop = '[data-testid="chat-send-button"][data-state="stop"]';
  await browser.waitUntil(
    async () =>
      execJS(
        `return Array.from(document.querySelectorAll(${JSON.stringify(stop)})).some(button => !button.disabled && button.getBoundingClientRect().width > 0);`
      ),
    {
      timeout: 10000,
      timeoutMsg: "Report Stop button did not become actionable",
    }
  );
  if ((await execJS(js.visibleClick(stop))) !== "clicked")
    throw new Error("Report Stop did not click");
  const stopped = await waitForAgentOrgRunView(
    root,
    (view) =>
      view?.finalSummary?.status === "failed" &&
      view?.finalSummary?.typedError === "stopped" &&
      view?.runStatus === "idle",
    "stopped report attempt released and Team idle"
  );
  await browser.waitUntil(
    async () =>
      execJS(
        `return Array.from(document.querySelectorAll('[data-testid="chat-send-button"]')).some(button => button.getBoundingClientRect().width > 0 && button.dataset.state !== 'stop');`
      ),
    {
      timeout: 10000,
      timeoutMsg: "Report Stop left the rendered composer in its running state",
    }
  );
  const stopEventId = `agent-org-${first.receiptId}`;
  if (
    rows(
      `SELECT id FROM events WHERE session_id=${literal(root)} AND id=${literal(stopEventId)}`
    ).length
  )
    throw new Error("Stopped partial report was published as a formal report");
  const terminal = rows(
    `SELECT status FROM session_turn_intents WHERE session_id=${literal(root)} AND turn_intent_id=${literal(first.turnIntentId)}`
  )[0];
  if (terminal?.status !== "cancelled")
    throw new Error(`Report Stop terminal is ${JSON.stringify(terminal)}`);
  if (
    stopped.finalSummary.certificateId !== first.certificateId ||
    !stopped.finalSummary.canRetry
  )
    throw new Error("Report Stop lost certification or explicit retry");
  await openAgentOrgOverviewPanel("stopped report explicit retry");
  const retried = await execJS(`
    const button=document.querySelector('[data-testid="agent-org-final-summary-retry"]');
    if (!button || button.disabled || button.getBoundingClientRect().width===0) return false;
    button.click(); button.click(); return true;
  `);
  if (!retried) throw new Error("Rendered report Retry button was unavailable");
  const persisted = await waitForAgentOrgRunView(
    root,
    (view) =>
      view?.finalSummary?.attempt === 2 &&
      view?.finalSummary?.status === "persisted" &&
      view?.runStatus === "idle",
    "double-click report retry persists exactly one report",
    90000
  );
  const attempts = rows(
    `SELECT status,attempt,event_id,typed_error,certificate_id FROM agent_org_runtime_final_summary_receipts WHERE org_run_id=${literal(runId)} ORDER BY attempt`
  );
  if (
    attempts.length !== 2 ||
    attempts[0].typed_error !== "stopped" ||
    attempts[1].status !== "persisted"
  )
    throw new Error(
      `Unexpected report retry attempts: ${JSON.stringify(attempts)}`
    );
  const tasksAfter = rows(
    `SELECT id,status,output_json FROM agent_org_runtime_tasks WHERE org_run_id=${literal(runId)} ORDER BY id`
  );
  const executionsAfter = rows(
    `SELECT session_id,turn_intent_id FROM agent_org_runtime_turn_contexts WHERE org_run_id=${literal(runId)} AND turn_kind='task_execution' ORDER BY context_id`
  );
  if (
    JSON.stringify(tasksBefore) !== JSON.stringify(tasksAfter) ||
    JSON.stringify(executionsBefore) !== JSON.stringify(executionsAfter)
  )
    throw new Error("Retry changed certified work or reran a member");
  const events = rows(
    `SELECT event.id,event.result_json FROM events event JOIN agent_org_runtime_final_summary_receipts receipt ON receipt.event_id=event.id AND receipt.coordinator_session_id=event.session_id WHERE receipt.org_run_id=${literal(runId)}`
  );
  if (
    events.length !== 1 ||
    JSON.parse(events[0].result_json).agent_org_completion_certificate?.id !==
      first.certificateId
  )
    throw new Error(
      `Expected one certificate-bound report: ${JSON.stringify(events)}`
    );
  await browser.reloadSession();
  await waitForApp();
  // Exercise navigation through collapsed date groups without changing the clock.
  for (const group of ["today", "yesterday", "thisWeek", "older"]) {
    const toggle = await browser.$(
      `[data-sidebar-section-toggle="${group}"][aria-expanded="true"]`
    );
    if (await toggle.isExisting()) await toggle.click();
  }
  await openRenderedSidebarSession(root);
  await waitForAgentOrgRunView(
    root,
    (view) =>
      view?.finalSummary?.eventId === persisted.finalSummary.eventId &&
      view?.runStatus === "idle",
    "same report survives application restart"
  );
  const folder = process.env.E2E_EVIDENCE_DIR;
  if (folder) {
    mkdirSync(folder, { recursive: true });
    writeFileSync(
      join(folder, `summary-stop-${window}.json`),
      JSON.stringify(
        {
          root,
          runId,
          started,
          stopped,
          terminal,
          persisted,
          attempts,
          events,
          tasksBefore,
          tasksAfter,
          executionsBefore,
          executionsAfter,
          providerRequests,
          streamWindow,
          rendered: await execJS("return document.body.innerText;"),
        },
        null,
        2
      )
    );
    await browser.saveScreenshot(join(folder, `summary-stop-${window}.png`));
  }
  await invokeE2E("resetToNewSession");
}
