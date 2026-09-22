/**
 * chat-rendering-ui.spec.mjs
 *
 * Rendered UI compatibility ledger for Rust tool-call metadata.
 * Pulls the same `list_all_tools` rows used by the app, seeds transcript
 * events through the real EventStore path, and verifies every selected
 * tool sentinel appears in ChatHistory. Tools are checked in small batches so
 * virtualization does not hide off-screen rows from the assertion.
 */
import { appendFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { e2eUrl } from "../../support/core/e2eBaseUrl.mjs";

const MOUNT_TIMEOUT_MS = 60_000;
const RENDER_TIMEOUT_MS = 12_000;
// externalHistoryAutoRefresh polls at the default 5s cadence and requires a
// changed transcript signature to survive one extra settle cycle before it
// trusts it (MIN_TRANSCRIPT_SETTLE_MS / shouldWaitForStableTranscript in
// src/engines/SessionCore/sync/externalHistoryAutoRefresh.ts), so a
// replace-driven refetch can take ~2 polling cycles plus parse/merge time.
const EXTERNAL_HISTORY_REFRESH_TIMEOUT_MS = 45_000;
const RUN_ID = Date.now();
const BATCH_SIZE = 6;
const E2E_REPO_PATH =
  process.env.E2E_REPO_PATH ?? "/tmp/orgii-e2e-workspace-repo";
const SCENARIO_FILTER = (process.env.E2E_CHAT_RENDERING_SCENARIOS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const EXPAND_KIND_FILTER = (process.env.E2E_EXPAND_KINDS ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

function shouldRunScenario(name, aliases = []) {
  return (
    SCENARIO_FILTER.length === 0 ||
    [name, ...aliases].some((candidate) => SCENARIO_FILTER.includes(candidate))
  );
}

const SKIP_CHAT_TOOLS = new Set([
  "agent",
  "create_plan",
  "manage_todo",
  "ask_user_questions",
  "suggest_mode_switch",
  "ask_user_permissions",
  "thinking",
  "agent_message",
  "user_message",
  "subagent",
  "mcp_tool",
  "tool_call",
]);

async function execJS(script) {
  return browser.executeScript(script, []);
}

async function exposeVisibleViewportLifecycleToDriver() {
  const visibility = await execJS(`
    // macOS leaves the temporary WebDriver app behind the invoking app. The
    // production controller correctly suspends work for a hidden document;
    // these rendered interaction cases need the active-document lifecycle.
    if (document.visibilityState === 'hidden') {
      // A background WebView also throttles requestAnimationFrame even after
      // its visibility contract is exposed. Drive the controller's normal
      // coalesced callback through a zero-delay task for this test process.
      window.requestAnimationFrame = (callback) =>
        window.setTimeout(() => callback(performance.now()), 0);
      window.cancelAnimationFrame = (id) => window.clearTimeout(id);
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => 'visible',
      });
      document.dispatchEvent(new Event('visibilitychange'));
    }
    return document.visibilityState;
  `);
  if (visibility !== "visible") {
    throw new Error(`viewport test document stayed ${visibility}`);
  }
}

async function waitForFrontendReady() {
  const port = process.env.E2E_FRONTEND_PORT ?? "1998";
  const url = `http://127.0.0.1:${port}`;
  await browser.waitUntil(
    async () => {
      try {
        const response = await fetch(url, { method: "GET" });
        return response.ok;
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: `frontend dev server never became ready at ${url}`,
    }
  );
}

async function postJson(pathname, body) {
  const response = await fetch(e2eUrl(pathname), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `POST ${pathname} returned non-JSON ${response.status}: ${text}`
    );
  }
  if (!response.ok) {
    throw new Error(`POST ${pathname} failed ${response.status}: ${text}`);
  }
  return payload;
}

async function invokeE2E(method, ...args) {
  return browser.executeAsyncScript(
    `
    const cb = arguments[arguments.length - 1];
    const method = arguments[0];
    const rest = Array.prototype.slice.call(arguments, 1, arguments.length - 1);
    if (!window.__e2e || typeof window.__e2e[method] !== "function") {
      cb({ ok: false, error: "window.__e2e." + method + " not available" });
      return;
    }
    Promise.resolve(window.__e2e[method].apply(null, rest))
      .then(cb)
      .catch((e) => cb({ ok: false, error: String(e && e.message || e) }));
  `,
    [method, ...args]
  );
}

function makeUserEvent(sessionId, batchIndex) {
  return {
    id: `user-tool-ledger-${batchIndex}`,
    chunk_id: `user-tool-ledger-${batchIndex}`,
    sessionId,
    createdAt: new Date().toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "raw",
    args: {},
    result: {
      type: "user",
      message: `Render tool ledger batch ${batchIndex}`,
      is_delta: false,
    },
    source: "user",
    displayText: `Render tool ledger batch ${batchIndex}`,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
}

function makeToolEvent(sessionId, batchIndex, toolIndex, tool) {
  const sentinel = `TOOL_LEDGER_${batchIndex}_${toolIndex}_${tool.name}`;
  const actionName =
    tool.name === "agent"
      ? "delegate"
      : Array.isArray(tool.actions) && tool.actions.length > 0
        ? tool.actions[0].name
        : "run";
  const args = {
    action: actionName,
    command: `printf '${sentinel}'`,
    query: sentinel,
    path: `/tmp/${tool.name}.txt`,
    content: sentinel,
    url: "https://example.com",
    description: `Delegate ${sentinel}`,
    subagent_type: "explore",
    subagentSessionId: `${sessionId}-child-${toolIndex}`,
    prompt: sentinel,
  };
  const result = {
    success: true,
    status: "completed",
    is_delta: false,
    observation: sentinel,
    output: sentinel,
    stdout: sentinel,
    content: sentinel,
  };

  if (tool.chatBlock === "diff" || tool.name === "apply_patch") {
    args.patch_text = [
      "*** Begin Patch",
      `*** Add File: src/${tool.name}-${batchIndex}-${toolIndex}.ts`,
      `+export const marker = \"${sentinel}\";`,
      "*** End Patch",
    ].join("\n");
    result.content = `Applied patch ${sentinel}`;
    result.observation = result.content;
  }

  if (tool.chatBlock === "sent_message") {
    args.recipient_name = `Recipient ${toolIndex}`;
    args.kind = "plain";
    args.summary = sentinel;
    args.text = sentinel;
  }

  if (tool.name === "read_file") {
    result.content = `export const marker = "${sentinel}";`;
    result.observation = result.content;
  }

  return {
    id: `tool-ledger-${batchIndex}-${toolIndex}-${tool.name}`,
    chunk_id: `tool-ledger-${batchIndex}-${toolIndex}-${tool.name}`,
    sessionId,
    createdAt: new Date(Date.now() + toolIndex).toISOString(),
    functionName: tool.name,
    uiCanonical: tool.name,
    actionType: "tool_call",
    args,
    result,
    source: "assistant",
    displayText: sentinel,
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
    isDelta: false,
  };
}

function makeAssistantEvent(sessionId, batchIndex) {
  const content = `Tool render ledger batch ${batchIndex} complete.`;
  return {
    id: `assistant-tool-ledger-${batchIndex}`,
    chunk_id: `assistant-tool-ledger-${batchIndex}`,
    sessionId,
    createdAt: new Date(Date.now() + 10_000).toISOString(),
    functionName: "assistant_message",
    uiCanonical: "agent_message",
    actionType: "assistant",
    args: {},
    result: {
      content,
      observation: content,
      is_delta: false,
      role: "assistant",
    },
    source: "assistant",
    displayText: content,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    isDelta: false,
  };
}

function renderableToolsFromMetadata(tools) {
  return tools
    .filter(
      (tool) =>
        typeof tool.name === "string" &&
        !tool.hidden &&
        !SKIP_CHAT_TOOLS.has(tool.name)
    )
    .filter(
      (tool) =>
        tool.chatBlock &&
        tool.chatBlock !== "diff" &&
        tool.chatBlock !== "title_only" &&
        tool.appSubtool !== "file_write" &&
        tool.appSubtool !== "todo" &&
        tool.appSubtool !== "other_interactions"
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

function chunk(items, size) {
  const batches = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}

async function waitForApp() {
  await waitForFrontendReady();
  await browser.setTimeout({ script: 5_000 });
  await execJS(`localStorage.setItem('orgii:auth_skipped', '1'); return true;`);
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(
          `return document.readyState === 'complete' || document.readyState === 'interactive';`
        );
      } catch {
        return false;
      }
    },
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: "app document never became script-readable",
    }
  );
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(
          `return !!document.querySelector('[data-testid="chat-panel"]');`
        );
      } catch {
        return false;
      }
    },
    { timeout: MOUNT_TIMEOUT_MS, timeoutMsg: "chat-panel never mounted" }
  );
  await browser.waitUntil(
    async () => {
      try {
        return await execJS(
          `return !!(window.__e2e && window.__e2e.seedChatEvents && window.__e2e.listAllTools);`
        );
      } catch {
        return false;
      }
    },
    { timeout: 20_000, timeoutMsg: "window.__e2e tool helpers never exposed" }
  );
}

async function renderedToolState(expectedEntries, assistantText) {
  return execJS(`
    const expectedEntries = ${JSON.stringify(expectedEntries)};
    const assistantText = ${JSON.stringify(assistantText)};
    const body = document.body.innerText || '';
    const history = document.querySelector('[data-testid="chat-message-list"]');
    const renderedToolNames = Array.from(document.querySelectorAll('[data-tool-call-name]'))
      .map((node) => node.getAttribute('data-tool-call-name'))
      .filter(Boolean);
    const missing = expectedEntries.filter((entry) => {
      if (body.includes(entry.sentinel)) return false;
      if (entry.fallbackTexts && entry.fallbackTexts.some((text) => body.includes(text))) return false;
      return !renderedToolNames.includes(entry.name);
    });
    return {
      missing: missing.map((entry) => entry.sentinel),
      renderedToolNames,
      visibleCount: expectedEntries.length - missing.length,
      bodyLength: body.length,
      historyText: history ? history.innerText || '' : '',
      chatHistoryCount: history ? history.getAttribute('data-chat-history-count') : null,
      optimizedCount: history ? history.getAttribute('data-optimized-count') : null,
      flatCount: history ? history.getAttribute('data-flat-count') : null,
      groupCounts: history ? history.getAttribute('data-group-counts') : null,
      assistant: body.includes(assistantText),
    };
  `);
}

