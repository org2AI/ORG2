/* global describe, before, afterEach, it, browser */
import {
  captureTerminalFailure,
  runFormalTerminalScenario,
} from "../../support/core/agentOrgTerminalDriver.mjs";
import {
  AGENT_ORG_COORDINATOR_MEMBER_ID,
  REPLY_TIMEOUT_MS,
  RUN_ID,
  assertE2ERepoFixture,
  assertNoMemberIntervention,
  configureCreatorForDefaultAgentOrg,
  execJS,
  getApiAccount,
  invokeE2E,
  openRenderedGroupChatView,
  openRenderedSidebarSession,
  selectPreferredModel,
  selectRenderedDefaultAgentOrg,
  selectRenderedExecMode,
  sendFromRenderedCreator,
  sendRenderedChatPrompt,
  unwrap,
  waitForAgentOrgRunView,
  waitForApp,
  waitForCoordinatorRuntimeStatus,
  waitForRenderedAssistantReply,
  waitForRenderedGroupChatActive,
  waitForRenderedGroupChatMessage,
  waitForRenderedGroupChatUserTurn,
} from "../../support/core/agentOrgUiDriver.mjs";

async function coordinatorUserInboxIds(runId, label) {
  const result = unwrap(
    await invokeE2E("debugAgentOrgInboxList", runId),
    `debugAgentOrgInboxList(${label})`
  );
  return new Set(
    (result.rows ?? [])
      .filter(
        (row) =>
          row.senderAgentId === "_user" &&
          row.recipientMemberId === AGENT_ORG_COORDINATOR_MEMBER_ID
      )
      .map((row) => row.id)
  );
}

async function openExactExecutionDetails(
  marker,
  { requireDistantTarget = false } = {}
) {
  const targetLookup = await execJS(`
    const row = Array.from(document.querySelectorAll('[data-testid="agent-org-group-projection-item"]'))
      .find(row => row.getAttribute('data-item-kind') === 'assistant_reply' && (row.textContent || '').includes(${JSON.stringify(marker)}));
    const button = row?.querySelector('[data-testid="agent-org-execution-details"]');
    if (!button || button.disabled) return null;
    const intent = row.getAttribute('data-turn-intent-id');
    const mountedBeforeClick = Array.from(document.querySelectorAll('[data-testid="agent-org-execution-header"]'))
      .some(header => header.getAttribute('data-turn-intent-id') === intent);
    button.click();
    return { intent, mountedBeforeClick };
  `);
  if (!targetLookup?.intent)
    throw new Error(`No verified execution details action for ${marker}`);
  if (requireDistantTarget && targetLookup.mountedBeforeClick) {
    throw new Error(
      `Distant execution ${targetLookup.intent} was already mounted before navigation`
    );
  }
  const target = targetLookup.intent;
  let visibleSince = null;
  await browser.waitUntil(
    async () => {
      const visible = await execJS(`
    return !document.querySelector('[data-testid="agent-org-group-projection"]') &&
      Array.from(document.querySelectorAll('[data-testid="agent-org-execution-header"]'))
        .some(header => {
          if (header.getAttribute('data-turn-intent-id') !== ${JSON.stringify(target)}) return false;
          const rect = header.getBoundingClientRect();
          let top = 0, bottom = window.innerHeight;
          for (let parent = header.parentElement; parent; parent = parent.parentElement) {
            if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(parent).overflowY)) {
              const clip = parent.getBoundingClientRect();
              top = Math.max(top, clip.top);
              bottom = Math.min(bottom, clip.bottom);
            }
          }
          const scroller = header.closest('[data-testid="chat-history-scroll-container"]');
          if (${requireDistantTarget} && (!scroller ||
              rect.top - scroller.getBoundingClientRect().top + scroller.scrollTop <= scroller.clientHeight)) return false;
          return rect.height > 0 && rect.bottom > top && rect.top < bottom;
        });
  `);
      if (!visible) {
        visibleSince = null;
        return false;
      }
      visibleSince ??= Date.now();
      // A one-frame intersection must not hide a later anchor restoration.
      return Date.now() - visibleSince >= 500;
    },
    {
      timeout: REPLY_TIMEOUT_MS,
      interval: 100,
      timeoutMsg: `Exact private execution ${target} did not enter the viewport`,
    }
  );
  const history = unwrap(
    await invokeE2E("inspectChatState"),
    "private execution history"
  );
  const anchors = history.chatEvents.filter(
    (event) =>
      event.actionType === "agent_org_execution" ||
      event.actionType === "turn_placeholder"
  );
  for (let index = 1; index < anchors.length; index++) {
    const earlier = anchors[index - 1];
    const later = anchors[index];
    if (
      earlier.createdAt > later.createdAt ||
      (earlier.createdAt === later.createdAt &&
        (earlier.args.historySequence ?? Number.MAX_SAFE_INTEGER) >
          (later.args.historySequence ?? Number.MAX_SAFE_INTEGER))
    ) {
      throw new Error(
        `Private execution history moved backwards: ${earlier.id} then ${later.id}`
      );
    }
  }
  if (requireDistantTarget) {
    const collapsedRounds = await execJS(`
      return Array.from(document.querySelectorAll('[data-testid="turn-collapse-toggle"][aria-expanded="false"]')).length;
    `);
    if (collapsedRounds < 1) {
      throw new Error("Dense private history did not exercise a collapsed round");
    }
    await (await browser.$('[aria-label^="Go to turn 1 of "]')).click();
    let oldestVisibleSince = null;
    await browser.waitUntil(
      async () => {
        const visible = await execJS(`
          const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
          const oldest = scroller?.querySelector('[data-chat-group-index="0"]');
          if (!scroller || !oldest) return false;
          const root = scroller.getBoundingClientRect();
          const target = oldest.getBoundingClientRect();
          return target.height > 0 && target.top >= root.top - 2 && target.top < root.bottom;
        `);
        if (!visible) oldestVisibleSince = null;
        else oldestVisibleSince ??= Date.now();
        return (
          oldestVisibleSince !== null && Date.now() - oldestVisibleSince >= 500
        );
      },
      {
        timeout: REPLY_TIMEOUT_MS,
        interval: 100,
        timeoutMsg:
          "Oldest private turn did not remain visible after minimap navigation",
      }
    );
  }
  await openRenderedGroupChatView();
  await waitForRenderedGroupChatActive("return from exact execution details");
}

