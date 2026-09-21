import { atom } from "jotai";

import { workstationWorkspaceId } from "../tabs/storage";
import type { WorkstationWorkspaceId } from "../tabs/types";
import { presentedWorkstationWorkspaceKeyAtom } from "../tabs/workspaceScope";

export type TerminalTarget =
  | { kind: "agent"; sessionId: string }
  | { kind: "pty"; ptySessionId: string };

export type TerminalTargetWorkspaceId = WorkstationWorkspaceId;

function terminalTargetWorkspaceId(
  sessionId: string | null
): TerminalTargetWorkspaceId {
  return sessionId ? `session:${sessionId}` : "global";
}

/**
 * Terminal resources are global, but the selected resource is presentation
 * state owned by each WorkStation workspace. Keeping the selections separate
 * follows the directory/chat-tab sharing policy.
 */
export const codeEditorTerminalTargetsAtom = atom<
  Partial<Record<TerminalTargetWorkspaceId, TerminalTarget>>
>({});
codeEditorTerminalTargetsAtom.debugLabel = "codeEditorTerminalTargetsAtom";

export const codeEditorTerminalTargetAtom = atom<
  TerminalTarget | null,
  [TerminalTarget | null],
  void
>(
  (get) => {
    const workspaceId = workstationWorkspaceId(
      get(presentedWorkstationWorkspaceKeyAtom)
    );
    return get(codeEditorTerminalTargetsAtom)[workspaceId] ?? null;
  },
  (get, set, target) => {
    const workspaceId = workstationWorkspaceId(
      get(presentedWorkstationWorkspaceKeyAtom)
    );
    const targets = get(codeEditorTerminalTargetsAtom);
    if (target) {
      set(codeEditorTerminalTargetsAtom, { ...targets, [workspaceId]: target });
      return;
    }
    if (!(workspaceId in targets)) return;
    const next = { ...targets };
    delete next[workspaceId];
    set(codeEditorTerminalTargetsAtom, next);
  }
);
codeEditorTerminalTargetAtom.debugLabel = "codeEditorTerminalTargetAtom";

/** Remove a deleted agent workspace's remembered Terminal selection. */
export const clearTerminalTargetForWorkspaceAtom = atom(
  null,
  (get, set, sessionId: string) => {
    const workspaceId = terminalTargetWorkspaceId(sessionId);
    const targets = get(codeEditorTerminalTargetsAtom);
    const next = { ...targets };
    let changed = false;
    for (const [id, target] of Object.entries(targets)) {
      if (
        id === workspaceId ||
        (target?.kind === "agent" && target.sessionId === sessionId)
      ) {
        delete next[id as TerminalTargetWorkspaceId];
        changed = true;
      }
    }
    if (changed) set(codeEditorTerminalTargetsAtom, next);
  }
);
clearTerminalTargetForWorkspaceAtom.debugLabel =
  "clearTerminalTargetForWorkspaceAtom";

/** A killed global PTY must not remain selected in any workspace. */
export const clearTerminalTargetReferencesAtom = atom(
  null,
  (get, set, ptySessionId: string) => {
    const targets = get(codeEditorTerminalTargetsAtom);
    let changed = false;
    const next = { ...targets };
    for (const [workspaceId, target] of Object.entries(targets)) {
      if (target?.kind === "pty" && target.ptySessionId === ptySessionId) {
        delete next[workspaceId as TerminalTargetWorkspaceId];
        changed = true;
      }
    }
    if (changed) set(codeEditorTerminalTargetsAtom, next);
  }
);
clearTerminalTargetReferencesAtom.debugLabel =
  "clearTerminalTargetReferencesAtom";