async function assertBatchRendered(batchIndex, tools) {
  const sessionId = `e2e-render-tools-${RUN_ID}-${batchIndex}`;
  const baseTime = Date.now();
  const userEvent = {
    ...makeUserEvent(sessionId, batchIndex),
    createdAt: new Date(baseTime).toISOString(),
  };
  const toolEvents = tools.map((tool, toolIndex) => ({
    ...makeToolEvent(sessionId, batchIndex, toolIndex, tool),
    createdAt: new Date(baseTime + 1_000 + toolIndex).toISOString(),
  }));
  const assistantEvent = {
    ...makeAssistantEvent(sessionId, batchIndex),
    createdAt: new Date(baseTime + 10_000).toISOString(),
  };
  const expectedEntries = toolEvents.map((event) => ({
    name: event.functionName,
    sentinel: event.displayText,
    fallbackTexts:
      event.functionName === "read_file"
        ? ["Read 1 file", "1 file", event.args?.path].filter(Boolean)
        : event.functionName === "query_lsp"
          ? ["1 LSP query", "LSP query"]
          : event.functionName === "render_inline_canvas"
            ? ["Agent Preview"]
            : undefined,
  }));
  const assistantText = `Tool render ledger batch ${batchIndex} complete.`;
  const seed = await invokeE2E("seedChatEvents", sessionId, [
    userEvent,
    ...toolEvents,
    assistantEvent,
  ]);
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for batch ${batchIndex}: ${seed?.error ?? "unknown"}`
    );
  }

  try {
    await browser.waitUntil(
      async () => {
        const state = await renderedToolState(expectedEntries, assistantText);
        return state.missing.length === 0 && state.assistant;
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        timeoutMsg: `metadata-ledger batch ${batchIndex} did not render all expected sentinels`,
      }
    );
  } catch (error) {
    const state = await renderedToolState(expectedEntries, assistantText);
    const metadata = tools.map((tool) => ({
      name: tool.name,
      chatBlock: tool.chatBlock,
      appSubtool: tool.appSubtool,
    }));
    throw new Error(`${error.message}: ${JSON.stringify({ state, metadata })}`);
  }

  const finalState = await renderedToolState(expectedEntries, assistantText);
  expect(finalState.missing).toEqual([]);
  expect(finalState.assistant).toBe(true);
}

const DEDUP_SESSION_ID = `e2e-render-dedup-${Date.now()}`;
const DEDUP_THOUGHT_TEXT = "Can we chat?";
const DEDUP_ANSWER_TEXT =
  "可以。我能用中文和你聊天，也能帮你写代码、查资料、解释技术问题，或一起梳理需求。\n\n你想聊什么？";
const ORDER_SESSION_ID = `e2e-render-thinking-order-${Date.now()}`;
const ORDER_TEXTS = {
  userA: "ORDER_USER_A_chat_first",
  thinkA: "ORDER_THINK_A_before_answer",
  answerA: "ORDER_ANSWER_A_after_thinking",
  userB: "ORDER_USER_B_second_turn",
  thinkB: "ORDER_THINK_B_before_second_answer",
  answerB: "ORDER_ANSWER_B_after_second_thinking",
};

const OPENCODE_RELOAD_SESSION_ID = `opencodeapp-e2e-reload-${Date.now()}`;
const OPENCODE_RELOAD_USER_PROMPT =
  "启动一个（subagent），让它帮我分析当前项目里有多少个 .rs 文件，并生成一份报告。必须要用subagent，然后要让我看到过程";
const OPENCODE_RELOAD_ASSIGNMENT_PROMPT =
  "在当前工作目录下分析 Rust 源文件数量：统计所有 **/*.rs 文件，排除 target/ 目录；生成一份报告，包含总文件数、按目录分布、最大文件 Top 5，并在过程中持续汇报进展。";
const OPENCODE_RELOAD_FINAL_REPORT =
  "Now I have all the data. Here is the comprehensive report.";
const OPENCODE_RELOAD_ASSISTANT_ANSWER =
  "Subagent 已完成分析：当前项目共有 260 个 .rs 文件，并已生成报告。";

function withCreatedAt(event, timestampMs) {
  return {
    ...event,
    createdAt: new Date(timestampMs).toISOString(),
  };
}

function makeDedupEvent(id, functionName, actionType, displayVariant, content) {
  return {
    id,
    chunk_id: id,
    sessionId: DEDUP_SESSION_ID,
    createdAt: new Date().toISOString(),
    functionName,
    uiCanonical: functionName,
    actionType,
    args: {},
    result: {
      content,
      observation: content,
      is_delta: false,
      role: functionName === "assistant_message" ? "assistant" : undefined,
    },
    source: "assistant",
    displayText: content,
    displayStatus: "completed",
    displayVariant,
    activityStatus: "agent",
    isDelta: false,
  };
}

function makeDedupUserEvent() {
  return {
    id: "user-1",
    chunk_id: "user-1",
    sessionId: DEDUP_SESSION_ID,
    createdAt: new Date().toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "user",
    args: {},
    result: { content: "能聊天吗", observation: "能聊天吗", is_delta: false },
    source: "user",
    displayText: "能聊天吗",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
}

function makeOrderUserEvent(id, content) {
  return {
    id,
    chunk_id: id,
    sessionId: ORDER_SESSION_ID,
    createdAt: new Date().toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "user",
    args: {},
    result: { content, observation: content, is_delta: false },
    source: "user",
    displayText: content,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
}

function makeOpenCodeReloadUserEvent(id, content) {
  return {
    id,
    chunk_id: id,
    sessionId: OPENCODE_RELOAD_SESSION_ID,
    createdAt: new Date().toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "user",
    args: {},
    result: { content, observation: content, is_delta: false },
    source: "user",
    displayText: content,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
}

function makeOpenCodeReloadSubagentEvent() {
  return {
    id: "opencode-reload-subagent",
    chunk_id: "opencode-reload-subagent",
    sessionId: OPENCODE_RELOAD_SESSION_ID,
    createdAt: new Date().toISOString(),
    functionName: "subagent",
    uiCanonical: "subagent",
    actionType: "tool_call",
    args: {
      action: "delegate",
      description: OPENCODE_RELOAD_ASSIGNMENT_PROMPT,
      prompt: OPENCODE_RELOAD_ASSIGNMENT_PROMPT,
      subagentSessionId: `${OPENCODE_RELOAD_SESSION_ID}-child`,
    },
    result: {
      content: OPENCODE_RELOAD_FINAL_REPORT,
      summary: "Subagent 已完成分析，结果如下",
      success: true,
      is_delta: false,
    },
    source: "assistant",
    displayText: "Assigned task to subagent",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
    isDelta: false,
  };
}

function makeOpenCodeReloadAssistantEvent() {
  return {
    id: "opencode-reload-assistant-answer",
    chunk_id: "opencode-reload-assistant-answer",
    sessionId: OPENCODE_RELOAD_SESSION_ID,
    createdAt: new Date().toISOString(),
    functionName: "assistant_message",
    uiCanonical: "agent_message",
    actionType: "assistant",
    args: {},
    result: {
      content: OPENCODE_RELOAD_ASSISTANT_ANSWER,
      observation: OPENCODE_RELOAD_ASSISTANT_ANSWER,
      is_delta: false,
      role: "assistant",
    },
    source: "assistant",
    displayText: OPENCODE_RELOAD_ASSISTANT_ANSWER,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "agent",
    isDelta: false,
  };
}

function makeOrderAssistantEvent(id, displayVariant, content) {
  const isThinking = displayVariant === "thinking";
  return {
    id,
    chunk_id: id,
    sessionId: ORDER_SESSION_ID,
    createdAt: new Date().toISOString(),
    functionName: isThinking ? "thinking" : "assistant_message",
    uiCanonical: isThinking ? "thinking" : "assistant_message",
    actionType: isThinking ? "llm_thinking" : "assistant",
    args: {},
    result: {
      content,
      observation: content,
      is_delta: false,
      role: isThinking ? undefined : "assistant",
    },
    source: "assistant",
    displayText: content,
    displayStatus: "completed",
    displayVariant,
    activityStatus: "agent",
    isDelta: false,
  };
}

async function renderedDedupCounts() {
  const chatState = await invokeE2E("inspectChatState");
  const domState = await execJS(`
    const body = document.body.innerText || "";
    const thoughtMatches = body.match(new RegExp(${JSON.stringify(DEDUP_THOUGHT_TEXT)}, "g")) || [];
    const answerMatches = body.match(new RegExp(${JSON.stringify("可以。我能用中文和你聊天")}, "g")) || [];
    const history = document.querySelector('[data-testid="chat-message-list"]');
    return {
      thought: thoughtMatches.length,
      answer: answerMatches.length,
      assistantBubbles: document.querySelectorAll('[data-testid="chat-message-assistant"]').length,
      body: body.slice(0, 2000),
      chatHistoryDebug: history ? {
        chatHistoryCount: history.getAttribute('data-chat-history-count'),
        optimizedCount: history.getAttribute('data-optimized-count'),
        flatCount: history.getAttribute('data-flat-count'),
        groupCounts: history.getAttribute('data-group-counts'),
        text: (history.innerText || '').slice(0, 500),
      } : null,
      location: window.location.pathname,
    };
  `);
  return { ...domState, chatState };
}

async function assertDedupRenderedOnce() {
  const baseTime = Date.now();
  const seed = await invokeE2E("seedChatEvents", DEDUP_SESSION_ID, [
    withCreatedAt(makeDedupUserEvent(), baseTime),
    withCreatedAt(
      makeDedupEvent(
        "think-1",
        "thinking",
        "llm_thinking",
        "thinking",
        DEDUP_THOUGHT_TEXT
      ),
      baseTime + 1_000
    ),
    withCreatedAt(
      makeDedupEvent(
        "msg-1",
        "assistant_message",
        "assistant",
        "message",
        DEDUP_ANSWER_TEXT
      ),
      baseTime + 2_000
    ),
    withCreatedAt(
      makeDedupEvent(
        "think-2",
        "thinking",
        "llm_thinking",
        "thinking",
        DEDUP_THOUGHT_TEXT
      ),
      baseTime + 3_000
    ),
    withCreatedAt(
      makeDedupEvent(
        "msg-2",
        "assistant_message",
        "assistant",
        "message",
        DEDUP_ANSWER_TEXT
      ),
      baseTime + 4_000
    ),
  ]);
  if (!seed || seed.ok !== true) {
    throw new Error(`seedChatEvents failed: ${seed?.error ?? "unknown"}`);
  }

  try {
    await browser.waitUntil(
      async () => {
        const counts = await renderedDedupCounts();
        return counts.thought === 1 && counts.answer === 1;
      },
      {
        timeout: 10_000,
        timeoutMsg:
          "duplicate thought/answer pair was not collapsed in rendered chat",
      }
    );
  } catch (error) {
    throw new Error(
      `${error.message}: ${JSON.stringify(await renderedDedupCounts())}`
    );
  }

  const finalCounts = await execJS(`
    const body = document.body.innerText || "";
    return {
      thought: (body.match(new RegExp(${JSON.stringify(DEDUP_THOUGHT_TEXT)}, "g")) || []).length,
      answer: (body.match(new RegExp(${JSON.stringify("可以。我能用中文和你聊天")}, "g")) || []).length,
      assistantBubbles: document.querySelectorAll('[data-testid="chat-message-assistant"]').length,
    };
  `);
  expect(finalCounts).toEqual({ thought: 1, answer: 1, assistantBubbles: 1 });
}

async function assertMultiRepoGrepTargetsExplicitRepoPath() {
  const root = await mkdtemp(
    path.join(tmpdir(), `orgii-e2e-multirepo-grep-${RUN_ID}-`)
  );
  const primaryRepo = path.join(root, "primary");
  const siblingRepo = path.join(root, "sibling");
  const primarySentinel = `ORGII_MULTI_REPO_GREP_PRIMARY_${RUN_ID}`;
  const siblingSentinel = `ORGII_MULTI_REPO_GREP_SIBLING_${RUN_ID}`;

  try {
    await mkdir(path.join(primaryRepo, "src"), { recursive: true });
    await mkdir(path.join(siblingRepo, "src"), { recursive: true });
    await writeFile(
      path.join(primaryRepo, "src", "sentinel.ts"),
      `export const primary = ${JSON.stringify(primarySentinel)};\n`
    );
    await writeFile(
      path.join(siblingRepo, "src", "sentinel.ts"),
      `export const sibling = ${JSON.stringify(siblingSentinel)};\n`
    );

    const result = await postJson("/agent/test/tool/code-search", {
      default_repo: primaryRepo,
      params: {
        action: "grep",
        pattern: siblingSentinel,
        repo_path: siblingRepo,
        max_results: 20,
      },
    });

    if (!result?.ok) {
      throw new Error(
        `multi-repo grep endpoint failed: ${result?.error ?? "unknown"}`
      );
    }

    const output = String(result.output ?? "");
    if (!output.includes(siblingSentinel)) {
      throw new Error(`multi-repo grep missed sibling sentinel: ${output}`);
    }
    if (output.includes(primarySentinel)) {
      throw new Error(
        `multi-repo grep leaked primary sentinel while targeting sibling: ${output}`
      );
    }
    if (!output.includes(siblingRepo)) {
      throw new Error(
        `multi-repo grep output did not identify sibling repo/path: ${output}`
      );
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function assertMultiRepoSearchTargetRendered() {
  const sessionId = `e2e-render-multirepo-search-target-${Date.now()}`;
  const baseTime = Date.now();
  const repoA = `/tmp/orgii-e2e-search-target-a-${RUN_ID}/app`;
  const repoB = `/tmp/orgii-e2e-search-target-b-${RUN_ID}/app`;
  const expectedRepoB = `in orgii-e2e-search-target-b-${RUN_ID}/app`;
  const events = [
    {
      ...withCreatedAt(
        makeOrderUserEvent("multi-search-target-user", "Search sibling repo"),
        baseTime
      ),
      sessionId,
    },
    {
      id: "multi-search-target-tool",
      chunk_id: "multi-search-target-tool",
      sessionId,
      createdAt: new Date(baseTime + 1_000).toISOString(),
      functionName: "code_search",
      uiCanonical: "code_search",
      actionType: "tool_call",
      args: {
        action: "grep",
        pattern: "sharedSymbol",
        repo_path: repoB,
        path: `${repoA}/src/index.ts`,
      },
      result: {
        content: `${repoB}/src/index.ts:1:sharedSymbol`,
        observation: "matched",
        is_delta: false,
      },
      repoPath: repoA,
      source: "assistant",
      displayText: "Search sharedSymbol",
      displayStatus: "completed",
      displayVariant: "tool_call",
      activityStatus: "agent",
      isDelta: false,
    },
    {
      ...withCreatedAt(
        makeOrderAssistantEvent(
          "multi-search-target-assistant",
          "message",
          "Search complete"
        ),
        baseTime + 2_000
      ),
      sessionId,
    },
  ];

  const seed = await invokeE2E("seedChatEvents", sessionId, events);
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for multi-repo search target: ${seed?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const history = document.querySelector('[data-testid="chat-message-list"]');
        const body = history ? (history.innerText || "") : (document.body.innerText || "");
        return {
          body,
          hasPattern: body.includes("sharedSymbol"),
          hasTarget: body.includes(${JSON.stringify(expectedRepoB)}),
          hasWrongTarget: body.includes(${JSON.stringify(`in orgii-e2e-search-target-a-${RUN_ID}/app`)}),
          leakedAbsoluteRepo: body.includes(${JSON.stringify(repoB)}),
        };
      `);
      return (
        state.hasPattern &&
        state.hasTarget &&
        !state.hasWrongTarget &&
        !state.leakedAbsoluteRepo
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `multi-repo search target did not render explicit repo_path compactly: ${JSON.stringify(
        await execJS(
          `return { body: (document.body.innerText || "").slice(0, 5000) };`
        )
      )}`,
    }
  );
}

