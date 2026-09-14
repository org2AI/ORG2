import { getTerminalDisplayTitle } from "@src/engines/TerminalCore/types";
import type { TerminalSession } from "@src/engines/TerminalCore/types";
import {
  activeTerminalIdAtom,
  editorAddTerminalSessionAtom,
  setActiveTerminalAtom,
  terminalSessionsAtom,
  updateTerminalSessionInfoAtom,
} from "@src/store/workstation/codeEditor/terminal";
import { codeEditorTerminalTargetsAtom } from "@src/store/workstation/codeEditor/terminalTargetAtom";
import type { TerminalTargetWorkspaceId } from "@src/store/workstation/codeEditor/terminalTargetAtom";
import {
  CODE_EDITOR_MAIN_TERMINAL_SESSION_ID,
  CODE_EDITOR_MAIN_TERMINAL_TAB_ID,
  createTerminalTab,
  openWorkstationTabAtom,
  presentedWorkstationWorkspaceKeyAtom,
  selectWorkstationPanel,
  workstationTabsStateAtom,
} from "@src/store/workstation/tabs";
import type { WorkstationWorkspaceKey } from "@src/store/workstation/tabs/types";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";
import { invokeTauri } from "@src/util/platform/tauri/init";
import { isChatPanelTerminalId } from "@src/util/ui/terminal/chatPanelSessionId";
import { isAgentPtySessionId } from "@src/util/ui/terminal/ptySessionId";

import type { UiRequest } from "./protocol";

const key = (workspace: WorkstationWorkspaceKey): TerminalTargetWorkspaceId =>
  workspace.kind === "global" ? "global" : `session:${workspace.sessionId}`;
const eligible = (session: TerminalSession) =>
  !session.readOnly &&
  !session.agentSessionId &&
  !isAgentPtySessionId(session.id) &&
  !isChatPanelTerminalId(session.id);

/** Resource IDs are global; remembered selection is written to the explicit workspace. */
export function createTerminalOperations(
  generation: string,
  request: UiRequest
) {
  const store = getInstrumentedStore();
  const sessions = () => store.get(terminalSessionsAtom).filter(eligible);
  const requireSession = (id: string) => {
    const session = sessions().find((item) => item.id === id);
    if (!session)
      throw new Error("TERMINAL_NOT_FOUND: Use an ID from terminal list");
    return session;
  };
  const selected = (workspace: WorkstationWorkspaceKey) => {
    const target = store.get(codeEditorTerminalTargetsAtom)[key(workspace)];
    return target?.kind === "pty" ? target.ptySessionId : undefined;
  };
  return {
    list(workspace: WorkstationWorkspaceKey, limit: number, cursor: number) {
      const all = sessions();
      return {
        resourceScope: "instance",
        selectedTerminalId: selected(workspace) ?? null,
        terminals: all.slice(cursor, cursor + limit).map((session) => ({
          terminalId: session.id,
          title: getTerminalDisplayTitle(session).slice(0, 80),
          state: "registered",
        })),
        nextCursor: cursor + limit < all.length ? cursor + limit : null,
      };
    },
    open(
      mode: "open" | "new" | "focus",
      workspace: WorkstationWorkspaceKey,
      params: { terminalId?: string; name?: string },
      repoPath?: string
    ) {
      const isPresented =
        key(store.get(presentedWorkstationWorkspaceKeyAtom)) === key(workspace);
      let id = params.terminalId;
      let created = false;
      if (mode === "new") {
        if (!isPresented)
          throw new Error(
            "TARGET_NOT_PRESENTABLE: New terminals require the presented workspace"
          );
        const previous = new Set(sessions().map((session) => session.id));
        id = store.set(editorAddTerminalSessionAtom, {
          name: params.name,
          cwd: repoPath,
        });
        if (previous.has(id))
          throw new Error(
            "BUSY: Terminal creation cooldown; no new terminal was created"
          );
        created = true;
      }
      if (!id) {
        const all = sessions();
        id = [
          selected(workspace),
          store.get(activeTerminalIdAtom),
          all[0]?.id,
        ].find((candidate) => all.some((session) => session.id === candidate));
      }
      const session = requireSession(id ?? "");
      const workspaceId = key(workspace);
      store.set(codeEditorTerminalTargetsAtom, {
        ...store.get(codeEditorTerminalTargetsAtom),
        [workspaceId]: { kind: "pty", ptySessionId: session.id },
      });
      if (isPresented) store.set(setActiveTerminalAtom, session.id);
      const existing = selectWorkstationPanel(
        store.get(workstationTabsStateAtom),
        workspace
      ).tabs.find((tab) => tab.id === CODE_EDITOR_MAIN_TERMINAL_TAB_ID);
      const tab =
        existing ??
        createTerminalTab(CODE_EDITOR_MAIN_TERMINAL_SESSION_ID, "Terminal");
      store.set(openWorkstationTabAtom, { workspace, tab });
      return {
        tab,
        created,
        terminalId: session.id,
        terminalState: "registered",
      };
    },
    async io() {
      const id = request.params.terminalId as string;
      requireSession(id);
      const result = await invokeTauri<Record<string, unknown>>(
        "ui_terminal_io",
        { generation, request }
      );
      if (request.command === "ui.terminal.read") requireSession(id);
      else if (sessions().some((session) => session.id === id))
        store.set(updateTerminalSessionInfoAtom, {
          sessionId: id,
          info: { hasUserInput: true },
        });
      return result;
    },
  };
}
export type TerminalOperations = ReturnType<typeof createTerminalOperations>;
