import React from "react";
import { useTranslation } from "react-i18next";

import TabPill from "@src/components/TabPill";
import { ScrollTrailTarget } from "@src/components/layout/blocks";
import type { WorkItem } from "@src/types/core/workItem";

import { LinkedSessionsList } from "./LinkedSessionsList";
import WorkItemRunUsageSummary from "./WorkItemRunUsageSummary";
import type { useWorkItemContentState } from "./hooks/useWorkItemContentState";
import type { WorkItemContentSectionPolicy } from "./presentation";
import type { SessionTab, WorkItemContentProps } from "./types";

type WorkItemContentState = ReturnType<typeof useWorkItemContentState>;

interface WorkItemLowerSectionSharedProps extends Pick<
  WorkItemContentProps,
  "projectSlug" | "orgId" | "activeAgentSessionId" | "onOpenSession"
> {
  workItem: WorkItem;
  /** Resolved short id: the explicit prop, else the work item's own. */
  shortId: string | undefined;
  sectionPolicy: WorkItemContentSectionPolicy;
  outputContent: React.ReactNode;
}

interface WorkItemTabbedLowerSectionProps extends WorkItemLowerSectionSharedProps {
  sessionTabItems: WorkItemContentState["sessionTabItems"];
  activeSessionTab: WorkItemContentState["activeSessionTab"];
  setActiveSessionTab: WorkItemContentState["setActiveSessionTab"];
  historyContent: React.ReactNode;
}

/** Legacy default-presentation lower strip: Session / Output / History tabs. */
export const WorkItemTabbedLowerSection: React.FC<
  WorkItemTabbedLowerSectionProps
> = ({
  workItem,
  shortId,
  projectSlug,
  orgId,
  activeAgentSessionId,
  onOpenSession,
  sectionPolicy,
  outputContent,
  sessionTabItems,
  activeSessionTab,
  setActiveSessionTab,
  historyContent,
}) => (
  <section data-testid="work-item-lower-tabs-section">
    <div className="mb-4 flex items-center justify-start">
      <TabPill
        tabs={sessionTabItems}
        activeTab={activeSessionTab}
        onChange={(key) => setActiveSessionTab(key as SessionTab)}
        variant="simple"
        fillWidth={false}
        size="large"
      />
    </div>

    {activeSessionTab === "session" &&
      (sectionPolicy.showLinkedSessionsTable ? (
        <LinkedSessionsList
          sessions={workItem.linkedSessions ?? []}
          originSession={workItem.originSession}
          shortId={shortId}
          projectSlug={projectSlug}
          orgId={orgId}
          activeAgentSessionId={activeAgentSessionId}
          onOpenSession={onOpenSession}
        />
      ) : null)}

    {activeSessionTab === "output" && outputContent}

    {activeSessionTab === "history" && historyContent}
  </section>
);

interface WorkItemThreadLowerSectionProps extends WorkItemLowerSectionSharedProps {
  isThread: boolean;
  isGitHubWorkItem: boolean;
}

/** Thread-presentation lower stack: run usage, linked sessions, inline output. */
export const WorkItemThreadLowerSection: React.FC<
  WorkItemThreadLowerSectionProps
> = ({
  workItem,
  shortId,
  projectSlug,
  orgId,
  activeAgentSessionId,
  onOpenSession,
  sectionPolicy,
  outputContent,
  isThread,
  isGitHubWorkItem,
}) => {
  const { t } = useTranslation(["projects", "common"]);

  return (
    <>
      {!isGitHubWorkItem && !sectionPolicy.showInlineOutput ? (
        <WorkItemRunUsageSummary
          projectSlug={projectSlug}
          orgId={orgId}
          shortId={shortId}
          navigationEnabled={isThread}
          onOpenSession={onOpenSession}
        />
      ) : null}
      {(workItem.linkedSessions?.length ?? 0) > 0 || workItem.originSession ? (
        <ScrollTrailTarget
          enabled={isThread}
          label={t("workItems.linkedSessions.title", {
            defaultValue: "Sessions",
          })}
        >
          <LinkedSessionsList
            sessions={workItem.linkedSessions ?? []}
            originSession={workItem.originSession}
            shortId={shortId}
            projectSlug={projectSlug}
            orgId={orgId}
            activeAgentSessionId={activeAgentSessionId}
            onOpenSession={onOpenSession}
          />
        </ScrollTrailTarget>
      ) : null}
      {sectionPolicy.showInlineOutput ? (
        <ScrollTrailTarget
          enabled={isThread}
          label={t("common:labels.output", { defaultValue: "Output" })}
        >
          {outputContent}
        </ScrollTrailTarget>
      ) : null}
    </>
  );
};
