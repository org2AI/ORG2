/* global describe, before, beforeEach, afterEach, it, process, fetch */
import { execFileSync } from "node:child_process";

import {
  AGENT_ORG_COORDINATOR_MEMBER_ID,
  AGENT_ORG_TASK_STATUS,
  DEFAULT_AGENT_ORG_MEMBER_IDS,
  RUN_ID,
  assertE2ERepoFixture,
  configureCreatorForDefaultAgentOrg,
  getApiAccount,
  invokeE2E,
  openAgentOrgOverviewPanel,
  selectPreferredModel,
  selectRenderedDefaultAgentOrg,
  selectRenderedExecMode,
  sendFromRenderedCreator,
  unwrap,
  waitForAgentOrgRunView,
  waitForApp,
} from "../../support/core/agentOrgUiDriver.mjs";

async function readProcessEvidence(runId) {
  const response = await fetch(
    `http://127.0.0.1:${process.env.E2E_IDE_SERVER_PORT ?? "13847"}/agent/test/agent-org/pause/evidence`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ org_run_id: runId }),
      signal: AbortSignal.timeout(15_000),
    }
  );
  const result = await response.json();
  if (!response.ok || result.ok !== true)
    throw new Error(JSON.stringify(result));
  return result.background_shells ?? [];
}

function processGroupExists(pid) {
  return execFileSync("ps", ["-ax", "-o", "pgid="], { encoding: "utf8" })
    .split("\n")
    .some((line) => Number(line.trim()) === pid);
}

async function waitForOwnedShell(runId) {
  let shell;
  await browser.waitUntil(
    async () => {
      const jobs = await readProcessEvidence(runId);
      shell = jobs.length === 1 ? jobs[0] : null;
      return Boolean(
        shell?.handle?.startsWith("shell-") &&
        shell.session_id &&
        shell.call_id &&
        processGroupExists(shell.pid)
      );
    },
    {
      timeout: 30_000,
      interval: 100,
      timeoutMsg: "Task shell did not publish an exact live registration",
    }
  );
  return shell;
}