async function assertMultiRepoRenderedPathContext() {
  const sessionId = `e2e-render-multirepo-context-${Date.now()}`;
  const baseTime = Date.now();
  const repoA = `/tmp/orgii-e2e-collision-a-${RUN_ID}/app`;
  const repoB = `/tmp/orgii-e2e-collision-b-${RUN_ID}/app`;
  const fileA = `${repoA}/src/index.ts`;
  const fileB = `${repoB}/src/index.ts`;
  const expectedA = `orgii-e2e-collision-a-${RUN_ID}/app/src/index.ts`;
  const expectedB = `orgii-e2e-collision-b-${RUN_ID}/app/src/index.ts`;
  const events = [
    {
      ...withCreatedAt(
        makeOrderUserEvent("multi-context-user", "Use both app repos"),
        baseTime
      ),
      sessionId,
    },
    {
      id: "multi-context-read-a",
      chunk_id: "multi-context-read-a",
      sessionId,
      createdAt: new Date(baseTime + 1_000).toISOString(),
      functionName: "read_file",
      uiCanonical: "read_file",
      actionType: "tool_call",
      args: { file_path: fileA },
      result: { content: "read A", observation: "read A", is_delta: false },
      repoPath: repoA,
      source: "assistant",
      displayText: `Read ${fileA}`,
      displayStatus: "completed",
      displayVariant: "tool_call",
      activityStatus: "agent",
      isDelta: false,
    },
    {
      id: "multi-context-edit-b",
      chunk_id: "multi-context-edit-b",
      sessionId,
      createdAt: new Date(baseTime + 2_000).toISOString(),
      functionName: "edit_file_by_replace",
      uiCanonical: "edit_file",
      actionType: "tool_call",
      args: { path: fileB, old_string: "old", new_string: "new" },
      result: {
        content: "@@ -1 +1\n-old\n+new",
        observation: "edited",
        is_delta: false,
      },
      repoPath: repoB,
      source: "assistant",
      displayText: `Edit ${fileB}`,
      displayStatus: "completed",
      displayVariant: "tool_call",
      activityStatus: "agent",
      isDelta: false,
    },
    {
      id: "multi-context-search-b",
      chunk_id: "multi-context-search-b",
      sessionId,
      createdAt: new Date(baseTime + 3_000).toISOString(),
      functionName: "code_search",
      uiCanonical: "code_search",
      actionType: "tool_call",
      args: { action: "grep", pattern: "sharedSymbol", repo_path: repoB },
      result: {
        content: `${fileB}:1:sharedSymbol`,
        observation: "matched",
        is_delta: false,
      },
      repoPath: repoB,
      source: "assistant",
      displayText: "Search sharedSymbol",
      displayStatus: "completed",
      displayVariant: "tool_call",
      activityStatus: "agent",
      isDelta: false,
    },
    {
      id: "multi-context-shell-a",
      chunk_id: "multi-context-shell-a",
      sessionId,
      createdAt: new Date(baseTime + 4_000).toISOString(),
      functionName: "run_shell",
      uiCanonical: "run_shell",
      actionType: "tool_call",
      args: { command: "npm test", cwd: repoA },
      result: {
        output: "ok",
        content: "ok",
        observation: "ok",
        is_delta: false,
      },
      repoPath: repoA,
      source: "assistant",
      displayText: "Run npm test",
      displayStatus: "completed",
      displayVariant: "tool_call",
      activityStatus: "agent",
      isDelta: false,
    },
    {
      ...withCreatedAt(
        makeOrderAssistantEvent("multi-context-assistant", "message", "Done"),
        baseTime + 5_000
      ),
      sessionId,
    },
  ];

  const seed = await invokeE2E("seedChatEvents", sessionId, events);
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for multi-repo context: ${seed?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const body = document.body.innerText || "";
        return {
          body,
          hasA: body.includes(${JSON.stringify(expectedA)}),
          hasB: body.includes(${JSON.stringify(expectedB)}),
          leakedAmbiguous: body.includes(" app/src/index.ts") && !body.includes(${JSON.stringify(expectedA)}),
        };
      `);
      return state.hasA && state.hasB && !state.leakedAmbiguous;
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `multi-repo rendered path context missing: ${JSON.stringify(
        await execJS(
          `return { body: (document.body.innerText || "").slice(0, 5000) };`
        )
      )}`,
    }
  );
}

async function assertBackgroundProcessPinnedToChatSession() {
  const sessionId = `e2e-render-bg-process-chat-${Date.now()}`;
  const command = `sleep 120 # E2E_BG_PROCESS_PIN_${RUN_ID}`;
  const baseTime = Date.now();
  const events = [
    {
      id: "bg-process-user",
      chunk_id: "bg-process-user",
      sessionId,
      createdAt: new Date(baseTime).toISOString(),
      functionName: "user_message",
      uiCanonical: "user_message",
      actionType: "raw",
      args: {},
      result: {
        type: "user",
        message: "Start a background process",
        is_delta: false,
      },
      source: "user",
      displayText: "Start a background process",
      displayStatus: "completed",
      displayVariant: "message",
      activityStatus: "processed",
      isDelta: false,
    },
  ];

  const seed = await invokeE2E("seedChatEvents", sessionId, events, {
    chatPanelMaximized: true,
    stationMode: "my-station",
  });
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for bg process pin: ${seed?.error ?? "unknown"}`
    );
  }

  const processSeed = await invokeE2E("seedShellProcess", {
    sessionId,
    pid: 90321,
    command,
    status: "background",
  });
  if (!processSeed || processSeed.ok !== true) {
    throw new Error(
      `seedShellProcess failed: ${processSeed?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const body = document.body.innerText || "";
        const pills = Array.from(document.querySelectorAll('[data-testid="composer-section-process"]'))
          .map((el) => el.textContent || "");
        return {
          body,
          pills,
          hasProcessPill: pills.some((text) => text.includes("1")),
        };
      `);
      return state.hasProcessPill;
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `background process pill did not render: ${JSON.stringify(
        await execJS(`
          return {
            body: (document.body.innerText || "").slice(0, 5000),
            pills: Array.from(document.querySelectorAll('[data-testid="composer-section-process"]')).map((el) => el.textContent || ""),
          };
        `)
      )}`,
    }
  );

  const sendState = await execJS(`
    const button = document.querySelector('[data-testid="chat-send-button"]');
    return button ? button.getAttribute("data-state") : null;
  `);
  if (sendState !== "submit") {
    throw new Error(
      `background process must not keep composer in stop state: ${sendState}`
    );
  }

  const clickResult = await execJS(`
    const pill = document.querySelector('[data-testid="composer-section-process"]');
    if (!pill) return "missing";
    pill.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
    pill.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
    pill.click();
    return "clicked";
  `);
  if (clickResult !== "clicked") {
    throw new Error(`failed to click process pill: ${clickResult}`);
  }

  await browser.waitUntil(
    async () => {
      const body = await execJS(`return document.body.innerText || "";`);
      return body.includes(command);
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `expanded background process command missing: ${JSON.stringify(
        await execJS(
          `return { body: (document.body.innerText || "").slice(0, 5000) };`
        )
      )}`,
    }
  );
}

async function assertBackgroundSubagentPinnedToChatSession() {
  const sessionId = `e2e-render-bg-subagent-chat-${Date.now()}`;
  const agentName = `E2E Worker ${RUN_ID}`;
  const handle = `agent-builtin:general-e2e-${RUN_ID}`;
  const baseTime = Date.now();
  const events = [
    {
      id: "bg-subagent-user",
      chunk_id: "bg-subagent-user",
      sessionId,
      createdAt: new Date(baseTime).toISOString(),
      functionName: "user_message",
      uiCanonical: "user_message",
      actionType: "raw",
      args: {},
      result: {
        type: "user",
        message: "Launch a background worker",
        is_delta: false,
      },
      source: "user",
      displayText: "Launch a background worker",
      displayStatus: "completed",
      displayVariant: "message",
      activityStatus: "processed",
      isDelta: false,
    },
  ];

  const seed = await invokeE2E("seedChatEvents", sessionId, events, {
    chatPanelMaximized: true,
    stationMode: "my-station",
  });
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for bg subagent pin: ${seed?.error ?? "unknown"}`
    );
  }

  const jobSeed = await invokeE2E("seedSubagentJob", {
    sessionId,
    handle,
    agentName,
    subagentType: "delegate",
    status: "running",
  });
  if (!jobSeed || jobSeed.ok !== true) {
    throw new Error(`seedSubagentJob failed: ${jobSeed?.error ?? "unknown"}`);
  }

  // Pill renders with count 1 (the subagent contributes to the same
  // process section as shell jobs).
  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const pills = Array.from(document.querySelectorAll('[data-testid="composer-section-process"]'))
          .map((el) => el.textContent || "");
        return { pills, hasProcessPill: pills.some((text) => text.includes("1")) };
      `);
      return state.hasProcessPill;
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `background subagent pill did not render: ${JSON.stringify(
        await execJS(`
          return {
            body: (document.body.innerText || "").slice(0, 5000),
            pills: Array.from(document.querySelectorAll('[data-testid="composer-section-process"]')).map((el) => el.textContent || ""),
          };
        `)
      )}`,
    }
  );

  // Expand and assert the worker row shows agent name + type label.
  const clickResult = await execJS(`
    const pill = document.querySelector('[data-testid="composer-section-process"]');
    if (!pill) return "missing";
    pill.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
    pill.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
    pill.click();
    return "clicked";
  `);
  if (clickResult !== "clicked") {
    throw new Error(`failed to click process pill: ${clickResult}`);
  }

  await browser.waitUntil(
    async () => {
      const body = await execJS(`return document.body.innerText || "";`);
      return body.includes(agentName) && body.includes("delegate");
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `expanded subagent row missing name/type: ${JSON.stringify(
        await execJS(
          `return { body: (document.body.innerText || "").slice(0, 5000) };`
        )
      )}`,
    }
  );

  // Terminal status removes the row: seed "completed" and assert the pin
  // bar empties (Rule-9 negative — no ghost rows for finished workers).
  const completeSeed = await invokeE2E("seedSubagentJob", {
    sessionId,
    handle,
    agentName,
    subagentType: "delegate",
    status: "completed",
  });
  if (!completeSeed || completeSeed.ok !== true) {
    throw new Error(
      `seedSubagentJob(completed) failed: ${completeSeed?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const body = document.body.innerText || "";
        const pills = Array.from(document.querySelectorAll('[data-testid="composer-section-process"]'));
        return { pillCount: pills.length, hasAgentRow: body.includes(${JSON.stringify(agentName)}) };
      `);
      return state.pillCount === 0 && !state.hasAgentRow;
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `completed subagent row did not disappear: ${JSON.stringify(
        await execJS(
          `return { body: (document.body.innerText || "").slice(0, 5000) };`
        )
      )}`,
    }
  );
}

/**
 * Full wire-path variant: unlike `assertBackgroundSubagentPinnedToChatSession`
 * (which writes the frontend atom directly), this drives the PRODUCTION
 * Rust path — `debug_seed_subagent_job` calls `registry::register_subagent`,
 * whose `agent:subagent_job_changed` broadcast must travel bus → IPC
 * channel → `handleSubagentJobChanged` → atom → pin bar. The only
 * substituted link is the LLM deciding to launch a worker. Kill goes
 * through the same Tauri command the Stop button invokes, and the
 * resulting "killed" broadcast must remove the row.
 */
function makeSubagentEvent({
  sessionId,
  eventId,
  subagentSessionId,
  agentName,
  prompt,
  displayStatus = "running",
  activityStatus = "agent",
  result = { success: false, status: "running", is_delta: false },
}) {
  return {
    id: eventId,
    chunk_id: eventId,
    sessionId,
    createdAt: new Date().toISOString(),
    functionName: "agent",
    uiCanonical: "agent",
    actionType: "tool_call",
    args: {
      action: "delegate",
      description: agentName,
      subagentSessionId,
      prompt,
    },
    result,
    source: "assistant",
    displayText: prompt,
    displayStatus,
    displayVariant: "tool_call",
    activityStatus,
    isDelta: false,
  };
}

function makeRunningSubagentEvent({
  sessionId,
  eventId,
  subagentSessionId,
  agentName,
  prompt,
}) {
  return makeSubagentEvent({
    sessionId,
    eventId,
    subagentSessionId,
    agentName,
    prompt,
  });
}

async function assertCompletedSubagentCardIsTerminal() {
  const sessionId = `sdeagent-e2e-subagent-card-terminal-${Date.now()}`;
  const agentName = `E2E Terminal Worker ${RUN_ID}`;
  const subagentSessionId = `agent-builtin:general-card-terminal-${RUN_ID}`;
  const prompt = `Terminal subagent should not keep Stop ${subagentSessionId}`;
  const userEvent = {
    id: "subagent-card-terminal-user",
    chunk_id: "subagent-card-terminal-user",
    sessionId,
    createdAt: new Date().toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "raw",
    args: {},
    result: {
      type: "user",
      message: "Launch a worker and let it finish",
      is_delta: false,
    },
    source: "user",
    displayText: "Launch a worker and let it finish",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
  const subagentEventId = "subagent-card-terminal-event";

  const seedRunning = await invokeE2E(
    "seedChatEvents",
    sessionId,
    [
      userEvent,
      makeRunningSubagentEvent({
        sessionId,
        eventId: subagentEventId,
        subagentSessionId,
        agentName,
        prompt,
      }),
    ],
    {
      chatPanelMaximized: true,
      runtimeStatus: "running",
      stationMode: "my-station",
    }
  );
  if (!seedRunning || seedRunning.ok !== true) {
    throw new Error(
      `seedChatEvents failed for running terminal fixture: ${seedRunning?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const body = document.body.innerText || "";
        const card = document.querySelector('[data-tool-call-event-id=${JSON.stringify(subagentEventId)}]');
        const stopButton = card?.querySelector('[data-testid="subagent-card-stop-button"]');
        return {
          hasPrompt: body.includes(${JSON.stringify(prompt)}),
          hasStopButton: Boolean(stopButton),
          stopDisabled: stopButton ? stopButton.disabled : null,
          cardText: card?.textContent || "",
        };
      `);
      return (
        state.hasPrompt && state.hasStopButton && state.stopDisabled === false
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `running subagent card did not expose Stop: ${JSON.stringify(
        await execJS(
          `return { body: (document.body.innerText || "").slice(0, 3000) };`
        )
      )}`,
    }
  );

  const seedCompleted = await invokeE2E(
    "seedChatEvents",
    sessionId,
    [
      userEvent,
      makeSubagentEvent({
        sessionId,
        eventId: subagentEventId,
        subagentSessionId,
        agentName,
        prompt,
        displayStatus: "completed",
        activityStatus: "processed",
        result: {
          success: true,
          status: "completed",
          summary: "Terminal worker completed",
          is_delta: false,
        },
      }),
    ],
    {
      chatPanelMaximized: true,
      runtimeStatus: "idle",
      stationMode: "my-station",
    }
  );
  if (!seedCompleted || seedCompleted.ok !== true) {
    throw new Error(
      `seedChatEvents failed for completed terminal fixture: ${seedCompleted?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const card = document.querySelector('[data-tool-call-event-id=${JSON.stringify(subagentEventId)}]');
        const stopButton = card?.querySelector('[data-testid="subagent-card-stop-button"]');
        const text = card?.textContent || "";
        return {
          hasCard: Boolean(card),
          hasStopButton: Boolean(stopButton),
          text,
          hasRunningText: text.toLowerCase().includes("running"),
          hasSpinClass: Boolean(card?.querySelector('.animate-spin')),
        };
      `);
      return (
        state.hasCard &&
        !state.hasStopButton &&
        !state.hasRunningText &&
        !state.hasSpinClass
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `completed subagent card still looked active: ${JSON.stringify(
        await execJS(`
          const card = document.querySelector('[data-tool-call-event-id=${JSON.stringify(subagentEventId)}]');
          return {
            body: (document.body.innerText || "").slice(0, 3000),
            cardText: card?.textContent || null,
            hasStopButton: Boolean(card?.querySelector('[data-testid="subagent-card-stop-button"]')),
            hasSpinClass: Boolean(card?.querySelector('.animate-spin')),
          };
        `)
      )}`,
    }
  );
}
async function assertSubagentCardStopUsesJobRegistryFallback() {
  const sessionId = `sdeagent-e2e-subagent-card-stop-${Date.now()}`;
  const agentName = `E2E Card Stop Worker ${RUN_ID}`;
  const subagentSessionId = `agent-builtin:general-card-stop-${RUN_ID}`;
  const prompt = `Card stop should cancel ${subagentSessionId}`;
  const userEvent = {
    id: "subagent-card-stop-user",
    chunk_id: "subagent-card-stop-user",
    sessionId,
    createdAt: new Date().toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "raw",
    args: {},
    result: {
      type: "user",
      message: "Launch a worker, then stop it from the card",
      is_delta: false,
    },
    source: "user",
    displayText: "Launch a worker, then stop it from the card",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
  const subagentEventId = "subagent-card-stop-running";
  const seed = await invokeE2E(
    "seedChatEvents",
    sessionId,
    [
      userEvent,
      makeRunningSubagentEvent({
        sessionId,
        eventId: subagentEventId,
        subagentSessionId,
        agentName,
        prompt,
      }),
    ],
    {
      chatPanelMaximized: true,
      runtimeStatus: "running",
      stationMode: "my-station",
    }
  );
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for subagent card stop: ${seed?.error ?? "unknown"}`
    );
  }

  await browser.pause(500);
  const wireSeed = await invokeE2E("debugSeedSubagentJobWire", {
    sessionId,
    handle: subagentSessionId,
    agentName,
    subagentType: "delegate",
  });
  if (!wireSeed || wireSeed.ok !== true) {
    throw new Error(
      `debugSeedSubagentJobWire failed: ${wireSeed?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const body = document.body.innerText || "";
        const card = document.querySelector('[data-tool-call-name="agent"]');
        const stopButton = card?.querySelector('[data-testid="subagent-card-stop-button"]');
        return {
          hasPrompt: body.includes(${JSON.stringify(prompt)}),
          hasStopButton: Boolean(stopButton),
          body: body.slice(0, 3000),
        };
      `);
      return state.hasPrompt && state.hasStopButton;
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `subagent card stop fixture did not render: ${JSON.stringify(
        await execJS(`
          const body = document.body.innerText || "";
          return {
            body: body.slice(0, 3000),
            cards: document.querySelectorAll('[data-tool-call-name="agent"]').length,
            buttons: Array.from(document.querySelectorAll('button')).map((button) => ({ title: button.title, aria: button.getAttribute('aria-label') })).slice(0, 50),
            pills: Array.from(document.querySelectorAll('[data-testid="composer-section-process"]')).map((el) => el.textContent || ""),
          };
        `)
      )}`,
    }
  );

  const clicked = await execJS(`
    const card = document.querySelector('[data-tool-call-name="agent"]');
    const stopButton = card?.querySelector('[data-testid="subagent-card-stop-button"]');
    if (!stopButton) return false;
    stopButton.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
    stopButton.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
    stopButton.click();
    return true;
  `);
  if (!clicked) {
    throw new Error("subagent card Stop button was not clickable");
  }

  await browser.waitUntil(
    async () => {
      const jobsResult = await invokeE2E("listRunningSubagentJobsWire");
      const jobs = jobsResult?.jobs ?? [];
      const state = await execJS(`
        const card = document.querySelector('[data-tool-call-name="agent"]');
        const stopButton = card?.querySelector('[data-testid="subagent-card-stop-button"]');
        return { stopDisabled: stopButton ? stopButton.disabled : false };
      `);
      return (
        jobsResult?.ok === true &&
        !jobs.some((job) => job && job.handle === subagentSessionId) &&
        state.stopDisabled
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `subagent card Stop did not cancel registry job: ${JSON.stringify(
        await invokeE2E("listRunningSubagentJobsWire")
      )}`,
    }
  );
}

async function assertBackgroundSubagentWirePath() {
  // MUST be `sdeagent-` prefixed: getAdapterForSession resolves the rust
  // agent adapter (and thus the channel event handler) by id prefix —
  // an unprefixed id mounts the surface but drops every wire event.
  const sessionId = `sdeagent-e2e-bg-subagent-wire-${Date.now()}`;
  const agentName = `E2E Wire Worker ${RUN_ID}`;
  const handle = `agent-builtin:general-wire-${RUN_ID}`;
  const baseTime = Date.now();
  const events = [
    {
      id: "bg-subagent-wire-user",
      chunk_id: "bg-subagent-wire-user",
      sessionId,
      createdAt: new Date(baseTime).toISOString(),
      functionName: "user_message",
      uiCanonical: "user_message",
      actionType: "raw",
      args: {},
      result: {
        type: "user",
        message: "Launch a background worker over the wire",
        is_delta: false,
      },
      source: "user",
      displayText: "Launch a background worker over the wire",
      displayStatus: "completed",
      displayVariant: "message",
      activityStatus: "processed",
      isDelta: false,
    },
  ];

  const seed = await invokeE2E("seedChatEvents", sessionId, events, {
    chatPanelMaximized: true,
    stationMode: "my-station",
  });
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for wire path: ${seed?.error ?? "unknown"}`
    );
  }

  // The session surface must be mounted so useSessionChannel has
  // subscribed to the backend IPC channel before we fire the broadcast.
  // seedChatEvents waits for the surface; give the subscribe invoke a
  // brief settle window on top.
  await browser.pause(500);

  const wireSeed = await invokeE2E("debugSeedSubagentJobWire", {
    sessionId,
    handle,
    agentName,
    subagentType: "delegate",
  });
  if (!wireSeed || wireSeed.ok !== true) {
    throw new Error(
      `debugSeedSubagentJobWire failed: ${wireSeed?.error ?? "unknown"}`
    );
  }

  // The row must arrive via the real broadcast — no frontend store write
  // happened in this spec.
  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const pills = Array.from(document.querySelectorAll('[data-testid="composer-section-process"]'))
          .map((el) => el.textContent || "");
        return { pills, hasProcessPill: pills.some((text) => text.includes("1")) };
      `);
      return state.hasProcessPill;
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `wire-path subagent pill did not render (broadcast chain broken?): ${JSON.stringify(
        await execJS(`
          return {
            body: (document.body.innerText || "").slice(0, 3000),
            pills: Array.from(document.querySelectorAll('[data-testid="composer-section-process"]')).map((el) => el.textContent || ""),
          };
        `)
      )}`,
    }
  );

  // Expand and verify the row content came from the Rust payload.
  await execJS(`
    const pill = document.querySelector('[data-testid="composer-section-process"]');
    if (pill) {
      pill.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
      pill.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
      pill.click();
    }
  `);
  await browser.waitUntil(
    async () => {
      const body = await execJS(`return document.body.innerText || "";`);
      return body.includes(agentName);
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "wire-path subagent row missing agent name after expand",
    }
  );

  // Kill via the SAME Tauri command the Stop button calls. The "killed"
  // broadcast must travel the wire and remove the row.
  const killResult = await invokeE2E("killSubagentJobWire", handle);
  if (!killResult || killResult.ok !== true) {
    throw new Error(
      `killSubagentJobWire failed: ${killResult?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const body = document.body.innerText || "";
        const pills = Array.from(document.querySelectorAll('[data-testid="composer-section-process"]'));
        return { pillCount: pills.length, hasAgentRow: body.includes(${JSON.stringify(agentName)}) };
      `);
      return state.pillCount === 0 && !state.hasAgentRow;
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `killed wire-path subagent row did not disappear: ${JSON.stringify(
        await execJS(
          `return { body: (document.body.innerText || "").slice(0, 3000) };`
        )
      )}`,
    }
  );
}

