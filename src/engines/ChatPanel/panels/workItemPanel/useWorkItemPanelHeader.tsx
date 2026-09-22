import type { TFunction } from "i18next";
import { useMemo } from "react";

import { STORY_SYNC_ADAPTER } from "@src/api/http/integrations/syncConnections";
import Button from "@src/components/Button";
import IntegrationIcon from "@src/components/IntegrationIcon";
import { ToolbarTooltip } from "@src/components/KeyboardShortcut/ToolbarTooltip";
import { DetailHeaderTabs } from "@src/components/layout/blocks";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import { usePublishChatPanelHeader } from "@src/engines/ChatPanel/header";
import ThreadDetailTabs, {
  type ThreadDetailTab,
} from "@src/features/GitHubWork/ThreadDetailTabs";
import {
  Delete02Icon,
  HugeiconsIcon,
  InformationCircleIcon,
  ListChecksIcon,
} from "@src/icons";
import { WorkItemDetailHeaderBreadcrumb } from "@src/modules/ProjectManager/WorkItems/components/WorkItemDetail/WorkItemDetailHeader";
import { ExternalBrowserButton } from "@src/modules/WorkStation/shared/ExternalBrowserButton";
import type { ChatPanelSelectedWorkItem } from "@src/store/ui/chatPanel/selectionAtoms";
import type { WorkItem } from "@src/types/core/workItem";

interface UseWorkItemPanelHeaderArgs {
  selectedWorkItem: ChatPanelSelectedWorkItem;
  projectSyncAdapterId: string | null | undefined;
  isGitHubSyncedProject: boolean;
  isGitHubWorkItem: boolean;
  githubIssueExternalUrl: string | undefined;
  propertiesOpen: boolean;
  propertiesToggleLabel: string;
  toggleProperties: () => void;
  handleDeleteWorkItem: () => Promise<void>;
  handleUpdateWorkItem: (updates: Partial<WorkItem>) => Promise<void>;
  activeDetailTab: ThreadDetailTab;
  linkedReferencesCount: number;
  handleDetailTabChange: (nextTab: ThreadDetailTab) => void;
  onClose?: () => void;
  t: TFunction;
}

/** Builds and publishes the chat panel header (breadcrumb, tabs, actions). */
export function useWorkItemPanelHeader({
  selectedWorkItem,
  projectSyncAdapterId,
  isGitHubSyncedProject,
  isGitHubWorkItem,
  githubIssueExternalUrl,
  propertiesOpen,
  propertiesToggleLabel,
  toggleProperties,
  handleDeleteWorkItem,
  handleUpdateWorkItem,
  activeDetailTab,
  linkedReferencesCount,
  handleDetailTabChange,
  onClose,
  t,
}: UseWorkItemPanelHeaderArgs): void {
  const headerActions = useMemo(
    () => (
      <div className="flex items-center gap-px">
        {selectedWorkItem.projectSlug &&
        projectSyncAdapterId !== undefined &&
        !isGitHubSyncedProject ? (
          <ToolbarTooltip label={t("projects:workItems.deleteWorkItem")}>
            <Button
              variant="tertiary"
              size="small"
              iconOnly
              onClick={() => void handleDeleteWorkItem()}
              aria-label={t("projects:workItems.deleteWorkItem")}
              data-testid="work-item-delete"
              icon={
                <HugeiconsIcon
                  icon={Delete02Icon}
                  data-icon="trash-2"
                  size={HEADER_ICON_SIZE.sm}
                />
              }
            />
          </ToolbarTooltip>
        ) : null}
        {githubIssueExternalUrl ? (
          <ExternalBrowserButton
            href={githubIssueExternalUrl}
            dataTestId="chat-panel-work-item-open-external"
          />
        ) : null}
        <ToolbarTooltip label={propertiesToggleLabel}>
          <Button
            variant="tertiary"
            size="small"
            iconOnly
            className={
              propertiesOpen ? "bg-surface-selected! text-primary-6!" : ""
            }
            onClick={toggleProperties}
            aria-label={propertiesToggleLabel}
            data-testid="chat-panel-work-item-properties-toggle"
            icon={
              <HugeiconsIcon
                icon={InformationCircleIcon}
                data-icon="info"
                size={HEADER_ICON_SIZE.sm}
              />
            }
          />
        </ToolbarTooltip>
      </div>
    ),
    [
      handleDeleteWorkItem,
      githubIssueExternalUrl,
      isGitHubSyncedProject,
      projectSyncAdapterId,
      propertiesOpen,
      propertiesToggleLabel,
      selectedWorkItem.projectSlug,
      t,
      toggleProperties,
    ]
  );

  const workItemHeaderBreadcrumb = useMemo(
    () => (
      <WorkItemDetailHeaderBreadcrumb
        workItem={selectedWorkItem.workItem}
        breadcrumbProjectName={selectedWorkItem.projectName}
        breadcrumbIcon={
          isGitHubSyncedProject ? (
            <IntegrationIcon
              type={STORY_SYNC_ADAPTER.GITHUB}
              size={HEADER_ICON_SIZE.sm}
            />
          ) : (
            <HugeiconsIcon
              icon={ListChecksIcon}
              data-icon="list-checks"
              size={HEADER_ICON_SIZE.sm}
              strokeWidth={1.75}
            />
          )
        }
        shortId={selectedWorkItem.shortId}
        onClose={onClose}
        onTitleChange={
          !isGitHubWorkItem &&
          (!selectedWorkItem.projectSlug || projectSyncAdapterId !== undefined)
            ? (title) => void handleUpdateWorkItem({ name: title })
            : undefined
        }
        t={t}
      />
    ),
    [
      selectedWorkItem.projectName,
      selectedWorkItem.shortId,
      selectedWorkItem.workItem,
      selectedWorkItem.projectSlug,
      isGitHubSyncedProject,
      isGitHubWorkItem,
      projectSyncAdapterId,
      handleUpdateWorkItem,
      onClose,
      t,
    ]
  );
  const workItemHeaderContent = useMemo(
    () => (
      <DetailHeaderTabs
        title={workItemHeaderBreadcrumb}
        tabs={
          <ThreadDetailTabs
            activeTab={activeDetailTab}
            conversationCount={selectedWorkItem.workItem.comments?.length ?? 0}
            linkedCount={linkedReferencesCount}
            onChange={handleDetailTabChange}
            variant="header"
            idPrefix="chat-panel-work-item-detail"
            ariaLabel={t("projects:workItems.detailNavigation")}
          />
        }
      />
    ),
    [
      activeDetailTab,
      handleDetailTabChange,
      linkedReferencesCount,
      selectedWorkItem.workItem.comments?.length,
      t,
      workItemHeaderBreadcrumb,
    ]
  );

  // Memoize the published-header payload. A fresh `{ content, trailing }`
  // object literal every render makes `usePublishChatPanelHeader`'s
  // layout effect re-publish on every commit; because the header atom's
  // subscriber re-render cascades back into this panel, that becomes an
  // unbounded synchronous update loop (React "maximum update depth").
  const publishedHeader = useMemo(
    () => ({ content: workItemHeaderContent, trailing: headerActions }),
    [workItemHeaderContent, headerActions]
  );
  usePublishChatPanelHeader({ content: publishedHeader });
}
