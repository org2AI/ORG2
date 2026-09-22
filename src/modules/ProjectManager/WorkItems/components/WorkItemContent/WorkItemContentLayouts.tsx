import React from "react";
import { useTranslation } from "react-i18next";

import {
  DetailPanelContainer,
  ScrollTrailTarget,
} from "@src/components/layout/blocks";

import WorkItemContentStack from "../WorkItemContentStack";
import {
  WorkItemThreadLayout,
  WorkItemThreadViewAction,
} from "../WorkItemThread";
import GitHubIssueComposer from "./GitHubIssueComposer";
import type { useWorkItemContentModel } from "./hooks/useWorkItemContentModel";
import type { useWorkItemContentSections } from "./hooks/useWorkItemContentSections";
import type { WorkItemContentProps } from "./types";

type WorkItemContentModel = ReturnType<typeof useWorkItemContentModel>;
type WorkItemContentSections = ReturnType<typeof useWorkItemContentSections>;

interface WorkItemContentThreadLayoutProps extends Pick<
  WorkItemContentProps,
  | "workItem"
  | "headerPath"
  | "headerProperties"
  | "propertiesRail"
  | "githubIssueInteraction"
> {
  contentModel: WorkItemContentModel;
  sections: WorkItemContentSections;
  historyContent: React.ReactNode;
}

/**
 * Thread presentation: the overview body (with the drill-in to Discussion for
 * local Work Items) or the Discussion view, inside the thread layout with its
 * flow header, alerts, properties rail and floating GitHub composer.
 */
export const WorkItemContentThreadLayout: React.FC<
  WorkItemContentThreadLayoutProps
> = ({
  workItem,
  headerPath,
  headerProperties,
  propertiesRail,
  githubIssueInteraction,
  contentModel,
  sections,
  historyContent,
}) => {
  const { t } = useTranslation(["projects", "common"]);
  const {
    resolvedFlowHeader,
    isGitHubWorkItem,
    githubTimelineAlert,
    setThreadViewSelection,
    activeThreadView,
    handoffNotice,
  } = contentModel;
  const {
    descriptionSection,
    quickActionsSection,
    customPropertiesSection,
    subItemsSection,
    threadLowerSection,
  } = sections;

  const githubIssueComposer =
    activeThreadView === "overview" &&
    isGitHubWorkItem &&
    githubIssueInteraction ? (
      <GitHubIssueComposer interaction={githubIssueInteraction} />
    ) : undefined;

  return (
    <WorkItemThreadLayout
      path={headerPath}
      properties={headerProperties}
      flowHeader={resolvedFlowHeader}
      alerts={githubTimelineAlert}
      sidebar={propertiesRail}
      floatingFooter={githubIssueComposer}
    >
      {activeThreadView === "overview" ? (
        <>
          {handoffNotice}
          {descriptionSection}
          {quickActionsSection}
          {customPropertiesSection}
          {subItemsSection}
          {threadLowerSection}
          {!isGitHubWorkItem ? (
            <ScrollTrailTarget label={t("workItems.activity.discussionTitle")}>
              <nav
                className="flex min-h-8 items-center justify-end"
                aria-label={t("workItems.activity.discussionTitle")}
                data-testid="work-item-thread-secondary-navigation"
              >
                <WorkItemThreadViewAction
                  activeView="overview"
                  onChange={(view) =>
                    setThreadViewSelection({
                      workItemId: workItem.session_id,
                      view,
                    })
                  }
                />
              </nav>
            </ScrollTrailTarget>
          ) : null}
        </>
      ) : (
        historyContent
      )}
    </WorkItemThreadLayout>
  );
};

interface WorkItemContentStackLayoutProps extends Pick<
  WorkItemContentProps,
  "headerPath" | "headerProperties"
> {
  contentModel: WorkItemContentModel;
  sections: WorkItemContentSections;
}

/**
 * Default presentation: the scrollable content stack with the description
 * (and any handoff notice) above the local-only sections and the tabbed or
 * inline lower section chosen by the section policy.
 */
export const WorkItemContentStackLayout: React.FC<
  WorkItemContentStackLayoutProps
> = ({ headerPath, headerProperties, contentModel, sections }) => {
  const { sectionPolicy, handoffNotice } = contentModel;
  const {
    descriptionSection,
    quickActionsSection,
    customPropertiesSection,
    subItemsSection,
    tabbedLowerSection,
    threadLowerSection,
  } = sections;

  return (
    <DetailPanelContainer className="relative">
      <WorkItemContentStack
        pathContent={headerPath}
        propertiesContent={headerProperties}
        descriptionContent={
          handoffNotice ? (
            <div className="flex flex-col gap-4">
              {handoffNotice}
              {descriptionSection}
            </div>
          ) : (
            descriptionSection
          )
        }
        lowerContent={
          <>
            {quickActionsSection}
            {customPropertiesSection}
            {subItemsSection}
            {sectionPolicy.showTabbedLowerSection
              ? tabbedLowerSection
              : threadLowerSection}
          </>
        }
        scrollable
      />
    </DetailPanelContainer>
  );
};
