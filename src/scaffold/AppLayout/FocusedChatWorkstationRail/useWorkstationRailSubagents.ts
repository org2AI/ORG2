import type { TFunction } from "i18next";
import { useSetAtom } from "jotai";
import { useCallback, useMemo } from "react";

import { openSessionTrailSurfaceAtom } from "@src/store/workstation/sessionTrailSurfaceAtom";

import { resolveSubagentRowStatus } from "./subagentRowStatus";
import type {
  FocusedChatRailIcon,
  FocusedChatRailItem,
  FocusedChatRailSubagent,
} from "./types";

/** The compact rail and wide trail enter the same session-owned task surface. */
export function useWorkstationRailSubagents({
  setMenuOpen,
  subagentIcon,
  subagents,
  parentSessionId,
  t,
}: {
  setMenuOpen: (open: boolean) => void;
  subagentIcon: FocusedChatRailIcon;
  subagents: FocusedChatRailSubagent[];
  parentSessionId?: string;
  t: TFunction;
}) {
  const open = useSetAtom(openSessionTrailSurfaceAtom);
  const openSubagentSession = useCallback(
    (childSessionId?: string) => {
      if (!parentSessionId) return;
      open({
        kind: "subagents",
        sessionId: parentSessionId,
        title: t("common:git.rail.subagents"),
        childSessionId,
      });
      setMenuOpen(false);
    },
    [open, parentSessionId, setMenuOpen, t]
  );
  const subagentItems = useMemo<FocusedChatRailItem[]>(() => {
    if (!subagents.length) return [];
    const running = subagents.filter(
      (child) => child.status === "running" || child.status === "pending"
    ).length;
    return [
      {
        key: "subagents-view-all",
        label: t("sessions:subagentTrail.summary", {
          running,
          finished: subagents.length - running,
        }),
        icon: subagentIcon,
        visibleWhenCollapsed: true,
        onClick: () => openSubagentSession(),
      },
      ...subagents.slice(0, 5).map((child) => ({
        key: `subagent:${child.sessionId}`,
        label: child.description || child.name,
        icon: subagentIcon,
        status: resolveSubagentRowStatus(t, child.status),
        onClick: () => openSubagentSession(child.sessionId),
      })),
    ];
  }, [subagents, subagentIcon, openSubagentSession, t]);
  return { subagentItems };
}
