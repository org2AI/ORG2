import { type Getter, atom } from "jotai";

import { createLogger } from "@src/hooks/logger";
import { sessionByIdAtom } from "@src/store/session/sessionAtom/atoms";
import { workstationActiveSessionIdAtom } from "@src/store/session/viewAtom";
import {
  settingsAtom,
  updateSettingAtom,
} from "@src/store/settings/settingsAtom";

import { workstationWorkspaceId } from "./storage";
import type { WorkstationWorkspaceKey } from "./types";

const log = createLogger("WorkstationSharing");

export const myStationSharingAtom = atom(
  (get) => get(settingsAtom)["general.myStationSharing"],
  (_get, set, value: "working-directory" | "chat-tab") => {
    set(updateSettingAtom, { key: "general.myStationSharing", value }).catch(
      (error: unknown) => {
        log.warn("Failed to persist general.myStationSharing:", error);
      }
    );
  }
);
myStationSharingAtom.debugLabel = "myStationSharingAtom";

export const GLOBAL_WORKSTATION_WORKSPACE_KEY: WorkstationWorkspaceKey = {
  kind: "global",
};

export function sessionWorkstationWorkspaceKey(
  sessionId: string
): WorkstationWorkspaceKey {
  return { kind: "session", sessionId };
}

/** Keep worktrees/subdirectories distinct, including case-sensitive paths. */
export function normalizeWorkstationDirectory(path: string): string {
  const normalized = path.trim().replace(/\\/g, "/");
  if (/^[a-zA-Z]:\/+$/u.test(normalized)) return `${normalized.slice(0, 2)}/`;
  return (
    normalized.replace(/\/+$/, "") || (normalized.startsWith("/") ? "/" : "")
  );
}

/** Resolve at the caller boundary, then capture this key for delayed actions. */
export function resolveSessionWorkstationWorkspaceKey(
  get: Getter,
  sessionId: string
): WorkstationWorkspaceKey {
  if (get(myStationSharingAtom) === "working-directory") {
    const session = get(sessionByIdAtom(sessionId));
    // Remote/guest paths refer to another machine and cannot identify a local
    // directory. Unhydrated sessions also stay isolated until metadata arrives.
    const directory =
      !session?.importedFrom && session?.repoPath
        ? normalizeWorkstationDirectory(session.repoPath)
        : "";
    if (directory.startsWith("/") || /^[a-zA-Z]:\//u.test(directory)) {
      return { kind: "directory", directory };
    }
  }
  return sessionWorkstationWorkspaceKey(sessionId);
}

// The primitive identity prevents session status updates and same-directory
// chat switches from invalidating every Workstation consumer.
const presentedWorkspaceIdAtom = atom((get) => {
  const sessionId = get(workstationActiveSessionIdAtom);
  return workstationWorkspaceId(
    sessionId
      ? resolveSessionWorkstationWorkspaceKey(get, sessionId)
      : GLOBAL_WORKSTATION_WORKSPACE_KEY
  );
});

export const presentedWorkstationWorkspaceKeyAtom =
  atom<WorkstationWorkspaceKey>((get) => {
    const id = get(presentedWorkspaceIdAtom);
    if (id === "global") return GLOBAL_WORKSTATION_WORKSPACE_KEY;
    return id.startsWith("directory:")
      ? { kind: "directory", directory: id.slice("directory:".length) }
      : sessionWorkstationWorkspaceKey(id.slice("session:".length));
  });
presentedWorkstationWorkspaceKeyAtom.debugLabel =
  "presentedWorkstationWorkspaceKeyAtom";