function makeHiddenRunningEvents(sessionId, baseTime) {
  return [
    {
      id: "hidden-running-user",
      chunk_id: "hidden-running-user",
      sessionId,
      createdAt: new Date(baseTime).toISOString(),
      functionName: "user_message",
      uiCanonical: "user_message",
      actionType: "raw",
      args: {},
      result: {
        type: "user",
        message: "Keep working",
        is_delta: false,
      },
      source: "user",
      displayText: "Keep working",
      displayStatus: "completed",
      displayVariant: "message",
      activityStatus: "processed",
      isDelta: false,
    },
    {
      id: "hidden-running-status",
      chunk_id: "hidden-running-status",
      sessionId,
      createdAt: new Date(baseTime + 1_000).toISOString(),
      functionName: "hidden_status",
      uiCanonical: "hidden_status",
      actionType: "raw",
      args: {},
      result: { status: "running", is_delta: false },
      source: "assistant",
      displayText: "",
      displayStatus: "running",
      displayVariant: "session",
      activityStatus: "agent",
      isDelta: false,
    },
  ];
}

async function assertWorkingFooterShownForHiddenRunningEvent() {
  const sessionId = `e2e-render-working-footer-${Date.now()}`;
  const baseTime = Date.now();
  const events = makeHiddenRunningEvents(sessionId, baseTime);

  const seed = await invokeE2E("seedChatEvents", sessionId, events, {
    chatPanelMaximized: true,
    runtimeStatus: "running",
    stationMode: "my-station",
  });
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for working footer: ${seed?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const footer = await execJS(`
        const el = document.querySelector('[data-testid="planning-footer"]');
        return el ? el.textContent || "" : "";
      `);
      return /Planning next step|Working on|Thinking|working/i.test(footer);
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `working footer did not render for hidden running event: ${JSON.stringify(
        await execJS(
          `return { body: (document.body.innerText || "").slice(0, 5000) };`
        )
      )}; state=${JSON.stringify(await invokeE2E("inspectChatState"))}`,
    }
  );
}

async function assertStaleHiddenRunningEventDoesNotHoldStopButton() {
  const sessionId = `e2e-render-stale-hidden-running-${Date.now()}`;
  const baseTime = Date.now();
  const seed = await invokeE2E(
    "seedChatEvents",
    sessionId,
    makeHiddenRunningEvents(sessionId, baseTime),
    {
      chatPanelMaximized: true,
      stationMode: "my-station",
    }
  );
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for stale hidden running event: ${seed?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const sendState = await execJS(`
        const button = document.querySelector('[data-testid="chat-send-button"]');
        return button ? button.getAttribute("data-state") : null;
      `);
      return sendState === "submit";
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `stale hidden running event kept composer in stop state: ${JSON.stringify(
        await execJS(`
          const button = document.querySelector('[data-testid="chat-send-button"]');
          return {
            sendState: button ? button.getAttribute("data-state") : null,
            body: (document.body.innerText || "").slice(0, 5000),
          };
        `)
      )}`,
    }
  );
}

async function assertEarlyCancelStopNavigatesToPreviousTurnPage() {
  const sessionId = `e2e-render-early-cancel-turnpage-${Date.now()}`;
  const baseTime = Date.now();
  const draftText = `Early cancel draft marker ${RUN_ID}`;

  // Build 2 completed turns + 1 running turn (user-only, no assistant output)
  const turn1User = {
    id: "ec-t1-user",
    chunk_id: "ec-t1-user",
    sessionId,
    createdAt: new Date(baseTime).toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "raw",
    args: {},
    result: { type: "user", message: "Turn 1 prompt", is_delta: false },
    source: "user",
    displayText: "Turn 1 prompt",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
  const turn1Assistant = {
    id: "ec-t1-assist",
    chunk_id: "ec-t1-assist",
    sessionId,
    createdAt: new Date(baseTime + 1_000).toISOString(),
    functionName: "agent_message",
    uiCanonical: "agent_message",
    actionType: "raw",
    args: {},
    result: { type: "assistant", message: "Turn 1 answer", is_delta: false },
    source: "assistant",
    displayText: "Turn 1 answer",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
  const turn2User = {
    id: "ec-t2-user",
    chunk_id: "ec-t2-user",
    sessionId,
    createdAt: new Date(baseTime + 2_000).toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "raw",
    args: {},
    result: { type: "user", message: "Turn 2 prompt", is_delta: false },
    source: "user",
    displayText: "Turn 2 prompt",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
  const turn2Assistant = {
    id: "ec-t2-assist",
    chunk_id: "ec-t2-assist",
    sessionId,
    createdAt: new Date(baseTime + 3_000).toISOString(),
    functionName: "agent_message",
    uiCanonical: "agent_message",
    actionType: "raw",
    args: {},
    result: { type: "assistant", message: "Turn 2 answer", is_delta: false },
    source: "assistant",
    displayText: "Turn 2 answer",
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };
  const turn3User = {
    id: "ec-t3-user",
    chunk_id: "ec-t3-user",
    sessionId,
    createdAt: new Date(baseTime + 4_000).toISOString(),
    functionName: "user_message",
    uiCanonical: "user_message",
    actionType: "raw",
    args: {},
    result: { type: "user", message: draftText, is_delta: false },
    source: "user",
    displayText: draftText,
    displayStatus: "completed",
    displayVariant: "message",
    activityStatus: "processed",
    isDelta: false,
  };

  const seed = await invokeE2E(
    "seedChatEvents",
    sessionId,
    [turn1User, turn1Assistant, turn2User, turn2Assistant, turn3User],
    {
      chatPanelMaximized: true,
      stationMode: "my-station",
      runtimeStatus: "running",
      lastUserMessage: { displayContent: draftText },
    }
  );
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for early-cancel turn page: ${seed?.error ?? "unknown"}`
    );
  }

  // Wait for the send button to show stop state (runtime is running)
  await browser.waitUntil(
    async () => {
      const sendState = await execJS(`
        const button = document.querySelector('[data-testid="chat-send-button"]');
        return button ? button.getAttribute("data-state") : null;
      `);
      return sendState === "stop";
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg:
        "send button did not enter stop state for early-cancel turn page test",
    }
  );

  // Verify we're on the latest round before clicking Stop
  await browser.waitUntil(
    async () => {
      const roundLabel = await execJS(`
        const node = document.querySelector('[data-testid="turn-pagination-current-round"]');
        return node ? node.textContent.trim() : null;
      `);
      return roundLabel !== null && /latest/i.test(roundLabel);
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "turn pagination did not show Latest round before Stop",
    }
  );

  // Click Stop
  await execJS(`
    const button = document.querySelector('[data-testid="chat-send-button"]');
    if (button) {
      button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true }));
      button.click();
    }
    return !!button;
  `);

  // Assert turn page navigated back to the previous round (Round 2)
  await browser.waitUntil(
    async () => {
      const roundLabel = await execJS(`
        const node = document.querySelector('[data-testid="turn-pagination-current-round"]');
        return node ? node.textContent.trim() : null;
      `);
      return roundLabel !== null && /round\s+2/i.test(roundLabel);
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `early-cancel Stop did not navigate to previous turn page; roundLabel=${JSON.stringify(await execJS(`return document.querySelector('[data-testid="turn-pagination-current-round"]')?.textContent || null;`))}`,
    }
  );
}

async function assertOneHundredRoundSkeletonRemainsNavigable() {
  const sessionId = `sdeagent-e2e-hundred-round-skeleton-${RUN_ID}`;
  const baseTime = Date.now() - 100_000;
  const events = [];
  for (let index = 0; index < 100; index++) {
    const turnId = `round-user-${index}`;
    events.push({
      id: turnId,
      chunk_id: turnId,
      sessionId,
      createdAt: new Date(baseTime + index * 1_000).toISOString(),
      functionName: "user_message",
      uiCanonical: "user_message",
      actionType: "raw",
      args: {},
      result: {
        type: "user",
        message: `Round ${index + 1} prompt`,
        is_delta: false,
      },
      source: "user",
      displayText: `Round ${index + 1} prompt`,
      displayStatus: "completed",
      displayVariant: "message",
      activityStatus: "processed",
      isDelta: false,
    });
    if (index < 99) {
      events.push({
        id: `round-placeholder-${index}`,
        chunk_id: `round-placeholder-${index}`,
        sessionId,
        createdAt: new Date(baseTime + index * 1_000 + 500).toISOString(),
        functionName: "turn_placeholder",
        uiCanonical: "turn_placeholder",
        actionType: "turn_placeholder",
        args: {},
        result: {
          observation: `Round ${index + 1} is not loaded yet`,
          unloadedTurn: {
            turnId,
            nextTurnId: `round-user-${index + 1}`,
            startedAt: new Date(baseTime + index * 1_000).toISOString(),
            endedAt: new Date(baseTime + (index + 1) * 1_000).toISOString(),
            durationMs: 1_000,
            eventCount: 2,
            bodyEventCount: 1,
          },
        },
        source: "assistant",
        displayText: `Round ${index + 1} is not loaded yet`,
        displayStatus: "completed",
        displayVariant: "message",
        activityStatus: "processed",
        isDelta: false,
      });
    } else {
      events.push({
        ...makeAssistantEvent(sessionId, "hundred-round-skeleton"),
        id: "round-assistant-99",
        chunk_id: "round-assistant-99",
        createdAt: new Date(baseTime + index * 1_000 + 500).toISOString(),
        displayText: "Round 100 answer",
        result: {
          type: "assistant",
          message: "Round 100 answer",
          is_delta: false,
        },
      });
    }
  }

  const seed = await invokeE2E("seedChatEvents", sessionId, events, {
    chatPanelMaximized: true,
    stationMode: "my-station",
    runtimeStatus: "completed",
  });
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for 100-round skeleton: ${seed?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () =>
      execJS(`
        const current = document.querySelector('[data-testid="turn-pagination-current-round"]');
        return current && /latest/i.test(current.textContent || '') && !current.disabled;
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "100-round skeleton did not open on Latest Round",
    }
  );
  await execJS(`
    document.querySelector('[data-testid="turn-pagination-current-round"]')?.click();
  `);
  await browser.waitUntil(
    async () =>
      execJS(`
        const list = document.querySelector('[data-testid="turn-page-list"]');
        if (!list) return false;
        list.scrollTop = 50 * 36;
        list.dispatchEvent(new Event('scroll', { bubbles: true }));
        return true;
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "100-round selector list did not open",
    }
  );
  await browser.waitUntil(
    async () =>
      execJS(`
        const item = document.querySelector(
          '[data-testid="turn-page-list-item"][data-page-index="49"]'
        );
        if (!item) return false;
        item.click();
        return true;
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "virtualized round selector never exposed round 50",
    }
  );
  await browser.waitUntil(
    async () =>
      execJS(`
        const current = document.querySelector('[data-testid="turn-pagination-current-round"]');
        return current && /round\\s+50/i.test(current.textContent || '');
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "round 50 was not selectable from the 100-round skeleton",
    }
  );

  const setPaginationEnabled = async (enabled) => {
    await execJS(`
      document.querySelector('[data-testid="chat-panel-header-more-button"]')?.click();
    `);
    await browser.waitUntil(
      async () =>
        execJS(`
          const toggle = Array.from(document.querySelectorAll('[role="switch"]'))
            .find((node) => /pagination/i.test(node.getAttribute('aria-label') || ''));
          if (!toggle) return false;
          const checked = toggle.getAttribute('aria-checked') === 'true';
          if (checked !== ${enabled}) toggle.click();
          return true;
        `),
      {
        timeout: RENDER_TIMEOUT_MS,
        timeoutMsg: `pagination toggle did not become available for enabled=${enabled}`,
      }
    );
    await execJS(`
      const menu = document.querySelector('[data-testid="chat-panel-header-more-button"]');
      if (menu?.getAttribute('aria-expanded') === 'true') menu.click();
    `);
  };

  await setPaginationEnabled(false);
  await browser.waitUntil(
    async () =>
      execJS(`
        if (document.querySelector('[data-testid="turn-pagination-current-round"]')) {
          return false;
        }
        const scroller = document.querySelector('[data-testid="chat-history-scroll-container"]');
        if (!scroller) return false;
        scroller.scrollTop = 0;
        scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
        return true;
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "non-paginated timeline did not render",
    }
  );
  await browser.waitUntil(
    async () =>
      execJS(`
        const first = document.querySelector('[data-chat-group-index="0"]');
        return !!first && (first.textContent || '').includes('Round 1 prompt');
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "non-paginated timeline never exposed collapsed round 1",
    }
  );
  await setPaginationEnabled(true);
}

/**
 * PR #561 follow-up: the 100-round skeleton scenario above seeds
 * `sdeagent-` ids through `seedChatEvents`, which never routes through
 * `importedHistoryTurnLoader` (see
 * src/engines/SessionCore/turns/importedHistoryTurnLoader.ts -- it only
 * fires for `isExternalHistorySession` ids, excluding codex/cursor-ide).
 * This scenario exercises the REAL imported Claude Code lazy-replay
 * pipeline end to end against an on-disk transcript:
 *
 *   sidebar discovery -> click -> windowed initial load (newest round body
 *   only) -> round-selector navigation -> placeholder ->
 *   importedHistoryTurnWindows fetch -> EventStore merge, and then the
 *   externalHistoryAutoRefresh replace-reload regression guarded by
 *   transcriptReplaceEpochAtom (src/engines/SessionCore/core/atoms/actions.ts).
 *
 * The fixture transcript is written to
 * `<ORGII_EXTERNAL_HISTORY_HOME>/.claude/projects/.../<uuid>.jsonl` by
 * `tests/e2e/wdio.conf.mjs` (`ensureClaudeCodeImportFixtureTranscript`)
 * BEFORE the app process launches, so the app's own startup
 * `useDataSourceAutoScan` pass discovers and caches it without any debug
 * seed/mutation endpoint. This function only performs real rendered
 * sidebar clicks/round-selector clicks and a direct on-disk file append
 * (the equivalent of the user's Claude Code CLI writing another round).
 */
async function assertImportedClaudeHistoryLazyReplayAndAutoRefresh() {
  const fixtureSessionId = process.env.E2E_CLAUDE_IMPORT_FIXTURE_SESSION_ID;
  const fixturePath = process.env.E2E_CLAUDE_IMPORT_FIXTURE_PATH;
  const roundCount = Number.parseInt(
    process.env.E2E_CLAUDE_IMPORT_FIXTURE_ROUND_COUNT ?? "0",
    10
  );
  const fixtureCwd = process.env.E2E_CLAUDE_IMPORT_FIXTURE_CWD;
  if (!fixtureSessionId || !fixturePath || !roundCount || !fixtureCwd) {
    throw new Error(
      "Claude Code import fixture env vars are missing " +
        "(E2E_CLAUDE_IMPORT_FIXTURE_SESSION_ID/_PATH/_ROUND_COUNT/_CWD). " +
        "wdio.conf.mjs must seed the on-disk transcript before the app " +
        "process launches -- see ensureClaudeCodeImportFixtureTranscript."
    );
  }
  const fixtureUuid = fixtureSessionId.replace(/^claudecodeapp-/, "");
  const newestRoundText = `round-${roundCount} answer body`;
  const round2Text = "round-2 answer body";

  // Step 1: open the sidebar's imported Claude Code ("Claude App") section
  // and click the fixture session through the real sidebar row -- the same
  // production click path used by openRenderedSidebarSession /
  // clickSidebarSessionRow elsewhere in this suite, inlined here since this
  // spec file does not import those support modules.
  const sidebarSelector = `[data-testid="sidebar-session-item-${fixtureSessionId}"]`;
  await browser.waitUntil(
    async () =>
      execJS(
        `return !!document.querySelector(${JSON.stringify(sidebarSelector)});`
      ),
    {
      timeout: MOUNT_TIMEOUT_MS,
      timeoutMsg: `Claude Code import fixture session ${fixtureSessionId} never appeared in the sidebar (external-history auto-scan did not discover it)`,
    }
  );

  // Confirm the fixture session specifically becomes active (not just "some
  // chat surface is showing") -- this is a shared app instance across every
  // scenario in this file, so a prior test can already have another session's
  // chat panel open with the same round-selector element present.
  // `getActiveSessionId` is a read-only inspection helper (asserts the
  // result of the real click; it does not perform the click itself).
  let opened = false;
  for (let attempt = 1; attempt <= 6 && !opened; attempt++) {
    await execJS(`
      const row = document.querySelector(${JSON.stringify(sidebarSelector)});
      if (row) {
        row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window, button: 0 }));
        row.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window, button: 0 }));
        row.click();
      }
    `);
    try {
      await browser.waitUntil(
        async () => {
          const active = await invokeE2E("getActiveSessionId");
          return active?.ok === true && active.sessionId === fixtureSessionId;
        },
        { timeout: 3_000 }
      );
      opened = true;
    } catch {
      await browser.pause(500);
    }
  }
  if (!opened) {
    throw new Error(
      `Clicking the Claude Code import fixture sidebar row never activated it (${fixtureSessionId})`
    );
  }

  // Step 2a: the session opens on Latest Round and the initial windowed
  // load (IMPORTED_HISTORY_INITIAL_RECENT_TURN_COUNT = 1) has fetched only
  // the newest round's body.
  await browser.waitUntil(
    async () =>
      execJS(`
        const current = document.querySelector('[data-testid="turn-pagination-current-round"]');
        return !!current && /latest/i.test(current.textContent || '') && !current.disabled;
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "Claude Code import fixture did not open on Latest Round",
    }
  );
  await browser.waitUntil(
    async () =>
      execJS(
        `return (document.body.innerText || '').includes(${JSON.stringify(newestRoundText)});`
      ),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `newest round body "${newestRoundText}" never rendered after opening the imported Claude Code session`,
    }
  );

  // Step 2b: round 2's body must NOT already be in the DOM. Asserting this
  // BEFORE navigating is the only thing that keeps this scenario from
  // silently passing on a full-eager-load regression -- without it, a bug
  // that loads every round up front would also satisfy the "round 2 body
  // visible after navigating" assertion below.
  const round2PresentBeforeNav = await execJS(
    `return (document.body.innerText || '').includes(${JSON.stringify(round2Text)});`
  );
  if (round2PresentBeforeNav) {
    throw new Error(
      "round-2 answer body was already rendered before navigating to round 2; " +
        "the initial imported-history window is not lazily loading older " +
        "rounds, so this scenario cannot prove the placeholder -> " +
        "importedHistoryTurnWindows fetch path."
    );
  }

  // Step 2c: navigate to round 2 via the real round selector (open dropdown,
  // click round 2's row -- same idiom as assertOneHundredRoundSkeletonRemainsNavigable).
  await execJS(`
    document.querySelector('[data-testid="turn-pagination-current-round"]')?.click();
  `);
  await browser.waitUntil(
    async () =>
      execJS(
        `return !!document.querySelector('[data-testid="turn-page-list"]');`
      ),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg:
        "round selector list did not open for the Claude Code import fixture",
    }
  );
  await browser.waitUntil(
    async () =>
      execJS(`
        const item = document.querySelector(
          '[data-testid="turn-page-list-item"][data-page-index="1"]'
        );
        if (!item) return false;
        item.click();
        return true;
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg:
        "round selector never exposed round 2 for the Claude Code import fixture",
    }
  );
  await browser.waitUntil(
    async () =>
      execJS(`
        const current = document.querySelector('[data-testid="turn-pagination-current-round"]');
        return !!current && /round\\s+2/i.test(current.textContent || '');
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg:
        "round 2 was not selectable from the imported Claude Code round selector",
    }
  );

  // Step 2d: selecting round 2 must trigger loadSessionTurnBodyIntoStore ->
  // importedHistoryTurnLoader -> importedHistoryTurnWindows ->
  // eventStoreProxy.mergeRoundWindowEvents, rendering the real body.
  await browser.waitUntil(
    async () =>
      execJS(
        `return (document.body.innerText || '').includes(${JSON.stringify(round2Text)});`
      ),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `round-2 body never loaded after selecting round 2 (importedHistoryTurnLoader did not fetch it)`,
    }
  );

  // Step 3: replace-reload regression. Append one complete new round to the
  // on-disk transcript from the WDIO Node process (not browser.execute)
  // while round 2 is still on screen, mirroring the user's Claude Code CLI
  // writing another round to the same file.
  const appendedRound = roundCount + 1;
  // Real "now" timestamps, not a fixed calendar date: the sidebar/session
  // list buckets rows by age and only eager-loads a bounded page per bucket
  // (src/util/session/sessionDateBuckets.ts), so the appended round must
  // land in the same "today" bucket as the rest of the fixture.
  const appendedUserAt = new Date().toISOString();
  const appendedAssistantAt = new Date(Date.now() + 1_000).toISOString();
  const appendedLines = [
    JSON.stringify({
      type: "user",
      sessionId: fixtureUuid,
      cwd: fixtureCwd,
      gitBranch: "main",
      timestamp: appendedUserAt,
      message: { role: "user", content: `round-${appendedRound} prompt` },
    }),
    JSON.stringify({
      type: "assistant",
      sessionId: fixtureUuid,
      cwd: fixtureCwd,
      gitBranch: "main",
      timestamp: appendedAssistantAt,
      message: {
        role: "assistant",
        model: "claude-sonnet-4",
        content: [{ type: "text", text: `round-${appendedRound} answer body` }],
        usage: { input_tokens: 10, output_tokens: 20 },
      },
    }),
  ];
  await appendFile(fixturePath, `${appendedLines.join("\n")}\n`, "utf8");

  // Claude Code sources `supportsWindowedReplay`, so
  // refreshImportedHistorySession dispatches `replace: true`: the windowed
  // snapshot comes back with only the (new) latest round's body loaded and
  // every other round -- including the still-visible round 2 -- demoted
  // back to an `unloadedTurn` placeholder. `useTurnPageSelection`'s
  // `turnPaginationReady` is derived as
  // `!currentPageHasUnloadedTurn` for the page actually on screen
  // (src/engines/ChatPanel/ChatHistory/hooks/useTurnPageSelection.ts,
  // ~line 369-380), and `TurnPaginationControls` disables the round-select
  // trigger button and swaps its chevron for a spinner exactly when that
  // flips false (~line 386, 395-407). Waiting for the button to go
  // `disabled` first -- rather than only waiting for round-2's body text to
  // reappear -- proves the replace actually demoted the visible page,
  // instead of the later wait trivially passing because the text was
  // already on screen from step 2d and never left.
  await browser.waitUntil(
    async () =>
      execJS(`
        const current = document.querySelector('[data-testid="turn-pagination-current-round"]');
        return !!current && current.disabled === true;
      `),
    {
      timeout: EXTERNAL_HISTORY_REFRESH_TIMEOUT_MS,
      timeoutMsg:
        "round 2 never fell back to an unloaded-turn placeholder (round " +
        "selector never went disabled) after appending a new round; the " +
        "externalHistoryAutoRefresh windowed replace reload never fired " +
        "for the Claude Code import fixture",
    }
  );

  // The replace demoted round 2 back to a placeholder while it is still the
  // visible page; useTurnPageNavigation's prefetch effect keys off
  // transcriptReplaceEpochAtom and must auto-refetch the current page
  // without any further navigation -- the selector re-enables and round 2's
  // real body renders again.
  await browser.waitUntil(
    async () =>
      execJS(`
        const current = document.querySelector('[data-testid="turn-pagination-current-round"]');
        const ready = !!current && current.disabled === false;
        const bodyVisible = (document.body.innerText || '').includes(${JSON.stringify(round2Text)});
        return ready && bodyVisible;
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg:
        "round-2 body did not reappear after the windowed replace reload -- " +
        "transcriptReplaceEpochAtom auto-refetch regression " +
        "(src/engines/SessionCore/core/atoms/actions.ts)",
    }
  );
}

async function assertMultiRepoReadPathRendered() {
  const sessionId = `e2e-render-multirepo-read-${Date.now()}`;
  const baseTime = Date.now();
  const primaryPath = `/tmp/orgii-e2e-multirepo-primary-${RUN_ID}/src/index.tsx`;
  const secondaryPath = `/tmp/orgii-e2e-multirepo-secondary-${RUN_ID}/src/index.tsx`;
  const tertiaryPath = `/tmp/orgii-e2e-multirepo-tertiary-${RUN_ID}/README.md`;
  const userEvent = {
    ...withCreatedAt(
      makeOrderUserEvent("multi-read-user", "Read two files"),
      baseTime
    ),
    sessionId,
  };
  const readPayloads = [
    {
      path: primaryPath,
      args: { targetFile: primaryPath },
      result: {},
    },
    {
      path: secondaryPath,
      args: { file_path: secondaryPath },
      result: {},
    },
    {
      path: tertiaryPath,
      args: {},
      result: { success: { filePath: tertiaryPath } },
    },
  ];
  const readEvents = readPayloads.map(
    ({ path: targetPath, args, result }, index) => ({
      id: `multi-read-${index}`,
      chunk_id: `multi-read-${index}`,
      sessionId,
      createdAt: new Date(baseTime + 1_000 + index).toISOString(),
      functionName: "read_file",
      uiCanonical: "read_file",
      actionType: "tool_call",
      args,
      result: {
        ...result,
        content: `content for ${targetPath}`,
        observation: `content for ${targetPath}`,
        is_delta: false,
      },
      source: "assistant",
      displayText: `Read ${targetPath}`,
      displayStatus: "completed",
      displayVariant: "tool_call",
      activityStatus: "agent",
      isDelta: false,
    })
  );
  const assistantEvent = {
    ...withCreatedAt(
      makeOrderAssistantEvent(
        "multi-read-assistant",
        "message",
        "Read complete"
      ),
      baseTime + 3_000
    ),
    sessionId,
  };

  const seed = await invokeE2E("seedChatEvents", sessionId, [
    userEvent,
    ...readEvents,
    assistantEvent,
  ]);
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedChatEvents failed for multi-root read path: ${seed?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const paths = Array.from(document.querySelectorAll('[data-testid="read-file-path"]'))
          .map((node) => node.textContent || "");
        const body = document.body.innerText || "";
        return {
          paths,
          body: body.slice(0, 3000),
          expectedPaths: ${JSON.stringify([primaryPath, secondaryPath, tertiaryPath])},
          hasGenericOnly: paths.some((path) => path.trim() === "file"),
        };
      `);
      return (
        state.expectedPaths.every(
          (expectedPath) =>
            state.body.includes(expectedPath) ||
            state.paths.some((renderedPath) =>
              renderedPath.includes(expectedPath)
            )
        ) && !state.hasGenericOnly
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `multi-root read file paths did not render: ${JSON.stringify(
        await execJS(`
          const paths = Array.from(document.querySelectorAll('[data-testid="read-file-path"]'))
            .map((node) => node.textContent || "");
          return { paths, body: (document.body.innerText || "").slice(0, 3000) };
        `)
      )}`,
    }
  );
}