describe("Agent Org safe Task handoff rendered UI", () => {
  before(async () => {
    assertE2ERepoFixture();
    await waitForApp();
  });

  beforeEach(async () => {
    await invokeE2E("resetToNewSession");
  });

  afterEach(async () => {
    await invokeE2E("resetToNewSession");
  });

  it("reassigns only after old execution release and cancels the replacement through real controls", async () => {
    const account = await getApiAccount();
    const model = selectPreferredModel(account);
    await configureCreatorForDefaultAgentOrg({ account, model });
    await selectRenderedExecMode("build");
    await selectRenderedDefaultAgentOrg();

    const scenarioId = `rendered_${RUN_ID}`;
    const sessionId = await sendFromRenderedCreator(
      `Run E2E_AGENT_ORG_HANDOFF:${scenarioId}`
    );
    if (!sessionId) {
      throw new Error("safe handoff launch did not create a root Session");
    }

    let oldTaskId = null;
    const runningView = await waitForAgentOrgRunView(
      sessionId,
      (view) => {
        const task = (view?.tasks ?? []).find(
          (candidate) => candidate.subject === `E2E_HANDOFF_TASK:${scenarioId}`
        );
        oldTaskId = task?.id ?? null;
        return Boolean(
          view?.currentMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID &&
          task?.status === AGENT_ORG_TASK_STATUS.IN_PROGRESS &&
          task?.owner === DEFAULT_AGENT_ORG_MEMBER_IDS.IMPLEMENTER
        );
      },
      "old Task owns a live execution before rendered reassignment"
    );
    if (!oldTaskId) throw new Error("safe handoff Task id was not projected");
    const oldShell = await waitForOwnedShell(runningView.context.runId);

    await openAgentOrgOverviewPanel("safe handoff reassignment");
    const oldRow = await browser.$(
      `[data-testid="agent-org-overview-task-row"][data-task-id="${oldTaskId}"]`
    );
    await oldRow.$('[data-testid="agent-org-task-reassign-button"]').click();
    await browser
      .$('[data-testid="agent-org-task-reassign-owner-select"]')
      .click();
    await browser
      .$(
        `[data-testid="agent-org-task-reassign-owner-option-${DEFAULT_AGENT_ORG_MEMBER_IDS.REVIEWER}"]`
      )
      .click();
    await browser
      .$('[data-testid="agent-org-task-handoff-confirm-button"]')
      .click();

    let replacementTaskId = null;
    let sawBlockedReplacement = false;
    let latest = null;
    try {
      await browser.waitUntil(
        async () => {
          latest = unwrap(
            await invokeE2E("agentOrgSessionRunView", sessionId),
            "agentOrgSessionRunView(reassignment fence)"
          ).view;
          const handoff = (latest?.executionHandoffs ?? []).find(
            (receipt) => receipt.oldTaskId === oldTaskId
          );
          replacementTaskId = handoff?.replacementTaskId ?? replacementTaskId;
          const replacement = (latest?.tasks ?? []).find(
            (task) => task.id === replacementTaskId
          );
          if (
            handoff &&
            (handoff.state === "requested" || handoff.state === "yielding")
          ) {
            if (replacement?.status !== AGENT_ORG_TASK_STATUS.PENDING) {
              throw new Error(
                `replacement escaped Pending before release: ${JSON.stringify({ handoff, replacement })}`
              );
            }
            sawBlockedReplacement = true;
          }
          if (
            replacement?.status === AGENT_ORG_TASK_STATUS.IN_PROGRESS &&
            handoff?.state !== "released"
          ) {
            throw new Error(
              `replacement started before the release receipt: ${JSON.stringify({ handoff, replacement })}`
            );
          }
          return Boolean(
            handoff?.state === "released" &&
            replacement?.status === AGENT_ORG_TASK_STATUS.IN_PROGRESS &&
            replacement.owner === DEFAULT_AGENT_ORG_MEMBER_IDS.REVIEWER
          );
        },
        {
          timeout: 90_000,
          interval: 50,
          timeoutMsg: "replacement did not start after release",
        }
      );
    } catch (error) {
      throw new Error(
        `replacement did not start after release: ${JSON.stringify(latest)}`,
        { cause: error }
      );
    }
    if (!sawBlockedReplacement) {
      throw new Error(
        "rendered reassignment never exposed the blocked Pending replacement"
      );
    }
    if (!replacementTaskId) {
      throw new Error(
        "rendered reassignment did not create a replacement Task"
      );
    }
    if (processGroupExists(oldShell.pid)) {
      throw new Error(
        `handoff released while the old process group still exists: ${JSON.stringify(oldShell)}`
      );
    }
    const replacementShell = await waitForOwnedShell(runningView.context.runId);
    if (replacementShell.handle === oldShell.handle) {
      throw new Error("replacement reused the old shell registration");
    }

    const replacementRow = await browser.$(
      `[data-testid="agent-org-overview-task-row"][data-task-id="${replacementTaskId}"]`
    );
    await replacementRow
      .$('[data-testid="agent-org-task-cancel-button"]')
      .click();
    await browser
      .$('[data-testid="agent-org-task-handoff-confirm-button"]')
      .click();

    await waitForAgentOrgRunView(
      sessionId,
      (view) => {
        const cancellation = (view?.executionHandoffs ?? []).find(
          (receipt) =>
            receipt.oldTaskId === replacementTaskId &&
            receipt.replacementTaskId == null
        );
        return Boolean(
          cancellation?.state === "released" &&
          view?.taskOverview?.cancelled === 2 &&
          view?.taskOverview?.inProgress === 0 &&
          view?.taskOverview?.pending === 0 &&
          view?.completion?.outcome !== "delivered"
        );
      },
      "replacement cancellation releases the exact old execution without false Delivered"
    );
    if (
      processGroupExists(replacementShell.pid) ||
      (await readProcessEvidence(runningView.context.runId)).length !== 0
    ) {
      throw new Error(
        "rendered cancellation left a registered process or live process group"
      );
    }
  });
});
