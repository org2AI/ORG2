import type { TFunction } from "i18next";
import { useMemo, useState } from "react";

import type { TabPillItem } from "@src/components/TabPill";
import type { WorkItem as WorkItemExtended } from "@src/types/core/workItem";

import { SESSION_TAB_KEYS, type SessionTab } from "../types";

interface UseWorkItemSessionTabsOptions {
  workItem: WorkItemExtended;
  t: TFunction<"projects">;
}

/**
 * The legacy lower tab strip (Agent / Output / History): the selected tab,
 * the orchestrator phase, and the tab items with the running-agent badge.
 */
export function useWorkItemSessionTabs({
  workItem,
  t,
}: UseWorkItemSessionTabsOptions) {
  const [activeSessionTab, setActiveSessionTab] =
    useState<SessionTab>("session");

  const currentPhase = workItem.orchestratorState?.current_phase ?? "idle";
  const isAgentRunning = currentPhase === "sde" || currentPhase === "review";

  const sessionTabItems: TabPillItem[] = useMemo(
    () =>
      SESSION_TAB_KEYS.map((key) => ({
        key,
        label:
          key === "session"
            ? t("common:terminology.agent")
            : t(`common:labels.${key}`),
        dataTestId: `work-item-sessions-tab-${key}`,
        badge:
          key === "session" && isAgentRunning ? (
            <span className="ml-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-primary-6" />
          ) : undefined,
      })),
    [t, isAgentRunning]
  );

  return {
    activeSessionTab,
    setActiveSessionTab,
    currentPhase,
    isAgentRunning,
    sessionTabItems,
  };
}
