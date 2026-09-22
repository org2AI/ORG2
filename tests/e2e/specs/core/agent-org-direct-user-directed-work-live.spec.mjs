/* global after, before, browser, describe, it, process */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AGENT_ORG_TASK_STATUS,
  E2E_REPO_PATH,
  RENDER_TIMEOUT_MS,
  REPLY_TIMEOUT_MS,
  RUN_ID,
  assertE2ERepoFixture,
  execJS,
  getApiAccount,
  invokeE2E,
  js,
  selectPreferredModel,
  unwrap,
  waitForApp,
} from "../../support/core/agentOrgUiDriver.mjs";
import { switchAccountThroughRenderedPicker } from "../../support/core/session/accountSwitchDriver.mjs";

const E2E_BASE_URL = `http://127.0.0.1:${process.env.E2E_IDE_SERVER_PORT ?? "13847"}`;
const LIVE_PROVIDER_TIMEOUT_MS = Number.parseInt(
  process.env.E2E_AGENT_ORG_LIVE_PROVIDER_TIMEOUT_MS ?? "300000",
  10
);

async function postFixture(pathname, body, timeoutMs = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${E2E_BASE_URL}${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const json = await response.json();
    if (!response.ok || json?.ok !== true) {
      throw new Error(`${pathname} failed: ${JSON.stringify(json)}`);
    }
    return json;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForDisplayed(selector, label) {
  let visibleElement = null;
  await browser.waitUntil(
    async () => {
      const candidates = await browser.$$(selector);
      visibleElement = null;
      for (const candidate of candidates) {
        const size = await candidate.getSize();
        if (size.width > 0 && size.height > 0) {
          visibleElement = candidate;
        }
      }
      return Boolean(visibleElement);
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      interval: 200,
      timeoutMsg: `${label} did not become visible (${selector})`,
    }
  );
  return visibleElement;
}

async function clickVisible(selector, label) {
  const element = await waitForDisplayed(selector, label);
  // WebDriver's native click scrolls the target into view. Calling
  // scrollIntoView first leaves a longer window for push-driven React renders
  // to replace Agent Org controls and stale the native element reference.
  await element.click();
  return element;
}

async function openRenderedMember(memberId, memberName) {
  const groupMemberSelector = `//section[@data-testid="agent-org-group-projection"]//button[normalize-space()=${JSON.stringify(memberName)}]`;
  if ((await browser.$$(groupMemberSelector)).length > 0) {
    await clickVisible(
      groupMemberSelector,
      `${memberName} Group projection button`
    );
    return;
  }
  await clickVisible(
    '[data-testid="agent-org-member-switcher-trigger"]',
    "Member switcher"
  );
  await clickVisible(
    `[data-testid="agent-org-member-switcher-option-${memberId}"]`,
    "canonical Member option"
  );
}

async function sendVisiblePrompt(prompt) {
  const editor = await waitForDisplayed(
    '[data-testid="chat-input"] [contenteditable="true"]',
    "Member composer"
  );
  await editor.click();
  const typed = await execJS(
    js.type('[data-testid="chat-input"] [contenteditable="true"]', prompt)
  );
  if (typed !== "typed") {
    throw new Error(`Member composer did not accept prompt: ${typed}`);
  }
  await browser.waitUntil(
    async () =>
      String(
        (await execJS(
          js.editorText('[data-testid="chat-input"] [contenteditable="true"]')
        )) ?? ""
      ).includes(prompt),
    {
      timeout: RENDER_TIMEOUT_MS,
      interval: 100,
      timeoutMsg: "Member composer did not retain native WebDriver key input",
    }
  );
  const send = await waitForDisplayed(
    '[data-testid="chat-send-button"][data-state="submit"]',
    "Member Send button"
  );
  await browser.waitUntil(async () => send.isEnabled(), {
    timeout: RENDER_TIMEOUT_MS,
    interval: 100,
    timeoutMsg: "Member Send button remained disabled after real typing",
  });
  await send.click();
}

async function runView(sessionId, label) {
  return unwrap(
    await invokeE2E("agentOrgSessionRunView", sessionId),
    `agentOrgSessionRunView(${label})`
  ).view;
}

async function readExactFile(filePath, expectedContent) {
  try {
    return (await readFile(filePath, "utf8")).trim() === expectedContent;
  } catch {
    return false;
  }
}

async function sessionRow(sessionId, label) {
  return unwrap(
    await invokeE2E("getSessionAggregateRow", sessionId),
    `getSessionAggregateRow(${label})`
  ).session;
}

async function runtimeModelSnapshot(sessionId) {
  const result = await invokeE2E("debugSessionModelSnapshot", sessionId);
  return result?.ok === true ? result.snapshot : null;
}

describe("Agent Org direct UserDirectedWork with a live provider", () => {
  before(async () => {
    if (
      !new Set(["live", "api-key", "oauth-live"]).has(
        process.env.E2E_PROVIDER_MODE ?? ""
      )
    ) {
      throw new Error(
        "This spec requires E2E_PROVIDER_MODE=api-key or oauth-live (legacy live is also accepted); a fake or missing provider is blocked evidence, not a pass."
      );
    }
    assertE2ERepoFixture();
    await waitForApp();
    await postFixture("/agent/test/agent-org/run/cleanup", {});
  });

  after(async () => {
    await postFixture("/agent/test/agent-org/run/cleanup", {});
  });

  it("keeps model, direct work, retry ownership, and formal continuation on the rendered Member", async () => {
    const account = await getApiAccount();
    const memberModel = selectPreferredModel(account);
    const rootModel = (account.enabled_models ?? []).find(
      (candidate) => candidate !== memberModel
    );
    if (!rootModel) {
      throw new Error(
        `This live ownership scenario requires two enabled models on ${account.name ?? account.id}; selected Member model=${memberModel}, enabled=${JSON.stringify(account.enabled_models ?? [])}`
      );
    }
    const orgId = "e2e-agent-org-fixture:direct-member-live";
    const orgName = `E2E Direct Live ${RUN_ID}`;
    const memberId = `direct-member-${RUN_ID}`;
    const markerName = `member-direct-${RUN_ID}.txt`;
    const shellMarkerName = `member-shell-${RUN_ID}.txt`;
    const markerPath = path.join(E2E_REPO_PATH, markerName);
    const shellMarkerPath = path.join(E2E_REPO_PATH, shellMarkerName);
    const exactContent = `MEMBER_DIRECT_PROVIDER_${RUN_ID}`;
    let formalTaskId = null;
    const formalTaskRequestId = `formal-task-${RUN_ID}`;
    const formalTaskSubject = `Formal Member Work ${RUN_ID}`;
    const formalStartName = `formal-start-${RUN_ID}.txt`;
    const formalReleaseName = `formal-release-${RUN_ID}.txt`;
    const formalCompleteName = `formal-complete-${RUN_ID}.txt`;
    const formalStartPath = path.join(E2E_REPO_PATH, formalStartName);
    const formalReleasePath = path.join(E2E_REPO_PATH, formalReleaseName);
    const formalCompletePath = path.join(E2E_REPO_PATH, formalCompleteName);
    const formalStarted = `FORMAL_STARTED_${RUN_ID}`;
    const formalReleased = `FORMAL_RELEASE_${RUN_ID}`;
    const formalCompleted = `FORMAL_COMPLETED_${RUN_ID}`;
    const independentMarkerName = `member-independent-${RUN_ID}.txt`;
    const independentMarkerPath = path.join(
      E2E_REPO_PATH,
      independentMarkerName
    );
    const independentContent = `MEMBER_INDEPENDENT_${RUN_ID}`;
    const formalDescription = [
      `This is the original formal Task ${formalTaskRequestId}. If UserDirectedWork interrupts it, obey the direct user message while that intervention is active; only resume this exact formal assignment after the user chooses Return.`,
      `First use a shell command in the workspace to write exactly ${formalStarted} to ${formalStartName}.`,
      `Then keep this Task interruptible by running one foreground shell loop for up to 90 seconds that waits for ${formalReleaseName} to exist. Do not create the release file yourself.`,
      `After the release file exists, read this original assignment again, write exactly ${formalCompleted} to ${formalCompleteName}, and verify both files.`,
      `Finally complete this exact Task through task_update and reply with exactly FORMAL_DONE_${RUN_ID}.`,
    ].join(" ");
    const coordinatorPrompt = [
      `Create exactly one build Task by calling task_create with id ${formalTaskRequestId}, subject ${JSON.stringify(formalTaskSubject)}, description ${JSON.stringify(formalDescription)}, owner_member_id ${memberId}, dispatch_policy immediate, execution_mode build, and allow_parallel_with_unlisted_open_tasks true.`,
      `Do not perform the Task yourself and do not create any other Task. Reply with exactly COORDINATOR_DISPATCHED_${RUN_ID} only after task_create succeeds.`,
    ].join(" ");

    await postFixture("/agent/test/agent-org/seed", {
      id: orgId,
      name: orgName,
      coordinator_agent_id: "builtin:sde",
      members: [
        {
          id: memberId,
          name: "Direct Live Member",
          role: "Implement the user's direct workspace request",
          agent_id: "builtin:sde",
        },
      ],
      additional_task_graph_writer_member_ids: [memberId],
    });
    const launched = await postFixture(
      "/agent/test/agent-org/launch-coordinator",
      {
        agent_org_id: orgId,
        workspace_path: E2E_REPO_PATH,
        content: "",
        model: rootModel,
        account_id: account.id,
        sync_turn: false,
        name: orgName,
      },
      60_000
    );
    const rootSessionId = launched.session_id;
    if (!rootSessionId) {
      throw new Error(
        `fixture launch returned no Root Session: ${JSON.stringify(launched)}`
      );
    }

    let memberSessionId = null;
    await browser.waitUntil(
      async () => {
        const view = await runView(rootSessionId, "materialization");
        memberSessionId = view?.members?.find(
          (member) => member.memberId === memberId
        )?.sessionRuntime?.sessionId;
        return Boolean(memberSessionId);
      },
      {
        timeout: REPLY_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: "canonical Member Session did not materialize",
      }
    );

    // Session launch runs through the debug backend fixture and can make this
    // new Root Session current before the sidebar navigation catches up. A
    // second click on an already-selected row opens its context menu, so use
    // the standard E2E navigation bridge only for test setup; Direct work,
    // Member selection, Send, and Return remain native rendered actions.
    unwrap(await invokeE2E("openSession", rootSessionId), "open Root Session");
    await browser.waitUntil(
      async () =>
        unwrap(
          await invokeE2E("getActiveSessionId"),
          "getActiveSessionId(Root before Member switch)"
        ).sessionId === rootSessionId,
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 200,
        timeoutMsg: "Root Session click did not finish navigation",
      }
    );
    await openRenderedMember(memberId, "Direct Live Member");
    await browser.waitUntil(
      async () =>
        unwrap(
          await invokeE2E("getActiveSessionId"),
          "getActiveSessionId(Member direct)"
        ).sessionId === memberSessionId,
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 200,
        timeoutMsg: "Member switch did not open the canonical Member Session",
      }
    );

    const directBar = await waitForDisplayed(
      '[data-testid="agent-org-member-direct-work-bar"]',
      "Member direct-work notice"
    );
    if ((await directBar.getAttribute("data-member-id")) !== memberId) {
      throw new Error("direct-work notice belongs to the wrong Member");
    }

    const initialRootRow = await sessionRow(rootSessionId, "Root initial");
    const initialMemberRow = await sessionRow(
      memberSessionId,
      "Member initial"
    );
    if (
      initialRootRow?.model !== rootModel ||
      initialMemberRow?.model !== rootModel
    ) {
      throw new Error(
        `Root and Member did not start on the launch model: ${JSON.stringify({ root: initialRootRow, member: initialMemberRow, rootModel })}`
      );
    }
    const allowedMemberModels = await switchAccountThroughRenderedPicker(
      account,
      memberModel,
      "Agent Org direct Member model ownership"
    );
    const switchedRootRow = await sessionRow(
      rootSessionId,
      "Root after switch"
    );
    const switchedUiState = unwrap(
      await invokeE2E("inspectChatState"),
      "inspectChatState(Member model switch)"
    );
    if (
      switchedRootRow?.model !== rootModel ||
      switchedRootRow?.accountId !== account.id ||
      switchedUiState.activeSession?.id !== memberSessionId ||
      switchedUiState.activeSession?.accountId !== account.id ||
      !allowedMemberModels.includes(switchedUiState.activeSession?.model)
    ) {
      throw new Error(
        `rendered model switch did not stay Member-owned: ${JSON.stringify({ root: switchedRootRow, activeSession: switchedUiState.activeSession, rootModel, allowedMemberModels })}`
      );
    }
    let persistedSwitchedMember = null;
    await browser.waitUntil(
      async () => {
        persistedSwitchedMember = await sessionRow(
          memberSessionId,
          "Member model persisted before formal work"
        );
        return (
          persistedSwitchedMember?.accountId === account.id &&
          allowedMemberModels.includes(persistedSwitchedMember?.model)
        );
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 250,
        timeoutMsg: `idle Member model switch did not persist: ${JSON.stringify({ member: persistedSwitchedMember, allowedMemberModels })}`,
      }
    );

    unwrap(
      await invokeE2E("openSession", rootSessionId),
      "open Root before formal Task dispatch"
    );
    await browser.waitUntil(
      async () =>
        unwrap(
          await invokeE2E("getActiveSessionId"),
          "getActiveSessionId(Root formal dispatch)"
        ).sessionId === rootSessionId,
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 200,
        timeoutMsg: "Root Session did not become active for formal dispatch",
      }
    );
    await sendVisiblePrompt(coordinatorPrompt);
    await browser.waitUntil(
      async () => await readExactFile(formalStartPath, formalStarted),
      {
        timeout: LIVE_PROVIDER_TIMEOUT_MS,
        interval: 1_000,
        timeoutMsg:
          "live Provider did not start the original formal Member Task",
      }
    );
    const runningFormalView = await runView(
      memberSessionId,
      "formal Task started"
    );
    const runningFormalTask = runningFormalView?.tasks?.find(
      (task) => task.subject === formalTaskSubject
    );
    if (
      runningFormalTask?.status !== AGENT_ORG_TASK_STATUS.IN_PROGRESS ||
      runningFormalTask?.owner !== memberId
    ) {
      throw new Error(
        `formal Task was not active on the Member before intervention: ${JSON.stringify(runningFormalTask)}`
      );
    }
    formalTaskId = runningFormalTask.id;
    await openRenderedMember(memberId, "Direct Live Member");
    await browser.waitUntil(
      async () =>
        unwrap(
          await invokeE2E("getActiveSessionId"),
          "getActiveSessionId(Member formal work)"
        ).sessionId === memberSessionId,
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 200,
        timeoutMsg:
          "Member switch did not reopen the running formal Member Session",
      }
    );

    const prompt = [
      `This is direct UserDirectedWork and the formal Task is intentionally paused. Do not inspect or wait for ${formalReleaseName}, do not work on the formal Task, and do not message the Coordinator during this turn.`,
      `Use one shell command without command substitution to write exactly ${exactContent} to ${markerName}, verify it with cmp, write exactly SHELL_OK_${RUN_ID} to ${shellMarkerName}, and read both files back.`,
      `Then reply with exactly DIRECT_DONE_${RUN_ID} and do nothing else.`,
    ].join(" ");
    await sendVisiblePrompt(prompt);

    let acceptedReceipt = null;
    let acceptedSourceEventId = null;
    await browser.waitUntil(
      async () => {
        const view = await runView(memberSessionId, "direct accepted");
        const member = view?.members?.find(
          (candidate) => candidate.memberId === memberId
        );
        acceptedReceipt = member?.intervention?.interventionReceiptId ?? null;
        acceptedSourceEventId = member?.intervention?.sourceEventId ?? null;
        return (
          Boolean(acceptedReceipt) &&
          Boolean(acceptedSourceEventId) &&
          member?.activity?.source === "direct_member" &&
          member?.queuedUserDirectedCount === 1
        );
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 200,
        timeoutMsg:
          "direct source did not become one durable receipt/queued Turn",
      }
    );

    let renderedReply = "";
    await browser.waitUntil(
      async () => {
        const assistantRows = await browser.$$(
          '[data-testid="chat-message-assistant"], [data-testid="agent-org-group-projection-item"][data-item-kind="assistant_reply"]'
        );
        const texts = [];
        for (const row of assistantRows) texts.push(await row.getText());
        renderedReply = texts.join("\n");
        return renderedReply.includes(`DIRECT_DONE_${RUN_ID}`);
      },
      {
        timeout: LIVE_PROVIDER_TIMEOUT_MS,
        interval: 1_000,
        timeoutMsg: `live Provider reply did not render: ${renderedReply}`,
      }
    );
    if ((await readFile(markerPath, "utf8")).trim() !== exactContent) {
      throw new Error(
        "live Provider file write did not match the exact marker"
      );
    }
    if (
      (await readFile(shellMarkerPath, "utf8")).trim() !== `SHELL_OK_${RUN_ID}`
    ) {
      throw new Error(
        "live Provider shell verification did not create its marker"
      );
    }

    // A rendered final text delta can appear just before the native Turn
    // terminal commits. Wait for the user-facing Return boundary instead of
    // racing EventStore reconciliation: enabled means the direct Turn is
    // terminal, while the still-present receipt proves completion did not
    // auto-return the Member to formal work.
    const returnButton = await waitForDisplayed(
      '[data-testid="agent-org-return-to-work-button"]',
      "Return to formal work button"
    );
    await browser.waitUntil(async () => returnButton.isEnabled(), {
      timeout: RENDER_TIMEOUT_MS,
      interval: 200,
      timeoutMsg:
        "Return to formal work remained disabled after direct work became terminal",
    });
    const awaitingConfirmation = await runView(
      memberSessionId,
      "direct terminal awaiting confirmation"
    );
    const awaitingMember = awaitingConfirmation?.members?.find(
      (candidate) => candidate.memberId === memberId
    );
    if (
      awaitingMember?.intervention?.interventionReceiptId !== acceptedReceipt ||
      awaitingMember?.activity?.source !== "direct_member"
    ) {
      throw new Error(
        `direct completion auto-cleared before user confirmation: ${JSON.stringify(awaitingMember)}`
      );
    }

    const chatEvidence = unwrap(
      await invokeE2E("inspectChatState"),
      "inspectChatState(direct source/reply evidence)"
    );
    const directSources = (chatEvidence.rawEvents ?? []).filter(
      (event) =>
        event.id === acceptedSourceEventId &&
        event.functionName === "user_message" &&
        event.result?.agentOrgDirectSource === true
    );
    const directTurnUserEvents = (chatEvidence.rawEvents ?? []).filter(
      (event) =>
        event.functionName === "user_message" &&
        event.result?.turnIntentId === directSources[0]?.result?.turnIntentId
    );
    const exactReplies = (chatEvidence.rawEvents ?? []).filter(
      (event) => event.result?.reply_to_event_id === acceptedSourceEventId
    );
    if (
      directSources.length !== 1 ||
      directTurnUserEvents.length !== 1 ||
      exactReplies.length < 1
    ) {
      throw new Error(
        `EventStore source/reply identity was not exact: ${JSON.stringify({ acceptedSourceEventId, directSources, directTurnUserEvents, exactReplies })}`
      );
    }

    const evidence = await postFixture(
      "/agent/test/agent-org/user-directed/evidence",
      { org_run_id: launched.agent_org_run_id }
    );
    const matchingAdmissions = (evidence.runtime_admissions ?? []).filter(
      (admission) =>
        admission.session_id === memberSessionId &&
        admission.turn_intent_id === directSources[0]?.result?.turnIntentId &&
        admission.member_id === memberId
    );
    if (
      matchingAdmissions.length !== 1 ||
      matchingAdmissions[0].status !== "committed" ||
      !matchingAdmissions[0].reservation_id ||
      !matchingAdmissions[0].runtime_lease_id
    ) {
      throw new Error(
        `direct Turn did not retain one committed runtime admission: ${JSON.stringify(matchingAdmissions)}`
      );
    }
    let directRuntimeSnapshot = null;
    let persistedDirectMember = null;
    await browser.waitUntil(
      async () => {
        directRuntimeSnapshot = await runtimeModelSnapshot(memberSessionId);
        persistedDirectMember = await sessionRow(
          memberSessionId,
          "Member direct runtime"
        );
        return (
          directRuntimeSnapshot?.activeAccountId === account.id &&
          allowedMemberModels.includes(directRuntimeSnapshot?.activeModel) &&
          persistedDirectMember?.accountId === account.id &&
          allowedMemberModels.includes(persistedDirectMember?.model)
        );
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 500,
        timeoutMsg: `Member runtime did not execute direct work with the selected model: ${JSON.stringify({ snapshot: directRuntimeSnapshot, persisted: persistedDirectMember, allowedMemberModels })}`,
      }
    );
    const interruptedView = await runView(
      memberSessionId,
      "formal Task held during direct work"
    );
    const interruptedFormalTask = interruptedView?.tasks?.find(
      (task) => task.id === formalTaskId
    );
    if (
      interruptedFormalTask?.status !== AGENT_ORG_TASK_STATUS.IN_PROGRESS ||
      interruptedFormalTask?.owner !== memberId
    ) {
      throw new Error(
        `UserDirectedWork incorrectly changed the formal Task lifecycle: ${JSON.stringify(interruptedFormalTask)}`
      );
    }

    await returnButton.click();
    let returnedView = null;
    let returnedMember = null;
    await browser.waitUntil(
      async () => {
        returnedView = await runView(memberSessionId, "Return acknowledged");
        returnedMember = returnedView?.members?.find(
          (candidate) => candidate.memberId === memberId
        );
        return returnedMember != null && returnedMember.intervention == null;
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 200,
        timeoutMsg: `Return did not clear receipt ${acceptedReceipt}: ${JSON.stringify(returnedMember)}`,
      }
    );
    await writeFile(formalReleasePath, `${formalReleased}\n`, "utf8");

    let durableTasks = null;
    await browser.waitUntil(
      async () => {
        durableTasks = (
          await postFixture("/agent/test/agent-org/tasks/list", {
            org_run_id: launched.agent_org_run_id,
          })
        ).tasks;
        const task = durableTasks?.find(
          (candidate) => candidate.id === formalTaskId
        );
        return (
          task?.status === AGENT_ORG_TASK_STATUS.COMPLETED &&
          task?.owner === memberId &&
          (await readExactFile(formalCompletePath, formalCompleted))
        );
      },
      {
        timeout: LIVE_PROVIDER_TIMEOUT_MS,
        interval: 1_000,
        timeoutMsg: `the unique continuation did not complete the original formal Task: ${JSON.stringify(durableTasks)}`,
      }
    );
    const matchingFormalTasks = (durableTasks ?? []).filter(
      (task) => task.id === formalTaskId
    );
    if (matchingFormalTasks.length !== 1) {
      throw new Error(
        `Return created duplicate formal Task state: ${JSON.stringify(matchingFormalTasks)}`
      );
    }

    unwrap(
      await invokeE2E("openSession", memberSessionId),
      "open Member as outer Session"
    );
    await browser.waitUntil(
      async () =>
        unwrap(
          await invokeE2E("getActiveSessionId"),
          "getActiveSessionId(independent Member)"
        ).sessionId === memberSessionId,
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 200,
        timeoutMsg: "Member did not open as the independent outer Session",
      }
    );
    const independentPrompt = [
      `This is a second direct user task on the independently opened Member Session.`,
      `Use one shell command without command substitution to write exactly ${independentContent} to ${independentMarkerName} and read it back. Then reply with exactly INDEPENDENT_DONE_${RUN_ID} and do nothing else.`,
    ].join(" ");
    await sendVisiblePrompt(independentPrompt);

    let independentReceipt = null;
    await browser.waitUntil(
      async () => {
        const view = await runView(
          memberSessionId,
          "independent direct accepted"
        );
        const member = view?.members?.find(
          (candidate) => candidate.memberId === memberId
        );
        independentReceipt =
          member?.intervention?.interventionReceiptId ?? null;
        return (
          Boolean(independentReceipt) &&
          independentReceipt !== acceptedReceipt &&
          member?.activity?.source === "direct_member"
        );
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 200,
        timeoutMsg:
          "independently opened Member did not create a new direct intervention",
      }
    );
    await browser.waitUntil(
      async () => {
        const assistantRows = await browser.$$(
          '[data-testid="chat-message-assistant"], [data-testid="agent-org-group-projection-item"][data-item-kind="assistant_reply"]'
        );
        for (const row of assistantRows) {
          if ((await row.getText()).includes(`INDEPENDENT_DONE_${RUN_ID}`)) {
            return true;
          }
        }
        return false;
      },
      {
        timeout: LIVE_PROVIDER_TIMEOUT_MS,
        interval: 1_000,
        timeoutMsg: "independent Member live Provider reply did not render",
      }
    );
    if (!(await readExactFile(independentMarkerPath, independentContent))) {
      throw new Error(
        "independently opened Member did not complete the real file/shell task"
      );
    }

    const finalRootRow = await sessionRow(rootSessionId, "Root final");
    const finalMemberRow = await sessionRow(memberSessionId, "Member final");
    if (
      finalRootRow?.model !== rootModel ||
      !allowedMemberModels.includes(finalMemberRow?.model)
    ) {
      throw new Error(
        `Member model ownership leaked into Root after both direct tasks: ${JSON.stringify({ root: finalRootRow, member: finalMemberRow, rootModel, allowedMemberModels })}`
      );
    }
  });
});