async function assertThinkingChronologicalOrder() {
  const orderedEventIds = [
    "order-user-a",
    "order-think-a",
    "order-answer-a",
    "order-user-b",
    "order-think-b",
    "order-answer-b",
  ];
  const visibleLatestRoundTexts = [
    ORDER_TEXTS.userB,
    ORDER_TEXTS.thinkB,
    ORDER_TEXTS.answerB,
  ];
  const baseTime = Date.now();
  const seed = await invokeE2E("seedChatEvents", ORDER_SESSION_ID, [
    withCreatedAt(
      makeOrderUserEvent("order-user-a", ORDER_TEXTS.userA),
      baseTime
    ),
    withCreatedAt(
      makeOrderAssistantEvent("order-think-a", "thinking", ORDER_TEXTS.thinkA),
      baseTime + 1_000
    ),
    withCreatedAt(
      makeOrderAssistantEvent("order-answer-a", "message", ORDER_TEXTS.answerA),
      baseTime + 2_000
    ),
    withCreatedAt(
      makeOrderUserEvent("order-user-b", ORDER_TEXTS.userB),
      baseTime + 3_000
    ),
    withCreatedAt(
      makeOrderAssistantEvent("order-think-b", "thinking", ORDER_TEXTS.thinkB),
      baseTime + 4_000
    ),
    withCreatedAt(
      makeOrderAssistantEvent("order-answer-b", "message", ORDER_TEXTS.answerB),
      baseTime + 5_000
    ),
  ]);
  if (!seed || seed.ok !== true) {
    throw new Error(`seedChatEvents failed: ${seed?.error ?? "unknown"}`);
  }

  await browser.waitUntil(
    async () => {
      const chatState = await invokeE2E("inspectChatState");
      const events = chatState.chatEvents ?? chatState.value?.chatEvents ?? [];
      const eventIds = events.map((event) => event.id);
      const relevantIds = eventIds.filter((eventId) =>
        orderedEventIds.includes(eventId)
      );
      return JSON.stringify(relevantIds) === JSON.stringify(orderedEventIds);
    },
    {
      timeout: 10_000,
      timeoutMsg: `thinking events were not stored in chronological turn order: ${JSON.stringify(
        await invokeE2E("inspectChatState")
      )}`,
    }
  );

  await browser.waitUntil(
    async () => {
      const state = await execJS(`
        const history = document.querySelector('[data-testid="chat-message-list"]');
        const body = history ? (history.innerText || "") : (document.body.innerText || "");
        const texts = ${JSON.stringify(visibleLatestRoundTexts)};
        const indices = texts.map((text) => body.indexOf(text));
        const counts = texts.map((text) => (body.match(new RegExp(text, "g")) || []).length);
        return {
          indices,
          counts,
          inOrder: indices.every((index) => index >= 0) && indices.every((index, idx) => idx === 0 || index > indices[idx - 1]),
          body: body.slice(0, 3000),
        };
      `);
      return state.inOrder && state.counts.every((count) => count === 1);
    },
    {
      timeout: 10_000,
      timeoutMsg: `latest visible thinking round did not render chronologically: ${JSON.stringify(
        await execJS(`
        const history = document.querySelector('[data-testid="chat-message-list"]');
        const body = history ? (history.innerText || "") : (document.body.innerText || "");
        const texts = ${JSON.stringify(visibleLatestRoundTexts)};
        return { indices: texts.map((text) => body.indexOf(text)), body: body.slice(0, 3000) };
      `)
      )}`,
    }
  );
}

