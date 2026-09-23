/* global browser, process */
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  RUN_ID,
  clickRenderedMemberSwitcher,
  configureCreatorForDefaultAgentOrg,
  execJS,
  getApiAccount,
  invokeE2E,
  js,
  openRenderedSidebarSession,
  selectPreferredModel,
  selectRenderedDefaultAgentOrg,
  selectRenderedExecMode,
  sendFromRenderedCreator,
  unwrap,
  waitForAgentOrgRunView,
  waitForApp,
} from "./agentOrgUiDriver.mjs";

function rows(sql) {
  if (!process.env.E2E_ORGII_HOME)
    throw new Error(
      "Terminal evidence requires an explicit isolated application home"
    );
  return JSON.parse(
    execFileSync(
      "sqlite3",
      [
        "-readonly",
        "-cmd",
        ".timeout 3000",
        "-json",
        join(process.env.E2E_ORGII_HOME, "sessions.db"),
        sql,
      ],
      { encoding: "utf8" }
    ) || "[]"
  );
}
const literal = (value) => `'${String(value).replaceAll("'", "''")}'`;

export async function runFormalTerminalScenario(kind) {
  if ((process.env.E2E_PROVIDER_MODE ?? "mock") !== "mock") {
    throw new Error(
      "Deterministic terminal windows require the mock provider; live acceptance is separate"
    );
  }
  await invokeE2E("resetToNewSession");
  const account = await getApiAccount();
  await configureCreatorForDefaultAgentOrg({
    account,
    model: selectPreferredModel(account),
  });
  await selectRenderedExecMode("build");
  await selectRenderedDefaultAgentOrg();
  // The rendered launch and fake provider tool calls create the formal work.
  // No fixture writes a Task, terminal status, or completion certificate.
  const marker = `${kind}_${RUN_ID}`;
  const failed = kind === "failure" || kind === "panic";
  const root = await sendFromRenderedCreator(
    `Run E2E_AGENT_ORG_TERMINAL:${marker}`
  );
  if (!root)
    throw new Error("Rendered terminal launch did not create a session");
  let task;
  let runId;
  await waitForAgentOrgRunView(
    root,
    (view) => {
      runId = view?.context?.runId;
      task = (view?.tasks ?? []).find((row) => row.subject.includes(marker));
      return Boolean(task && runId);
    },
    "formal Task created through production dispatch"
  );
  let execution;
  await browser.waitUntil(
    async () => {
      execution =
        rows(`SELECT context.session_id,context.turn_intent_id,intent.status
      FROM agent_org_runtime_turn_contexts context JOIN session_turn_intents intent
      ON intent.session_id=context.session_id AND intent.turn_intent_id=context.turn_intent_id
      WHERE context.org_run_id=${literal(runId)} AND context.task_id=${literal(task.id)}
      AND context.turn_kind='task_execution' ORDER BY context.created_at LIMIT 1`)[0];
      return Boolean(execution);
    },
    {
      timeout: 30000,
      interval: 150,
      timeoutMsg:
        "Formal execution never obtained its exact persisted identity",
    }
  );
  await clickRenderedMemberSwitcher("sde-reviewer", execution.session_id);
  let toolProcessEvidence = [];
  if (!failed) {
    const windowMarker =
      kind === "stream"
        ? "TERMINAL_STREAM_STARTED"
        : "Finite synchronous tool Stop window";
    await browser.waitUntil(
      async () => {
        const text = await execJS(`return document.body.innerText;`);
        if (!String(text).includes(windowMarker)) return false;
        if (kind === "tool") {
          const state = unwrap(
            await invokeE2E("inspectChatState"),
            "inspect running synchronous tool"
          );
          const invocationPresent = (state.rawEvents ?? []).some((event) =>
            JSON.stringify(event.args).includes("TERMINAL_TOOL_STARTED")
          );
          toolProcessEvidence = execFileSync(
            "ps",
            ["-axo", "pid,ppid,command"],
            { encoding: "utf8" }
          )
            .split("\n")
            .filter(
              (line) =>
                line.includes("printf 'TERMINAL_TOOL_STARTED") &&
                line.includes("sleep 45")
            );
          return invocationPresent && toolProcessEvidence.length > 0;
        }
        return true;
      },
      {
        timeout: 30000,
        interval: 150,
        timeoutMsg: `Rendered ${kind} execution window did not appear`,
      }
    );
    const stopSelector = '[data-testid="chat-send-button"][data-state="stop"]';
    await browser.waitUntil(
      async () =>
        execJS(`
      return Array.from(document.querySelectorAll(${JSON.stringify(stopSelector)})).some(button =>
        !button.disabled && button.getBoundingClientRect().width > 0 && button.getBoundingClientRect().height > 0);
    `),
      {
        timeout: 10000,
        timeoutMsg: "Rendered Member Stop button did not become actionable",
      }
    );
    // WebDriver's isDisplayed script cannot marshal WKWebView nodes reliably.
    // This dispatches the existing rendered control, not a backend Stop helper.
    const clicked = await execJS(js.visibleClick(stopSelector));
    if (clicked !== "clicked")
      throw new Error(`Rendered Member Stop did not click: ${clicked}`);
  }
  const expected = failed ? "failed" : "cancelled";
  let terminal;
  await browser.waitUntil(
    async () => {
      terminal =
        rows(`SELECT intent.status,session.last_terminal_turn_id,session.last_terminal_turn_status
      FROM session_turn_intents intent JOIN agent_sessions session USING(session_id)
      WHERE intent.session_id=${literal(execution.session_id)} AND intent.turn_intent_id=${literal(execution.turn_intent_id)}`)[0];
      return (
        terminal?.status === expected &&
        terminal?.last_terminal_turn_status === expected
      );
    },
    {
      timeout: 60000,
      interval: 200,
      timeoutMsg: `Exact terminal did not persist as ${expected}`,
    }
  );
  const recovery =
    rows(`SELECT attempts FROM agent_org_runtime_recovery_attempts
    WHERE org_run_id=${literal(runId)} AND action_kind='task_failure_recovery' AND target_key=${literal(task.id)}`);
  if (!failed && recovery.length)
    throw new Error(
      `Stop entered provider failure recovery: ${JSON.stringify(recovery)}`
    );
  if (failed) {
    const boundTask = rows(
      `SELECT status,owner FROM agent_org_runtime_tasks WHERE org_run_id=${literal(runId)} AND id=${literal(task.id)}`
    )[0];
    if (boundTask?.status !== "pending" || boundTask?.owner !== null)
      throw new Error(
        `Provider failure did not release only its bound task: ${JSON.stringify(boundTask)}`
      );
    const errors = rows(
      `SELECT id,result_json FROM events WHERE session_id=${literal(execution.session_id)} AND function_name='system'`
    );
    if (
      !errors.some(
        (event) =>
          JSON.parse(event.result_json).turnIntentId ===
          execution.turn_intent_id
      )
    ) {
      throw new Error(
        `Durable provider error lost exact execution identity: ${JSON.stringify(errors)}`
      );
    }
  }
  await browser.waitUntil(
    async () => {
      const state = unwrap(
        await invokeE2E("inspectChatState"),
        "inspect terminal member view"
      );
      return (
        state.activeSessionId === execution.session_id && !state.isSessionActive
      );
    },
    {
      timeout: 20000,
      interval: 200,
      timeoutMsg: "Member view remained active after terminal persistence",
    }
  );
  if (failed) {
    const errorMarker =
      kind === "panic"
        ? "E2E_TERMINAL_PROVIDER_PANIC"
        : "E2E_TERMINAL_PROVIDER_FAILURE";
    await browser.waitUntil(
      async () => {
        const text = await execJS(`return document.body.textContent;`);
        return String(text).includes(errorMarker);
      },
      {
        timeout: 20000,
        interval: 200,
        timeoutMsg: "Durable member failure did not render",
      }
    );
  }
  if (failed) {
    // Reloading a WKWebView poisons tauri-webdriver-automation 0.1.3's
    // pending-script mutex. A full app restart verifies durable recovery
    // with a new driver/plugin process and the same isolated database.
    await browser.reloadSession();
    await waitForApp();
    await openRenderedSidebarSession(root);
    await clickRenderedMemberSwitcher("sde-reviewer", execution.session_id);
    await browser.waitUntil(
      async () => {
        const state = unwrap(
          await invokeE2E("inspectChatState"),
          "reload failed execution"
        );
        const errorMarker =
          kind === "panic"
            ? "E2E_TERMINAL_PROVIDER_PANIC"
            : "E2E_TERMINAL_PROVIDER_FAILURE";
        const rendered = await execJS(`return document.body.innerText;`);
        return (
          state.activeSessionId === execution.session_id &&
          (state.rawEvents ?? []).some(
            (event) => event.result?.turnIntentId === execution.turn_intent_id
          ) &&
          String(rendered).includes(errorMarker)
        );
      },
      {
        timeout: 20000,
        interval: 250,
        timeoutMsg: "Reloaded error lost its exact failed execution",
      }
    );
  }
  if (process.env.E2E_EVIDENCE_DIR) {
    mkdirSync(process.env.E2E_EVIDENCE_DIR, { recursive: true });
    await browser.saveScreenshot(
      join(process.env.E2E_EVIDENCE_DIR, `terminal-${marker}.png`)
    );
  }
  console.log(
    `[terminal-evidence] ${JSON.stringify({ kind, root, runId, execution, terminal, recovery, toolProcessEvidence })}`
  );
}

export async function captureTerminalFailure(label) {
  if (!process.env.E2E_EVIDENCE_DIR) return;
  const directory = process.env.E2E_EVIDENCE_DIR;
  mkdirSync(directory, { recursive: true });
  const name = label.replace(/[^a-zA-Z0-9]+/g, "-");
  // Diagnostics never convert the original failing assertion into a pass.
  try {
    const state = await invokeE2E("inspectChatState");
    const rendered = await execJS(`return {
      body: document.body.innerText.slice(-20000),
      controls: Array.from(document.querySelectorAll('[data-testid]')).map(node => ({
        id:node.getAttribute('data-testid'), state:node.getAttribute('data-state'),
        width:node.getBoundingClientRect().width, height:node.getBoundingClientRect().height
      })).slice(-300)
    };`);
    writeFileSync(
      join(directory, name + ".json"),
      JSON.stringify({ state, rendered }, null, 2)
    );
    await browser.saveScreenshot(join(directory, name + ".png"));
  } catch (error) {
    console.error("[terminal-diagnostics]", String(error));
  }
}
