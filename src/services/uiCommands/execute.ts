import {
  uiCommands,
  uiSchemas,
} from "@src/scaffold/ActionSystem/publicUi/catalog";
import type {
  WorkStationTab,
  WorkstationWorkspaceKey,
} from "@src/store/workstation/tabs/types";

import { failure } from "./protocol";
import type { UiRequest, UiResponse, UiWorkspace } from "./protocol";
import type { TerminalOperations } from "./terminals";

export interface UiDependencies {
  terminal: TerminalOperations;
  permitted(): boolean;
  active(): Promise<boolean>;
  // Takes the protocol's workspace, not the app's wider key: a `directory`
  // target cannot exist on the wire, and typing it wider would resurrect a
  // branch that no request can reach.
  resolveWorkspace(workspace: UiWorkspace): { repoPath?: string };
  context(): unknown;
  tabs(workspace: WorkstationWorkspaceKey): WorkStationTab[];
  partition(tab: WorkStationTab): "shared" | "workspace";
  prepareFile(path: string, repoPath?: string): Promise<string>;
  openFile(
    path: string,
    line: number | undefined,
    workspace: WorkstationWorkspaceKey
  ): WorkStationTab;
  openBuiltin(
    kind: "explorer" | "source-control",
    workspace: WorkstationWorkspaceKey
  ): WorkStationTab;
  openWeb(
    url: string,
    workspace: WorkstationWorkspaceKey
  ): { tab: WorkStationTab; created: boolean };
  focus(tab: WorkStationTab, workspace: WorkstationWorkspaceKey): void;
  reveal(tab: WorkStationTab, workspace: WorkstationWorkspaceKey): boolean;
}
class CommandError extends Error {
  constructor(
    readonly code: string,
    message: string
  ) {
    super(message);
  }
}
export async function executeUiRequest(
  request: UiRequest,
  deps: UiDependencies
): Promise<UiResponse> {
  const command = uiCommands.find((entry) => entry.id === request.command);
  if (!command)
    return failure(request, "INVALID_PARAMS", "Unknown public UI command");
  const parsed = uiSchemas[command.id].safeParse(request.params);
  if (!parsed.success)
    return failure(request, "INVALID_PARAMS", parsed.error.message);
  // Enforce on the declared tier rather than on "is this a mutation", so the
  // set of gated capabilities is a list one can read rather than a negation
  // that silently absorbs every tier added later. `terminal.read` is
  // deliberately NOT here: `permitted()` is the presentation permission, and
  // reads are allowed while presentation is off (see the "allows bounded
  // terminal reads while presentation is disabled" test). It is nonetheless
  // its own tier now — scrollback is not the same disclosure as tab titles —
  // so gating it later is a one-line change rather than a redesign.
  const gated =
    command.capability === "ui.present" ||
    command.capability === "terminal.write";
  const workspace = request.target.workspace;
  const check = async () => {
    if (gated && !deps.permitted())
      throw new CommandError(
        "CAPABILITY_DENIED",
        "ADE Manager is off; UI control is disabled"
      );
    if (!(await deps.active()))
      throw new CommandError(
        "DEADLINE_EXCEEDED",
        "Request is no longer active"
      );
    // Recheck after await: revoked permissions or deleted sessions cannot commit.
    if (gated && !deps.permitted())
      throw new CommandError(
        "CAPABILITY_DENIED",
        "UI control permission was revoked"
      );
    return deps.resolveWorkspace(workspace);
  };
  try {
    const context = await check();
    const params = parsed.data;
    let result: unknown;
    if (command.id === "ui.context") result = deps.context();
    else if (command.id === "ui.terminal.list") {
      const { limit = 50, cursor = 0 } = params as {
        limit?: number;
        cursor?: number;
      };
      result = deps.terminal.list(workspace, limit, cursor);
    } else if (
      [
        "ui.terminal.read",
        "ui.terminal.execute",
        "ui.terminal.input",
        "ui.terminal.interrupt",
      ].includes(command.id)
    ) {
      result = await deps.terminal.io();
      if (command.id === "ui.terminal.read") await check();
    } else if (
      ["ui.terminal.open", "ui.terminal.new", "ui.terminal.focus"].includes(
        command.id
      )
    ) {
      const mode = command.id.slice("ui.terminal.".length) as
        | "open"
        | "new"
        | "focus";
      const opened = deps.terminal.open(
        mode,
        workspace,
        params as { terminalId?: string; name?: string },
        context.repoPath
      );
      const present = request.reveal || mode === "focus";
      result = {
        ...opened,
        tab: { tabId: opened.tab.id, partition: deps.partition(opened.tab) },
        revealed: present ? deps.reveal(opened.tab, workspace) : false,
        presentationState: present ? "requested" : "unchanged",
      };
    } else if (command.id === "ui.tabs.list") {
      const { limit = 50, cursor = 0 } = params as {
        limit?: number;
        cursor?: number;
      };
      const tabs = deps.tabs(workspace);
      result = {
        tabs: tabs.slice(cursor, cursor + limit).map((tab) => ({
          tabId: tab.id,
          partition: deps.partition(tab),
          title: tab.title,
          type: tab.type,
        })),
        nextCursor: cursor + limit < tabs.length ? cursor + limit : null,
      };
    } else {
      let tab: WorkStationTab;
      let created = false;
      if (command.id === "ui.file.open") {
        const { path, line } = params as { path: string; line?: number };
        const canonical = await deps.prepareFile(path, context.repoPath);
        const next = await check();
        if (context.repoPath !== next.repoPath)
          throw new CommandError(
            "TARGET_NOT_FOUND",
            "Target repository changed during file preparation"
          );
        created = !deps
          .tabs(workspace)
          .some((t) => t.type === "file" && t.data.filePath === canonical);
        tab = deps.openFile(canonical, line, workspace);
      } else if (command.id === "ui.web.open") {
        const { url } = params as { url: string };
        const parsedUrl = new URL(url);
        if (
          !["https:", "http:"].includes(parsedUrl.protocol) ||
          parsedUrl.username ||
          parsedUrl.password
        )
          throw new CommandError(
            "INVALID_PARAMS",
            "Use an HTTP(S) URL without embedded credentials"
          );
        // Shared Browser resources are reused by the browser adapter.
        ({ tab, created } = deps.openWeb(parsedUrl.href, workspace));
      } else if (command.id === "ui.tab.open") {
        const { kind } = params as { kind: "explorer" | "source-control" };
        created = !deps.tabs(workspace).some((t) => t.type === kind);
        tab = deps.openBuiltin(kind, workspace);
      } else {
        const { tabId, partition } = params as {
          tabId: string;
          partition: "shared" | "workspace";
        };
        const match = deps
          .tabs(workspace)
          .find((t) => t.id === tabId && deps.partition(t) === partition);
        if (!match)
          throw new CommandError(
            "TAB_NOT_FOUND",
            "Tab is not in the target workspace"
          );
        tab = match;
        deps.focus(tab, workspace);
      }
      const revealed =
        request.reveal || command.id === "ui.tab.focus"
          ? deps.reveal(tab, workspace)
          : false;
      result = {
        tab: { tabId: tab.id, partition: deps.partition(tab) },
        created,
        revealed,
        presentationState:
          request.reveal || command.id === "ui.tab.focus"
            ? "requested"
            : "unchanged",
        ...(tab.type === "file"
          ? {
              path: tab.data.filePath,
              contentState: "readable",
              ...(typeof tab.data.targetLine === "number"
                ? {
                    requestedLine: tab.data.targetLine,
                    locationState: "pending",
                  }
                : {}),
            }
          : {}),
        ...(tab.type === "browser-session"
          ? {
              browserSessionId: tab.data.sessionId,
              url: tab.data.url,
              contentState: "loading",
            }
          : {}),
      };
    }
    return {
      protocolVersion: 1,
      requestId: request.requestId,
      target: request.target,
      status: "applied",
      result,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = classify(error, message);
    const response = failure(request, code, message);
    if (code === "TERMINAL_WRITE_UNKNOWN") response.status = "unknown";
    return response;
  }
}

// Every code the wire may carry. Recovering a code from free message text
// left the set open — a `TERMINAL_`-prefixed message without a colon put its
// whole text on the wire as `error.code`, and any unrelated store error
// starting with `BUSY` was reclassified as a protocol BUSY. Throwers inside
// this module use CommandError; the Tauri boundary can only hand back a
// string, so its prefixes are matched against this closed set exactly once.
const BOUNDARY_CODES = [
  "TARGET_NOT_FOUND",
  "TARGET_NOT_PRESENTABLE",
  "TERMINAL_NOT_FOUND",
  "TERMINAL_NOT_READY",
  "TERMINAL_INVALID_INPUT",
  "TERMINAL_REQUEST_EXPIRED",
  "TERMINAL_WRITE_UNKNOWN",
  "FILE_NOT_FOUND",
  "FILE_NOT_READABLE",
  "BUSY",
] as const;

function classify(error: unknown, message: string): string {
  if (error instanceof CommandError) return error.code;
  const matched = BOUNDARY_CODES.find(
    (code) => message === code || message.startsWith(`${code}:`)
  );
  return matched ?? "EXECUTION_FAILED";
}