async function assertOpenCodeSubagentReloadKeepsAnswerAndAssignment() {
  const baseTime = Date.now();
  const events = [
    withCreatedAt(
      makeOpenCodeReloadUserEvent(
        "opencode-reload-user",
        OPENCODE_RELOAD_USER_PROMPT
      ),
      baseTime
    ),
    withCreatedAt(makeOpenCodeReloadSubagentEvent(), baseTime + 1_000),
    withCreatedAt(makeOpenCodeReloadAssistantEvent(), baseTime + 2_000),
  ];
  const seed = await invokeE2E("seedPersistedCachedSession", {
    sessionId: OPENCODE_RELOAD_SESSION_ID,
    name: OPENCODE_RELOAD_USER_PROMPT,
    userInput: OPENCODE_RELOAD_USER_PROMPT,
    category: "cli_agent",
    events,
  });
  if (!seed || seed.ok !== true) {
    throw new Error(
      `seedPersistedCachedSession failed: ${seed?.error ?? "unknown"}`
    );
  }

  const firstOpen = await invokeE2E("openSession", OPENCODE_RELOAD_SESSION_ID);
  if (!firstOpen || firstOpen.ok !== true) {
    throw new Error(`openSession failed: ${firstOpen?.error ?? "unknown"}`);
  }

  await browser.waitUntil(
    async () => {
      const body = await execJS(`return document.body.innerText || "";`);
      return (
        body.includes(OPENCODE_RELOAD_ASSIGNMENT_PROMPT) &&
        body.includes(OPENCODE_RELOAD_ASSISTANT_ANSWER) &&
        !body.includes(OPENCODE_RELOAD_FINAL_REPORT)
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `OpenCode fixture did not render assignment+answer before reload: ${JSON.stringify(
        await execJS(`return (document.body.innerText || "").slice(0, 4000);`)
      )}`,
    }
  );

  await browser.refresh();
  await waitForApp();
  const reopened = await invokeE2E("openSession", OPENCODE_RELOAD_SESSION_ID);
  if (!reopened || reopened.ok !== true) {
    throw new Error(
      `openSession after reload failed: ${reopened?.error ?? "unknown"}`
    );
  }

  await browser.waitUntil(
    async () => {
      const state = await invokeE2E("inspectChatState");
      const body = await execJS(`return document.body.innerText || "";`);
      return (
        state.activeSessionId === OPENCODE_RELOAD_SESSION_ID &&
        state.chatEventCount >= 3 &&
        body.includes(OPENCODE_RELOAD_ASSIGNMENT_PROMPT) &&
        body.includes(OPENCODE_RELOAD_ASSISTANT_ANSWER) &&
        !body.includes(OPENCODE_RELOAD_FINAL_REPORT)
      );
    },
    {
      timeout: 30_000,
      interval: 1_000,
      timeoutMsg: `OpenCode fixture did not preserve rendered answer/assignment after reload: ${JSON.stringify(
        {
          state: await invokeE2E("inspectChatState"),
          body: await execJS(
            `return (document.body.innerText || "").slice(0, 4000);`
          ),
        }
      )}`,
    }
  );
}

async function assertTurnMetadataFooterRendered() {
  const sessionId = `sdeagent-e2e-turn-metadata-${RUN_ID}`;
  const baseTime = Date.now();
  const user = withCreatedAt(
    makeUserEvent(sessionId, `metadata-${RUN_ID}`),
    baseTime
  );
  const edit = {
    id: `${sessionId}-edit`,
    chunk_id: `${sessionId}-edit`,
    sessionId,
    createdAt: new Date(baseTime + 1_000).toISOString(),
    functionName: "edit_file",
    uiCanonical: "edit_file",
    actionType: "tool_call",
    args: {
      file_path: "src/features/metadata/sessionMetadata.ts",
      old_string: "old line",
      new_string: "new line\nsecond line\nthird line",
    },
    result: {
      output: "Updated src/features/metadata/sessionMetadata.ts",
      linesAdded: 3,
      linesRemoved: 1,
    },
    source: "assistant",
    displayText: "Updated sessionMetadata.ts",
    displayStatus: "completed",
    displayVariant: "tool_call",
    activityStatus: "agent",
    isDelta: false,
  };
  const read = {
    ...edit,
    id: `${sessionId}-read`,
    chunk_id: `${sessionId}-read`,
    createdAt: new Date(baseTime + 500).toISOString(),
    functionName: "read_file",
    uiCanonical: "read_file",
    args: { file_path: "src/features/metadata/source.ts" },
    result: { output: "source contents" },
    displayText: "Read source.ts",
  };
  const search = {
    ...edit,
    id: `${sessionId}-search`,
    chunk_id: `${sessionId}-search`,
    createdAt: new Date(baseTime + 750).toISOString(),
    functionName: "search_files",
    uiCanonical: "search_files",
    args: { path: "src/features/metadata" },
    result: {
      results: [{ file: "src/features/metadata/sessionMetadata.ts" }],
    },
    displayText: "Searched metadata files",
  };
  const commit = {
    ...edit,
    id: `${sessionId}-commit`,
    chunk_id: `${sessionId}-commit`,
    createdAt: new Date(baseTime + 2_000).toISOString(),
    functionName: "run_shell",
    uiCanonical: "run_shell",
    args: { command: "git commit -m 'feat: session metadata'" },
    result: {
      success: {
        command: "git commit -m 'feat: session metadata'",
        stdout: "[feature/session-metadata abc1234] feat: session metadata",
        exitCode: 0,
      },
    },
    displayText: "Committed session metadata",
  };
  const pullRequest = {
    ...commit,
    id: `${sessionId}-pr`,
    chunk_id: `${sessionId}-pr`,
    createdAt: new Date(baseTime + 3_000).toISOString(),
    args: { command: "gh pr create --title 'Session metadata'" },
    result: {
      success: {
        command: "gh pr create --title 'Session metadata'",
        stdout: "https://github.com/org2ai/ORG2/pull/387",
        exitCode: 0,
      },
    },
    displayText: "Created pull request 387",
  };
  const assistant = withCreatedAt(
    makeAssistantEvent(sessionId, `metadata-${RUN_ID}`),
    baseTime + 4_000
  );

  const seed = await invokeE2E("seedPersistedCachedSession", {
    sessionId,
    name: "Turn metadata E2E",
    userInput: "Edit a file, commit it, and open a PR",
    category: "rust_agent",
    status: "completed",
    events: [user, read, search, edit, commit, pullRequest, assistant],
  });
  if (!seed || seed.ok !== true) {
    throw new Error(`turn metadata seed failed: ${seed?.error ?? "unknown"}`);
  }
  const opened = await invokeE2E("openSession", sessionId);
  if (!opened || opened.ok !== true) {
    throw new Error(`turn metadata open failed: ${opened?.error ?? "unknown"}`);
  }

  await browser.waitUntil(
    async () =>
      execJS(`
        const footer = document.querySelector('[data-testid="turn-metadata-footer"]');
        return !!footer &&
          !!footer.querySelector('[data-testid="turn-metadata-edits-tab"][data-active="true"]') &&
          !!footer.querySelector('[data-testid="turn-metadata-reads-count"]') &&
          footer.querySelectorAll('[data-testid="turn-metadata-commit"]').length === 1 &&
          footer.querySelectorAll('[data-testid="turn-metadata-pr"]').length === 1 &&
          footer.querySelectorAll('[data-testid="turn-metadata-read"]').length === 0 &&
          (footer.innerText || '').includes('sessionMetadata.ts') &&
          (footer.innerText || '').includes('abc1234') &&
          (footer.innerText || '').includes('#387');
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: `turn metadata footer did not render: ${JSON.stringify(
        await execJS(`return (document.body.innerText || '').slice(-5000);`)
      )}`,
    }
  );

  await execJS(`
    document.querySelector('[data-testid="turn-metadata-reads-tab"]')?.click();
  `);
  await browser.waitUntil(
    async () =>
      execJS(`
        const footer = document.querySelector('[data-testid="turn-metadata-footer"]');
        return !!footer &&
          !!footer.querySelector('[data-testid="turn-metadata-reads-tab"][data-active="true"]') &&
          footer.querySelectorAll('[data-testid="turn-metadata-read"]').length === 1 &&
          footer.querySelectorAll('[data-testid="turn-metadata-commit"]').length === 0 &&
          footer.querySelectorAll('[data-testid="turn-metadata-pr"]').length === 0;
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "read rows did not lazy-render after selecting Reads",
    }
  );

  const emptySessionId = `sdeagent-e2e-turn-metadata-empty-${RUN_ID}`;
  const emptySeed = await invokeE2E("seedPersistedCachedSession", {
    sessionId: emptySessionId,
    name: "Empty turn metadata E2E",
    category: "rust_agent",
    status: "completed",
    events: [
      withCreatedAt(makeUserEvent(emptySessionId, `empty-${RUN_ID}`), baseTime),
      withCreatedAt(
        makeAssistantEvent(emptySessionId, `empty-${RUN_ID}`),
        baseTime + 1_000
      ),
    ],
  });
  if (!emptySeed || emptySeed.ok !== true) {
    throw new Error(
      `empty turn metadata seed failed: ${emptySeed?.error ?? "unknown"}`
    );
  }
  const emptyOpened = await invokeE2E("openSession", emptySessionId);
  if (!emptyOpened || emptyOpened.ok !== true) {
    throw new Error(
      `empty turn metadata open failed: ${emptyOpened?.error ?? "unknown"}`
    );
  }
  await browser.waitUntil(
    async () =>
      execJS(
        `return !!document.querySelector('[data-testid="turn-metadata-empty"]');`
      ),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg:
        "completed no-edit round did not render its empty metadata state",
    }
  );
}