describe("Agent Org Root Group follow-up rendered UI", () => {
  before(async () => {
    assertE2ERepoFixture();
    await waitForApp();
  });

  afterEach(async function () {
    if (this.currentTest?.state === "failed")
      await captureTerminalFailure(this.currentTest.title);
  });

  it("accepts Idle follow-ups and keeps busy follow-ups as distinct FIFO turns", async () => {
    const account = await getApiAccount();
    const model = selectPreferredModel(account);
    await configureCreatorForDefaultAgentOrg({ account, model });
    await selectRenderedExecMode("build");
    await selectRenderedDefaultAgentOrg();

    const launchPrompt = `E2E Root Group follow-up launch ${RUN_ID}. Reply briefly and do not create tasks.`;
    const sessionId = await sendFromRenderedCreator(launchPrompt);
    if (!sessionId) {
      throw new Error("Root Group follow-up launch did not create a session");
    }
    await waitForRenderedAssistantReply("Root Group follow-up launch");

    let runId = null;
    let coordinatorName = "Coordinator";
    await waitForAgentOrgRunView(
      sessionId,
      (view) => {
        const coordinator = (view?.members ?? []).find(
          (member) => member.memberId === AGENT_ORG_COORDINATOR_MEMBER_ID
        );
        runId = view?.context?.runId ?? null;
        coordinatorName = coordinator?.name ?? coordinatorName;
        return Boolean(runId && view?.runStatus === "idle");
      },
      "pure launch answer leaves Team Idle",
      REPLY_TIMEOUT_MS
    );
    if (!runId) throw new Error("Root Group follow-up run id was unavailable");

    await openRenderedGroupChatView();
    await waitForRenderedGroupChatActive("Idle Root follow-up");
    const inboxIdsBefore = await coordinatorUserInboxIds(
      runId,
      "before Idle Root follow-up"
    );

    const idleMessage = `E2E Idle Root follow-up ${RUN_ID}`;
    await sendRenderedChatPrompt(idleMessage);
    await waitForRenderedGroupChatUserTurn({
      text: idleMessage,
      label: "Idle Root follow-up user Turn",
    });
    await waitForRenderedGroupChatMessage({
      sender: coordinatorName,
      text: idleMessage,
      label: "Idle Root follow-up Coordinator reply",
      timeout: REPLY_TIMEOUT_MS,
    });
    await waitForAgentOrgRunView(
      sessionId,
      (view) => view?.runStatus === "idle",
      "pure Root follow-up keeps Team Idle",
      REPLY_TIMEOUT_MS
    );

    const inboxIdsAfterIdle = await coordinatorUserInboxIds(
      runId,
      "after Idle Root follow-up"
    );
    if (
      [...inboxIdsAfterIdle].some((inboxId) => !inboxIdsBefore.has(inboxId))
    ) {
      throw new Error(
        "Idle Root follow-up incorrectly entered the legacy Coordinator Inbox"
      );
    }

    // The actual Group reply locates its precise older/private round through
    // the production metadata RPC, member switch and paged chat navigation.
    await openExactExecutionDetails("Root Group follow-up launch");
    await openExactExecutionDetails(idleMessage);

    const activeMessage = `E2E Root FIFO active ${RUN_ID}. Create a stoppable window by waiting for about 4 seconds.`;
    const queuedMessage = `E2E Root FIFO queued next Turn ${RUN_ID}`;
    await sendRenderedChatPrompt(activeMessage);
    await waitForCoordinatorRuntimeStatus(
      sessionId,
      (status) => status === "running",
      "Coordinator active before FIFO follow-up"
    );
    await sendRenderedChatPrompt(queuedMessage);

    let queuedState = null;
    await browser.waitUntil(
      async () => {
        // Group-root FIFO is persisted as Turn intents, separate from the
        // ordinary chat's in-memory message queue. Assert its rendered state.
        queuedState = await execJS(`
          const items = Array.from(document.querySelectorAll('[data-testid="agent-org-group-projection-item"]'));
          const active = items.find((item) => item.textContent.includes(${JSON.stringify(activeMessage)}));
          const queued = items.find((item) => item.textContent.includes(${JSON.stringify(queuedMessage)}));
          return {
            activeId: active?.getAttribute('data-turn-intent-id'),
            activeState: active?.getAttribute('data-state'),
            queuedId: queued?.getAttribute('data-turn-intent-id'),
            queuedState: queued?.getAttribute('data-state'),
          };
        `);
        return Boolean(
          queuedState.activeId &&
          queuedState.queuedId &&
          queuedState.activeId !== queuedState.queuedId &&
          queuedState.activeState === "running" &&
          queuedState.queuedState === "queued"
        );
      },
      {
        timeout: 5_000,
        interval: 100,
        timeoutMsg: `busy Root follow-up was not visible in FIFO: ${JSON.stringify(queuedState)}`,
      }
    );

    await waitForRenderedGroupChatUserTurn({
      text: queuedMessage,
      label: "queued Root follow-up materialized as its own user Turn",
    });
    await waitForRenderedGroupChatMessage({
      sender: coordinatorName,
      text: queuedMessage,
      label: "queued Root follow-up received its own Coordinator reply",
      timeout: REPLY_TIMEOUT_MS,
    });
    await waitForRenderedGroupChatUserTurn({
      text: activeMessage,
      label: "active Root message retained in the shared Group projection",
    });
    await waitForRenderedGroupChatMessage({
      sender: coordinatorName,
      text: activeMessage,
      label: "active Root reply retained in the shared Group projection",
      timeout: REPLY_TIMEOUT_MS,
    });
    await waitForRenderedGroupChatUserTurn({
      text: queuedMessage,
      label: "queued Root message remains a separate projection item",
    });
    await waitForAgentOrgRunView(
      sessionId,
      (view) => view?.runStatus === "idle",
      "FIFO follow-ups finish without opening work",
      REPLY_TIMEOUT_MS
    );
    await assertNoMemberIntervention(
      sessionId,
      "Root Group FIFO must not create Member intervention"
    );

    const inboxIdsAfterFifo = await coordinatorUserInboxIds(
      runId,
      "after Root FIFO follow-ups"
    );
    if (
      [...inboxIdsAfterFifo].some((inboxId) => !inboxIdsBefore.has(inboxId))
    ) {
      throw new Error(
        "Root FIFO follow-up incorrectly entered the legacy Coordinator Inbox"
      );
    }
    // Produce at least 57 real executions through the rendered composer so the
    // target is outside the mounted virtual window. Alternate long and short
    // content while older rounds retain their real collapsed state.
    let distantMessage = "";
    for (let index = 0; index < 57; index++) {
      const suffix =
        index % 3 === 0
          ? ` ${"mixed long history content ".repeat(3).trimEnd()}`
          : " short";
      distantMessage = `E2E Idle Root follow-up ${RUN_ID} history ${index}${suffix}`;
      await sendRenderedChatPrompt(distantMessage);
      await waitForRenderedGroupChatMessage({
        sender: coordinatorName,
        text: distantMessage,
        label: `dense execution history reply ${index}`,
        timeout: REPLY_TIMEOUT_MS,
      });
      await waitForAgentOrgRunView(
        sessionId,
        (view) => view?.runStatus === "idle",
        `dense execution history idle ${index}`,
        REPLY_TIMEOUT_MS
      );
    }
    await openExactExecutionDetails(distantMessage, {
      requireDistantTarget: true,
    });
    // Reopening starts from the bounded durable history window (one loaded
    // round). Restart the driver with the app: WKWebView reload can poison
    // tauri-webdriver-automation 0.1.3's pending-script mutex. Native refresh
    // is covered separately through Computer Use without that script bridge.
    await browser.reloadSession();
    await waitForApp();
    await openRenderedSidebarSession(sessionId);
    await openRenderedGroupChatView();
    await waitForRenderedGroupChatActive("durable execution navigation");
    await openExactExecutionDetails("Root Group follow-up launch");
    await openExactExecutionDetails(idleMessage);
    await openExactExecutionDetails(queuedMessage);
    await openExactExecutionDetails(distantMessage, {
      requireDistantTarget: true,
    });
  });
  for (const kind of ["stream", "tool", "failure", "panic"]) {
    it(`preserves exact formal execution finality through the rendered ${kind} path`, async () => {
      await runFormalTerminalScenario(kind);
    });
  }
});
