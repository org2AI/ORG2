import { useAtomValue } from "jotai";
import { useEffect, useMemo, useRef } from "react";

import {
  type MobileSidebarSessionSnapshotRow,
  syncSidebarSessions,
} from "@src/api/tauri/mobileRemote";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { createLogger } from "@src/hooks/logger";
import type { NavigationMenuItem } from "@src/scaffold/NavigationSidebar/components/NavigationMenu/config";
import type { Session } from "@src/store/session";
import { isSessionInProgress } from "@src/util/session/sessionInProgress";

import { NO_WORKSPACE_KEY } from "../types";
import { workspaceGroupKey } from "../workspaceGroupKey";
import { createMobileSidebarPublisher } from "./mobileSidebarPublisher";

const logger = createLogger("MobileSidebarPublisher");
// Existing Rust snapshot contract; publish a usable prefix rather than rejecting the whole roster.
const MAX_MOBILE_SIDEBAR_ROWS = 200;
const publisher = createMobileSidebarPublisher(syncSidebarSessions, (error) =>
  logger.warn("Failed to publish desktop session list", error)
);

interface Params {
  scope: string;
  loading: boolean;
  items: readonly NavigationMenuItem[];
  sessionMap: ReadonlyMap<string, Session>;
  repoPathToName: ReadonlyMap<string, string>;
}

/** Copy only rows the desktop's final local/My Sessions projection actually exposes. */
export function projectMobileSidebarSessions({
  items,
  sessionMap,
  repoPathToName,
}: Omit<Params, "scope" | "loading">): MobileSidebarSessionSnapshotRow[] {
  const rows: MobileSidebarSessionSnapshotRow[] = [];
  const seen = new Set<string>();
  const visit = (item: NavigationMenuItem) => {
    if (rows.length >= MAX_MOBILE_SIDEBAR_ROWS) return;
    const session = sessionMap.get(item.id);
    if (session && !seen.has(session.session_id)) {
      seen.add(session.session_id);
      const workspace = workspaceGroupKey(session);
      const repoPath = workspace === NO_WORKSPACE_KEY ? null : workspace;
      const timestamp = Date.parse(
        session.updated_at || session.updated_time || session.created_at
      );
      rows.push({
        id: session.session_id,
        name: item.label,
        status: isSessionInProgress(session.status, session)
          ? "running"
          : "idle",
        repoPath,
        repoName: repoPath
          ? (repoPathToName.get(repoPath) ??
            repoPath.split("/").pop() ??
            repoPath)
          : null,
        updatedAtMs: Number.isFinite(timestamp) ? timestamp : null,
      });
    }
    item.children?.forEach(visit);
  };
  items.forEach(visit);
  return rows;
}

/** Mounted with the desktop connector, even when another sidebar view is visible. */
export function useMobileSidebarSessions({
  scope: orgScope,
  loading,
  items,
  sessionMap,
  repoPathToName,
}: Params) {
  const auth = useAtomValue(org2CloudAuthAtom);
  const identity = auth ? org2CloudAuthIdentityKey(auth) : "local";
  const scope = JSON.stringify([identity, orgScope]);
  const rows = useMemo(
    () => projectMobileSidebarSessions({ items, sessionMap, repoPathToName }),
    [items, sessionMap, repoPathToName]
  );
  const owner = useRef<symbol | null>(null);
  const previousScope = useRef<string | null>(null);
  useEffect(() => {
    const token = publisher.acquire();
    owner.current = token;
    const revalidate = () => publisher.revalidate(token);
    window.addEventListener("focus", revalidate);
    window.addEventListener("online", revalidate);
    return () => {
      window.removeEventListener("focus", revalidate);
      window.removeEventListener("online", revalidate);
      publisher.release(token);
      owner.current = null;
    };
  }, []);
  useEffect(() => {
    if (!owner.current) return;
    // Keep successful rows through same-scope refresh, but never across identity/org changes.
    if (loading && previousScope.current === scope) return;
    previousScope.current = scope;
    publisher.update(owner.current, scope, loading ? [] : rows);
  }, [scope, rows, loading]);
}