async function assertKanbanSessionSearchRendered() {
  const opened = await invokeE2E("openWorkManagementTab");
  if (!opened || opened.ok !== true) {
    throw new Error(
      `open work management failed: ${opened?.error ?? "unknown"}`
    );
  }
  await browser.waitUntil(
    async () =>
      execJS(
        `return !!document.querySelector('[data-testid="kanban-search-input"] input');`
      ),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "Kanban session search input did not render",
    }
  );

  const alphaTitle = `Metadata alpha ${RUN_ID}`;
  const betaTitle = `Metadata beta ${RUN_ID}`;
  for (const fixture of [
    {
      sessionId: `sdeagent-e2e-session-search-alpha-${RUN_ID}`,
      name: alphaTitle,
      touchedFiles: ["src/features/metadata/SessionRoundMetadata.tsx"],
    },
    {
      sessionId: `sdeagent-e2e-session-search-beta-${RUN_ID}`,
      name: betaTitle,
      touchedFiles: ["src/engines/kanban/searchIndex.rs"],
    },
  ]) {
    const seed = await invokeE2E("seedSidebarSession", fixture);
    if (!seed || seed.ok !== true) {
      throw new Error(`Kanban search seed failed: ${seed?.error ?? "unknown"}`);
    }
  }

  const cardTitles = () =>
    execJS(`
      return Array.from(document.querySelectorAll('.kanban-task-card'))
        .map((card) => card.innerText || '');
    `);
  const listTitles = () =>
    execJS(`
      return Array.from(document.querySelectorAll('[data-testid="kanban-list-session-row"]'))
        .map((row) => row.innerText || '');
    `);
  const setSessionSearch = async (value) => {
    const focused = await execJS(`
      const input = document.querySelector('[data-testid="kanban-search-input"] input');
      if (!(input instanceof HTMLInputElement)) return false;
      input.focus();
      input.select();
      return document.activeElement === input;
    `);
    if (!focused) {
      throw new Error("failed to focus the rendered Kanban session search");
    }

    await browser.keys("Backspace");
    if (value) await browser.keys(value);
    await browser.waitUntil(
      async () =>
        execJS(
          `return document.querySelector('[data-testid="kanban-search-input"] input')?.value === ${JSON.stringify(value)};`
        ),
      {
        timeout: RENDER_TIMEOUT_MS,
        timeoutMsg: `Kanban session search did not accept ${value}`,
      }
    );
  };
  await browser.waitUntil(
    async () => {
      const titles = await cardTitles();
      return (
        titles.some((title) => title.includes(alphaTitle)) &&
        titles.some((title) => title.includes(betaTitle))
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "seeded Kanban search cards did not render",
    }
  );

  await setSessionSearch("METADATA ALPHA");
  try {
    await browser.waitUntil(
      async () => {
        const titles = await cardTitles();
        return (
          titles.some((title) => title.includes(alphaTitle)) &&
          !titles.some((title) => title.includes(betaTitle))
        );
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        timeoutMsg: "session-name fragment did not filter Kanban cards",
      }
    );
  } catch (error) {
    throw new Error(
      `${error.message}: ${JSON.stringify({
        inputValue: await execJS(
          `return document.querySelector('[data-testid="kanban-search-input"] input')?.value ?? null;`
        ),
        titles: await cardTitles(),
        body: await execJS(
          `return (document.body.innerText || '').slice(-3000);`
        ),
      })}`
    );
  }

  const listButton = await $('[data-testid="kanban-view-list"]');
  await listButton.waitForDisplayed({
    timeout: RENDER_TIMEOUT_MS,
    timeoutMsg: "Kanban List view button did not render",
  });
  await listButton.click();
  await browser.waitUntil(
    async () => {
      const titles = await listTitles();
      return (
        titles.some((title) => title.includes(alphaTitle)) &&
        !titles.some((title) => title.includes(betaTitle))
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "header query did not carry from Kanban cards into List rows",
    }
  );
  const duplicateListSearchCount = await execJS(
    `return document.querySelectorAll('input[type="search"]').length;`
  );
  if (duplicateListSearchCount !== 0) {
    throw new Error(
      `Kanban List rendered ${duplicateListSearchCount} duplicate full-width search inputs`
    );
  }

  await setSessionSearch("metadata beta");
  await browser.waitUntil(
    async () => {
      const titles = await listTitles();
      return (
        !titles.some((title) => title.includes(alphaTitle)) &&
        titles.some((title) => title.includes(betaTitle))
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "shared session-name query did not filter Kanban List rows",
    }
  );

  await setSessionSearch("searchIndex.rs");
  await browser.waitUntil(
    async () =>
      execJS(
        `return !!document.querySelector('[data-testid="kanban-search-empty"]');`
      ),
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg:
        "touched-file metadata incorrectly matched session-name search",
    }
  );

  await setSessionSearch("");
  await browser.waitUntil(
    async () => {
      const titles = await listTitles();
      return (
        titles.some((title) => title.includes(alphaTitle)) &&
        titles.some((title) => title.includes(betaTitle))
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      timeoutMsg: "clearing Kanban session search did not restore all sessions",
    }
  );
}

const VISIBLE_TRANSCRIPT_SCROLLER_EXPRESSION = `Array.from(
  document.querySelectorAll('[data-testid="chat-history-scroll-container"]')
).find((element) => {
  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
})`;

function makeLongRenderedText(marker, lineCount = 72) {
  return Array.from(
    { length: lineCount },
    (_, index) => `${marker}_${String(index).padStart(3, "0")} rendered line`
  ).join("\n\n");
}

function setUserEventText(event, text) {
  event.displayText = text;
  event.result = { ...event.result, message: text };
  return event;
}

function setAssistantEventText(event, text, status = "completed") {
  event.displayText = text;
  event.displayStatus = status;
  event.result = {
    ...event.result,
    content: text,
    observation: text,
    status,
  };
  return event;
}

function makeExpandFixtureEvents(sessionId, kind, marker) {
  const inConversationOrder = (events) => {
    const firstCreatedAt = Date.now() - events.length * 1_000;
    events.forEach((event, index) => {
      event.createdAt = new Date(firstCreatedAt + index * 1_000).toISOString();
    });
    return events;
  };
  const filler = Array.from({ length: 8 }, (_, index) => [
    makeUserEvent(sessionId, `expand-filler-${kind}-${index}`),
    makeAssistantEvent(sessionId, `expand-filler-${kind}-${index}`),
  ]).flat();
  const targetUser = makeUserEvent(sessionId, `expand-target-${kind}`);
  const runningTail = setAssistantEventText(
    makeAssistantEvent(sessionId, `expand-tail-${kind}`),
    makeLongRenderedText(`EXPAND_RUNNING_TAIL_${kind}_${RUN_ID}`, 40),
    "running"
  );

  if (kind === "user") {
    return {
      events: inConversationOrder([
        ...filler,
        setUserEventText(targetUser, makeLongRenderedText(marker)),
        runningTail,
      ]),
      runningTail,
      targetSelector: '[data-testid="chat-message-user-editable"]',
    };
  }

  if (kind === "code") {
    const code = Array.from(
      { length: 90 },
      (_, index) => `const ${marker}_${index} = ${index};`
    ).join("\n");
    return {
      events: inConversationOrder([
        ...filler,
        targetUser,
        setAssistantEventText(
          makeAssistantEvent(sessionId, `expand-target-${kind}`),
          `\`\`\`ts\n${code}\n\`\`\``
        ),
        runningTail,
      ]),
      runningTail,
      targetSelector: ".chat-code-block__code-container",
    };
  }

  if (kind === "tool") {
    const tool = makeToolEvent(sessionId, `expand-target-${kind}`, 0, {
      name: "manage_file_history",
      actions: [{ name: "list" }],
      chatBlock: "fallback",
    });
    const output = makeLongRenderedText(marker, 96);
    tool.uiCanonical = "manage_file_history";
    tool.displayText = output;
    tool.result = {
      ...tool.result,
      content: output,
      observation: output,
      output,
      stdout: output,
    };
    const closingAssistant = setAssistantEventText(
      makeAssistantEvent(sessionId, `expand-target-${kind}-done`),
      `Tool output fixture complete: ${marker}`
    );
    const events = inConversationOrder([
      ...filler,
      targetUser,
      tool,
      closingAssistant,
    ]);
    return {
      events,
      runningTail: closingAssistant,
      runtimeStatus: "idle",
      targetSelector: ".block-output__pre",
      toolEventId: tool.id,
    };
  }

  return {
    events: inConversationOrder([
      ...filler,
      targetUser,
      setAssistantEventText(
        makeAssistantEvent(sessionId, `expand-target-${kind}`),
        makeLongRenderedText(marker)
      ),
      runningTail,
    ]),
    runningTail,
    targetSelector: '[data-testid="chat-message-assistant"]',
  };
}

async function locateExpandTarget(targetSelector, marker, controlTag) {
  return execJS(`
    const scroller = ${VISIBLE_TRANSCRIPT_SCROLLER_EXPRESSION};
    const target = Array.from(document.querySelectorAll(${JSON.stringify(
      targetSelector
    )})).find((candidate) =>
      (candidate.textContent || '').includes(${JSON.stringify(marker)})
    );
    if (!scroller || !target) return null;
    let owner = target;
    let control = null;
    while (owner && owner !== scroller) {
      control = owner.querySelector('[data-testid="expand-overlay-toggle"]');
      if (control) break;
      owner = owner.parentElement;
    }
    const rootTop = scroller.getBoundingClientRect().top;
    const anchors = Array.from(
      scroller.querySelectorAll('[data-transcript-anchor-id]')
    );
    let closestAbove = null;
    let firstBelow = null;
    for (const candidate of anchors) {
      const rect = candidate.getBoundingClientRect();
      if (rect.bottom <= rootTop) continue;
      if (rect.top <= rootTop) {
        closestAbove = candidate;
        continue;
      }
      firstBelow = candidate;
      break;
    }
    const anchor = closestAbove || firstBelow;
    if (!control || !anchor) return null;
    const controlTag = ${JSON.stringify(controlTag)};
    control.setAttribute('data-e2e-expand-control', controlTag);
    control.__e2eExpandClickTags = control.__e2eExpandClickTags || new Set();
    if (!control.__e2eExpandClickTags.has(controlTag)) {
      control.__e2eExpandClickTags.add(controlTag);
      control.addEventListener('click', () => {
        const clickScroller = ${VISIBLE_TRANSCRIPT_SCROLLER_EXPRESSION};
        if (!clickScroller) return;
        const clickRootTop = clickScroller.getBoundingClientRect().top;
        const clickAnchors = Array.from(
          clickScroller.querySelectorAll('[data-transcript-anchor-id]')
        );
        let clickClosestAbove = null;
        let clickFirstBelow = null;
        for (const candidate of clickAnchors) {
          const rect = candidate.getBoundingClientRect();
          if (rect.bottom <= clickRootTop) continue;
          if (rect.top <= clickRootTop) {
            clickClosestAbove = candidate;
            continue;
          }
          clickFirstBelow = candidate;
          break;
        }
        const clickAnchor = clickClosestAbove || clickFirstBelow;
        if (!clickScroller || !clickAnchor) return;
        window.__e2eExpandClickPositions = window.__e2eExpandClickPositions || {};
        window.__e2eExpandClickPositions[controlTag] = {
          anchorId: clickAnchor.getAttribute('data-transcript-anchor-id'),
          anchorOffset:
            clickAnchor.getBoundingClientRect().top -
            clickScroller.getBoundingClientRect().top,
          scrollTop: clickScroller.scrollTop,
        };
      }, { capture: true, once: true });
    }
    return {
      anchorId: anchor.getAttribute('data-transcript-anchor-id'),
      anchorOffset: anchor.getBoundingClientRect().top - rootTop,
      expanded: control.getAttribute('aria-expanded'),
      scrollTop: scroller.scrollTop,
      tailTop: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    };
  `);
}

async function openToolOutput(toolEventId, label) {
  const headerTag = `tool-header-${label}-${RUN_ID}`;
  try {
    await browser.waitUntil(
      async () =>
        execJS(`
          const roots = Array.from(document.querySelectorAll(
            '[data-tool-call-event-id=${JSON.stringify(toolEventId)}]'
          ));
          const header = roots
            .flatMap((root) => Array.from(root.querySelectorAll('[role="button"][aria-expanded]')))
            .find((candidate) => candidate.getAttribute('aria-expanded') === 'false');
          if (!header) return false;
          header.setAttribute('data-e2e-tool-output-header', ${JSON.stringify(
            headerTag
          )});
          return true;
        `),
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 100,
        timeoutMsg: `${label} did not render its collapsed tool header`,
      }
    );
  } catch (error) {
    const diagnostics = await execJS(`
      return {
        toolRoots: Array.from(document.querySelectorAll('[data-tool-call-event-id]')).map((node) => ({
          id: node.getAttribute('data-tool-call-event-id'),
          name: node.getAttribute('data-tool-call-name'),
          text: (node.textContent || '').slice(0, 160),
        })),
        expandableHeaders: Array.from(document.querySelectorAll('[role="button"][aria-expanded]')).map((node) => ({
          expanded: node.getAttribute('aria-expanded'),
          text: (node.textContent || '').slice(0, 160),
        })),
        bodyTail: (document.body.innerText || '').slice(-2000),
      };
    `);
    throw new Error(
      `${label} did not render its collapsed tool header: ${JSON.stringify(diagnostics)}`,
      { cause: error }
    );
  }
  const header = await browser.$(
    `[data-e2e-tool-output-header="${headerTag}"]`
  );
  await header.click();
  await browser.waitUntil(
    async () =>
      execJS(`
        const header = document.querySelector(
          '[data-e2e-tool-output-header=${JSON.stringify(headerTag)}]'
        );
        return header?.getAttribute('aria-expanded') === 'true';
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      interval: 100,
      timeoutMsg: `${label} did not open its tool output`,
    }
  );
}

async function locateTurnCollapseControl(expanded, controlTag) {
  return execJS(`
    const scroller = ${VISIBLE_TRANSCRIPT_SCROLLER_EXPRESSION};
    if (!scroller) return null;
    const controls = Array.from(
      document.querySelectorAll('[data-testid="turn-collapse-toggle"]')
    ).filter((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    const control = controls
      .filter((candidate) => candidate.getAttribute('aria-expanded') === ${JSON.stringify(
        String(expanded)
      )})
      .at(-1);
    if (!control) return null;
    const rootTop = scroller.getBoundingClientRect().top;
    const anchors = Array.from(
      scroller.querySelectorAll('[data-transcript-anchor-id]')
    );
    let closestAbove = null;
    let firstBelow = null;
    for (const candidate of anchors) {
      const rect = candidate.getBoundingClientRect();
      if (rect.bottom <= rootTop) continue;
      if (rect.top <= rootTop) {
        closestAbove = candidate;
        continue;
      }
      firstBelow = candidate;
      break;
    }
    const anchor = closestAbove || firstBelow;
    if (!anchor) return null;
    const controlTag = ${JSON.stringify(controlTag)};
    control.setAttribute('data-e2e-turn-collapse-control', controlTag);
    control.__e2eTurnCollapseTags = control.__e2eTurnCollapseTags || new Set();
    if (!control.__e2eTurnCollapseTags.has(controlTag)) {
      control.__e2eTurnCollapseTags.add(controlTag);
      control.addEventListener('click', () => {
        const clickScroller = ${VISIBLE_TRANSCRIPT_SCROLLER_EXPRESSION};
        if (!clickScroller) return;
        const clickRootTop = clickScroller.getBoundingClientRect().top;
        const clickAnchors = Array.from(
          clickScroller.querySelectorAll('[data-transcript-anchor-id]')
        );
        let clickClosestAbove = null;
        let clickFirstBelow = null;
        for (const candidate of clickAnchors) {
          const rect = candidate.getBoundingClientRect();
          if (rect.bottom <= clickRootTop) continue;
          if (rect.top <= clickRootTop) {
            clickClosestAbove = candidate;
            continue;
          }
          clickFirstBelow = candidate;
          break;
        }
        const clickAnchor = clickClosestAbove || clickFirstBelow;
        if (!clickAnchor) return;
        window.__e2eTurnCollapseClickPositions =
          window.__e2eTurnCollapseClickPositions || {};
        window.__e2eTurnCollapseClickPositions[controlTag] = {
          anchorId: clickAnchor.getAttribute('data-transcript-anchor-id'),
          anchorOffset:
            clickAnchor.getBoundingClientRect().top -
            clickScroller.getBoundingClientRect().top,
          scrollTop: clickScroller.scrollTop,
        };
      }, { capture: true, once: true });
    }
    return {
      anchorId: anchor.getAttribute('data-transcript-anchor-id'),
      anchorOffset: anchor.getBoundingClientRect().top - rootTop,
      expanded: control.getAttribute('aria-expanded'),
      scrollTop: scroller.scrollTop,
      tailTop: Math.max(0, scroller.scrollHeight - scroller.clientHeight),
    };
  `);
}

async function clickTurnCollapseControl({ expanded, label }) {
  const controlTag = `turn-collapse-${label}-${expanded}-${RUN_ID}`;
  let before = null;
  await browser.waitUntil(
    async () => {
      before = await locateTurnCollapseControl(!expanded, controlTag);
      return Boolean(before?.anchorId);
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      interval: 100,
      timeoutMsg: `${label} turn collapse control was not ready`,
    }
  );
  if (!before?.anchorId) {
    throw new Error(
      `${label} turn collapse control was not ready: ${JSON.stringify(before)}`
    );
  }
  const control = await browser.$(
    `[data-e2e-turn-collapse-control="${controlTag}"]`
  );
  await control.moveTo();
  await control.click();
  const clickPosition = await execJS(`
    return window.__e2eTurnCollapseClickPositions?.[${JSON.stringify(
      controlTag
    )}] ?? null;
  `);
  if (!clickPosition?.anchorId) {
    throw new Error(`${label} did not record its click-time reading anchor`);
  }
  let latest = null;
  await browser.waitUntil(
    async () => {
      latest = await locateTurnCollapseControl(expanded, `wait-${controlTag}`);
      return Boolean(
        latest &&
        latest.anchorId === clickPosition.anchorId &&
        Math.abs(
          latest.anchorOffset -
            (clickPosition.anchorOffset +
              Math.max(0, clickPosition.scrollTop - latest.tailTop))
        ) <= 2
      );
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      interval: 100,
      timeoutMsg: `${label} did not preserve its reading anchor`,
    }
  );
  return clickPosition;
}

async function waitForLatestTurnCollapseState(label) {
  let state = null;
  await browser.waitUntil(
    async () => {
      state = await execJS(`
        const controls = Array.from(
          document.querySelectorAll('[data-testid="turn-collapse-toggle"]')
        ).filter((candidate) => {
          const rect = candidate.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        return controls.at(-1)?.getAttribute('aria-expanded') ?? null;
      `);
      return state === "true" || state === "false";
    },
    {
      timeout: RENDER_TIMEOUT_MS,
      interval: 100,
      timeoutMsg: `${label} did not render its turn collapse control`,
    }
  );
  return state === "true";
}

async function waitForTranscriptTail(label) {
  try {
    await browser.waitUntil(
      async () =>
        execJS(`
          const scroller = ${VISIBLE_TRANSCRIPT_SCROLLER_EXPRESSION};
          return Boolean(
            scroller &&
            scroller.scrollTop >= scroller.scrollHeight - scroller.clientHeight - 40
          );
        `),
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 100,
        timeoutMsg: `${label} did not settle at the transcript tail`,
      }
    );
  } catch (error) {
    const diagnostics = await execJS(`
      const scroller = ${VISIBLE_TRANSCRIPT_SCROLLER_EXPRESSION};
      return scroller ? {
        clientHeight: scroller.clientHeight,
        documentHasFocus: document.hasFocus(),
        documentVisibility: document.visibilityState,
        scrollHeight: scroller.scrollHeight,
        scrollTop: scroller.scrollTop,
        distanceFromNativeBottom:
          scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop,
        anchors: scroller.querySelectorAll('[data-transcript-anchor-id]').length,
      } : null;
    `);
    throw new Error(
      `${label} did not settle at the transcript tail: ${JSON.stringify(diagnostics)}`,
      { cause: error }
    );
  }
}

async function waitForExpandAnchor({
  targetSelector,
  marker,
  expanded,
  anchorId,
  anchorOffset,
  anchorScrollTop,
  label,
}) {
  let latest = null;
  try {
    await browser.waitUntil(
      async () => {
        latest = await locateExpandTarget(
          targetSelector,
          marker,
          `wait-${label}-${expanded}`
        );
        return Boolean(
          latest &&
          latest.expanded === String(expanded) &&
          latest.anchorId === anchorId &&
          Math.abs(
            latest.anchorOffset -
              (anchorOffset + Math.max(0, anchorScrollTop - latest.tailTop))
          ) <= 2
        );
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 100,
        timeoutMsg: `${label} did not preserve its reading anchor`,
      }
    );
  } catch (error) {
    const diagnostics = await execJS(`
      const scroller = ${VISIBLE_TRANSCRIPT_SCROLLER_EXPRESSION};
      return {
        scroller: scroller ? {
          clientHeight: scroller.clientHeight,
          scrollHeight: scroller.scrollHeight,
          scrollTop: scroller.scrollTop,
          anchors: Array.from(scroller.querySelectorAll('[data-transcript-anchor-id]')).map((node) => ({
            id: node.getAttribute('data-transcript-anchor-id'),
            top: node.getBoundingClientRect().top - scroller.getBoundingClientRect().top,
          })),
          expandStates: Array.from(scroller.querySelectorAll('[data-testid="expand-overlay-toggle"]')).map((node) => node.getAttribute('aria-expanded')),
        } : null,
        markerPresent: (document.body.textContent || '').includes(${JSON.stringify(marker)}),
      };
    `);
    throw new Error(
      `${label} moved the reading anchor: expected=${JSON.stringify({ anchorId, anchorOffset, anchorScrollTop, expanded })} latest=${JSON.stringify(latest)} diagnostics=${JSON.stringify(diagnostics)}`,
      { cause: error }
    );
  }
}

async function clickExpandControl({ targetSelector, marker, expanded, label }) {
  const controlTag = `expand-${label}-${expanded}-${RUN_ID}`;
  const before = await locateExpandTarget(targetSelector, marker, controlTag);
  if (!before?.anchorId || before.expanded !== String(!expanded)) {
    throw new Error(
      `${label} expand control was not ready: ${JSON.stringify(before)}`
    );
  }
  const control = await browser.$(`[data-e2e-expand-control="${controlTag}"]`);
  await control.moveTo();
  const settledBefore = await locateExpandTarget(
    targetSelector,
    marker,
    controlTag
  );
  if (!settledBefore?.anchorId) {
    throw new Error(`${label} lost its anchor before the click`);
  }
  await control.click();
  const clickPosition = await execJS(`
    return window.__e2eExpandClickPositions?.[${JSON.stringify(controlTag)}] ?? null;
  `);
  if (!clickPosition?.anchorId) {
    throw new Error(`${label} did not record its click-time reading anchor`);
  }
  await waitForExpandAnchor({
    targetSelector,
    marker,
    expanded,
    anchorId: clickPosition.anchorId,
    anchorOffset: clickPosition.anchorOffset,
    anchorScrollTop: clickPosition.scrollTop,
    label,
  });
  return clickPosition;
}

async function clickScrollToBottom(label) {
  await browser.waitUntil(
    async () =>
      execJS(`
        return Array.from(
          document.querySelectorAll('[data-testid="chat-scroll-to-bottom"]')
        ).some((button) => {
          const rect = button.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
      `),
    {
      timeout: RENDER_TIMEOUT_MS,
      interval: 100,
      timeoutMsg: `${label} did not expose the scroll-to-bottom control`,
    }
  );
  const clicked = await execJS(`
    const button = Array.from(
      document.querySelectorAll('[data-testid="chat-scroll-to-bottom"]')
    ).find((candidate) => {
      const rect = candidate.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });
    if (!button) return false;
    button.click();
    return true;
  `);
  if (!clicked) throw new Error(`${label} scroll-to-bottom click failed`);
  await waitForTranscriptTail(`${label} explicit follow`);
}

describe("Core chat rendering UI", () => {
  before(async () => {
    await waitForApp();
    const repo = await invokeE2E("ensureRepoSelected", {
      repoPath: E2E_REPO_PATH,
      repoName: "E2E Fixture Repo",
    });
    if (!repo || repo.ok !== true) {
      throw new Error(`ensureRepoSelected failed: ${repo?.error ?? "unknown"}`);
    }
    const navigation = await invokeE2E("navigateTo", "/orgii/workstation/code");
    if (!navigation || navigation.ok !== true) {
      throw new Error(`navigateTo failed: ${navigation?.error ?? "unknown"}`);
    }
  });

  it("renders all metadata-ledger tool-call classes from seeded history", async function () {
    if (!shouldRunScenario("metadata-ledger")) {
      this.skip();
      return;
    }

    const toolsResult = await invokeE2E("listAllTools");
    if (!toolsResult || toolsResult.ok !== true) {
      throw new Error(
        `listAllTools failed: ${toolsResult?.error ?? "unknown"}`
      );
    }

    const tools = renderableToolsFromMetadata(toolsResult.tools || []);
    const coveredBlocks = new Set(tools.map((tool) => tool.chatBlock));
    for (const requiredBlock of ["search", "read_file", "shell"]) {
      if (!coveredBlocks.has(requiredBlock)) {
        throw new Error(
          `tool render ledger missing ${requiredBlock}: ${tools.map((tool) => tool.name).join(", ")}`
        );
      }
    }
    const toolNames = new Set(tools.map((tool) => tool.name));
    for (const requiredTool of ["control_browser_with_agent_browser"]) {
      if (!toolNames.has(requiredTool)) {
        throw new Error(
          `tool render ledger missing ${requiredTool}: ${tools.map((tool) => tool.name).join(", ")}`
        );
      }
    }
    if (tools.length < 20) {
      throw new Error(
        `tool render ledger unexpectedly small: ${tools.map((tool) => tool.name).join(", ")}`
      );
    }

    const batches = chunk(tools, BATCH_SIZE);
    for (const [batchIndex, batchTools] of batches.entries()) {
      await assertBatchRendered(batchIndex, batchTools);
    }
  });

  it("pins background shell processes for the rendered chat session", async function () {
    if (!shouldRunScenario("background-process-pin")) {
      this.skip();
      return;
    }

    await assertBackgroundProcessPinnedToChatSession();
  });

  it("pins background subagent workers and drops them on completion", async function () {
    if (!shouldRunScenario("background-subagent-pin")) {
      this.skip();
      return;
    }

    await assertBackgroundSubagentPinnedToChatSession();
  });

  it("delivers subagent job events over the real broadcast wire and kills via the Stop command", async function () {
    if (!shouldRunScenario("background-subagent-pin-wire")) {
      this.skip();
      return;
    }

    await assertBackgroundSubagentWirePath();
  });

  it("does not show Stop or loading chrome for completed subagent cards", async function () {
    if (!shouldRunScenario("subagent-card-terminal")) {
      this.skip();
      return;
    }

    await assertCompletedSubagentCardIsTerminal();
  });

  it("cancels a running subagent from the rendered card Stop button", async function () {
    if (!shouldRunScenario("subagent-card-stop-wire")) {
      this.skip();
      return;
    }

    await assertSubagentCardStopUsesJobRegistryFallback();
  });

  it("shows the working footer when running events are hidden from chat", async function () {
    if (!shouldRunScenario("working-footer-hidden-running")) {
      this.skip();
      return;
    }

    await assertWorkingFooterShownForHiddenRunningEvent();
  });

  it("does not keep Stop active for stale hidden running events", async function () {
    if (!shouldRunScenario("stale-hidden-running-stop-state")) {
      this.skip();
      return;
    }

    await assertStaleHiddenRunningEventDoesNotHoldStopButton();
  });

  it("navigates to previous turn page on early-cancel Stop", async function () {
    if (!shouldRunScenario("early-cancel-turnpage-nav")) {
      this.skip();
      return;
    }

    await assertEarlyCancelStopNavigatesToPreviousTurnPage();
  });

  it("keeps a 100-round lazy skeleton navigable to the middle", async function () {
    if (!shouldRunScenario("hundred-round-skeleton")) {
      this.skip();
      return;
    }

    await assertOneHundredRoundSkeletonRemainsNavigable();
  });

  it("keeps the same reading anchor when rendered chat content expands or collapses", async function () {
    if (!shouldRunScenario("expand-collapse-reading-anchor")) {
      this.skip();
      return;
    }

    await exposeVisibleViewportLifecycleToDriver();

    const expandKinds =
      EXPAND_KIND_FILTER.length > 0
        ? EXPAND_KIND_FILTER
        : ["agent", "user", "code", "tool"];
    for (const kind of expandKinds) {
      const sessionId = `sdeagent-e2e-expand-${kind}-${RUN_ID}`;
      const marker = `EXPAND_${kind.toUpperCase()}_${RUN_ID}`;
      const fixture = makeExpandFixtureEvents(sessionId, kind, marker);
      const seeded = await invokeE2E(
        "seedChatEvents",
        sessionId,
        fixture.events,
        { runtimeStatus: fixture.runtimeStatus ?? "running" }
      );
      if (!seeded?.ok) {
        throw new Error(
          `${kind} expand seed failed: ${seeded?.error ?? "unknown"}`
        );
      }

      if (fixture.toolEventId) {
        const turnInitiallyExpanded = await waitForLatestTurnCollapseState(
          `${kind} fixture`
        );
        if (turnInitiallyExpanded) {
          await clickTurnCollapseControl({
            expanded: false,
            label: `${kind} initial turn collapse`,
          });
        }
        await clickTurnCollapseControl({
          expanded: true,
          label: `${kind} turn expand`,
        });
        await openToolOutput(fixture.toolEventId, `${kind} fixture`);
      }

      try {
        await browser.waitUntil(
          async () => {
            const state = await locateExpandTarget(
              fixture.targetSelector,
              marker,
              `ready-${kind}-${RUN_ID}`
            );
            return state?.expanded === "false";
          },
          {
            timeout: RENDER_TIMEOUT_MS,
            interval: 100,
            timeoutMsg: `${kind} did not render its real collapsed Expand control`,
          }
        );
      } catch (error) {
        const diagnostics = await execJS(`
          const targets = Array.from(document.querySelectorAll(${JSON.stringify(
            fixture.targetSelector
          )})).filter((candidate) =>
            (candidate.textContent || '').includes(${JSON.stringify(marker)})
          );
          return {
            markerPresent: (document.body.textContent || '').includes(${JSON.stringify(marker)}),
            targets: targets.map((target) => ({
              clientHeight: target.clientHeight,
              scrollHeight: target.scrollHeight,
              textLength: (target.textContent || '').length,
              toggles: target.querySelectorAll('[data-testid="expand-overlay-toggle"]').length,
              ancestorToggles: target.closest('[data-transcript-anchor-id]')?.querySelectorAll('[data-testid="expand-overlay-toggle"]').length ?? 0,
            })),
            renderedUserMessages: document.querySelectorAll('[data-testid="chat-message-user-editable"]').length,
          };
        `);
        throw new Error(
          `${kind} did not render its real collapsed Expand control: ${JSON.stringify(diagnostics)}`,
          { cause: error }
        );
      }
      await clickExpandControl({
        targetSelector: fixture.targetSelector,
        marker,
        expanded: true,
        label: `${kind} expand`,
      });

      if (kind === "agent") {
        const expandedPosition = await locateExpandTarget(
          fixture.targetSelector,
          marker,
          `streaming-${kind}-${RUN_ID}`
        );
        if (!expandedPosition?.anchorId) {
          throw new Error("agent expand lost its transcript anchor");
        }
        const streamedText = `${fixture.runningTail.displayText}\n\n${makeLongRenderedText(
          `EXPAND_STREAM_AFTER_CLICK_${RUN_ID}`,
          32
        )}`;
        const streamed = await invokeE2E(
          "streamChatEventText",
          sessionId,
          fixture.runningTail.id,
          streamedText
        );
        if (!streamed?.ok) {
          throw new Error(
            `agent post-expand stream failed: ${streamed?.error ?? "unknown"}`
          );
        }
        await waitForExpandAnchor({
          targetSelector: fixture.targetSelector,
          marker,
          expanded: true,
          anchorId: expandedPosition.anchorId,
          anchorOffset: expandedPosition.anchorOffset,
          anchorScrollTop: expandedPosition.scrollTop,
          label: "agent stream after historical expand",
        });
      }

      await clickExpandControl({
        targetSelector: fixture.targetSelector,
        marker,
        expanded: false,
        label: `${kind} collapse`,
      });
      if (fixture.toolEventId) {
        await clickTurnCollapseControl({
          expanded: false,
          label: `${kind} turn collapse`,
        });
      }
      if (!fixture.toolEventId) {
        await clickScrollToBottom(`${kind} collapse`);
      }

      if (kind === "agent") {
        const resumedText = `${fixture.runningTail.displayText}\n\n${makeLongRenderedText(
          `EXPAND_STREAM_AFTER_FOLLOW_${RUN_ID}`,
          12
        )}`;
        const resumed = await invokeE2E(
          "streamChatEventText",
          sessionId,
          fixture.runningTail.id,
          resumedText
        );
        if (!resumed?.ok) {
          throw new Error(
            `agent resumed stream failed: ${resumed?.error ?? "unknown"}`
          );
        }
        await waitForTranscriptTail("agent stream after explicit follow");
      }
    }
  });

  it("keeps manual scroll position while the rendered transcript grows", async function () {
    if (!shouldRunScenario("streaming-manual-scroll-pin")) {
      this.skip();
      return;
    }

    await exposeVisibleViewportLifecycleToDriver();

    const sessionId = `sdeagent-e2e-stream-scroll-${RUN_ID}`;
    const visibleScrollerExpression = `Array.from(
      document.querySelectorAll('[data-testid="chat-history-scroll-container"]')
    ).find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    })`;
    const marker = `STREAM_SCROLL_HISTORY_${RUN_ID}`;
    const fixture = makeExpandFixtureEvents(sessionId, "agent", marker);
    const last = fixture.runningTail;
    const seeded = await invokeE2E(
      "seedChatEvents",
      sessionId,
      fixture.events,
      { runtimeStatus: "running" }
    );
    if (!seeded?.ok) {
      throw new Error(
        `stream-scroll initial seed failed: ${seeded?.error ?? "unknown"}`
      );
    }

    await browser.waitUntil(
      async () => {
        const state = await locateExpandTarget(
          fixture.targetSelector,
          marker,
          `ready-stream-scroll-${RUN_ID}`
        );
        return state?.expanded === "false";
      },
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 100,
        timeoutMsg: "stream-scroll history did not render its Expand control",
      }
    );
    await clickExpandControl({
      targetSelector: fixture.targetSelector,
      marker,
      expanded: true,
      label: "stream-scroll history expand",
    });
    await clickScrollToBottom("stream-scroll setup");
    const movedByWheel = await execJS(`
      const scroller = ${visibleScrollerExpression};
      if (!scroller) return false;
      scroller.dispatchEvent(
        new WheelEvent('wheel', { bubbles: true, deltaY: -120 })
      );
      scroller.scrollTo({
        top: Math.max(0, scroller.scrollTop - scroller.clientHeight * 2.7),
        behavior: 'auto',
      });
      scroller.dispatchEvent(new Event('scroll', { bubbles: true }));
      return true;
    `);
    if (!movedByWheel) {
      throw new Error("detached-reading setup could not find the transcript");
    }
    await browser.waitUntil(
      async () =>
        execJS(`
          const scroller = ${visibleScrollerExpression};
          return Boolean(
            scroller &&
            scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - 100
          );
        `),
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 100,
        timeoutMsg: "detached-reading setup did not move the transcript reader",
      }
    );
    await browser.pause(250);
    const readerPosition = await execJS(`
      const scroller = ${visibleScrollerExpression};
      if (!scroller) return null;
      const rootTop = scroller.getBoundingClientRect().top;
      const anchor = Array.from(scroller.querySelectorAll('[data-transcript-anchor-id]'))
        .find((element) => element.getBoundingClientRect().bottom > rootTop);
      return anchor
        ? {
            id: anchor.getAttribute('data-transcript-anchor-id'),
            offset: anchor.getBoundingClientRect().top - rootTop,
          }
        : null;
    `);
    if (!readerPosition?.id) {
      throw new Error("stream-scroll could not resolve a stable reader anchor");
    }

    const streamedMarker = `STREAM_SCROLL_DELTA_${RUN_ID}`;
    const streamedText = `${last.displayText}\n\n${Array.from(
      { length: 24 },
      (_, index) => `${streamedMarker}_${index}`
    ).join("\n\n")}`;
    const updated = await invokeE2E(
      "streamChatEventText",
      sessionId,
      last.id,
      streamedText
    );
    if (!updated?.ok) {
      throw new Error(
        `stream-scroll delta update failed: ${updated?.error ?? "unknown"}`
      );
    }

    await browser.waitUntil(
      async () =>
        execJS(`
          const scroller = ${visibleScrollerExpression};
          const scrollButton = document.querySelector(
            '[data-testid="chat-scroll-to-bottom"]'
          );
          if (!scroller || !scrollButton) return false;
          const rootTop = scroller.getBoundingClientRect().top;
          const anchor = Array.from(scroller.querySelectorAll('[data-transcript-anchor-id]'))
            .find((element) => element.getAttribute('data-transcript-anchor-id') === ${JSON.stringify(
              readerPosition.id
            )});
          return Boolean(
            anchor &&
            Math.abs((anchor.getBoundingClientRect().top - rootTop) - ${JSON.stringify(
              readerPosition.offset
            )}) <= 2
          );
        `),
      {
        timeout: RENDER_TIMEOUT_MS,
        interval: 100,
        timeoutMsg:
          "transcript growth forced the manually-scrolled history back to the bottom",
      }
    );
    await clickScrollToBottom("stream-scroll detached reader");
    const finalState = await invokeE2E("inspectChatState");
    if (
      !finalState?.ok ||
      !JSON.stringify(finalState).includes(streamedMarker)
    ) {
      throw new Error("stream-scroll delta never entered canonical chat state");
    }
  });

  it("lazily loads an imported Claude Code round body and auto-refetches it after a replace reload", async function () {
    if (!shouldRunScenario("claude-imported-lazy-replay")) {
      this.skip();
      return;
    }

    await assertImportedClaudeHistoryLazyReplayAndAutoRefresh();
  });

  it("renders multi-repo read file targets as paths instead of generic file labels", async function () {
    if (!shouldRunScenario("multi-repo-read-path")) {
      this.skip();
      return;
    }

    await assertMultiRepoReadPathRendered();
  });

  it("greps the explicitly targeted sibling repo in a multi-repo workspace", async function () {
    if (!shouldRunScenario("multi-repo-grep-path")) {
      this.skip();
      return;
    }

    await assertMultiRepoGrepTargetsExplicitRepoPath();
  });

  it("renders explicit multi-repo search targets with root-qualified labels", async function () {
    if (!shouldRunScenario("multi-repo-search-target")) {
      this.skip();
      return;
    }

    await assertMultiRepoSearchTargetRendered();
  });

  it("renders repo-disambiguated paths for multi-repo tool rows", async function () {
    if (!shouldRunScenario("multi-repo-rendered-path-context")) {
      this.skip();
      return;
    }

    await assertMultiRepoRenderedPathContext();
  });

  it("renders a duplicated thought/answer segment pair only once", async function () {
    if (!shouldRunScenario("dedup")) {
      this.skip();
      return;
    }

    await assertDedupRenderedOnce();
  });

  it("preserves OpenCode subagent assignment and assistant answer after reload", async function () {
    if (!shouldRunScenario("opencode-subagent-reload")) {
      this.skip();
      return;
    }

    await assertOpenCodeSubagentReloadKeepsAnswerAndAssignment();
  });

  it("renders thinking in chronological turn position without duplicates", async function () {
    if (!shouldRunScenario("thinking-order")) {
      this.skip();
      return;
    }

    await assertThinkingChronologicalOrder();
  });

  it("renders DB-materialized files, commits, PRs, and the no-change state per round", async function () {
    if (!shouldRunScenario("turn-metadata")) {
      this.skip();
      return;
    }

    await assertTurnMetadataFooterRendered();
  });

  it("filters rendered Kanban and List sessions by session name", async function () {
    if (!shouldRunScenario("kanban-session-search", ["kanban-file-search"])) {
      this.skip();
      return;
    }

    await assertKanbanSessionSearchRendered();
  });
});
