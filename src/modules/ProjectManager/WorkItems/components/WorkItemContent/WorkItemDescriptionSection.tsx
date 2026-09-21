import React from "react";
import { useTranslation } from "react-i18next";

import MarkdownTextareaEditor from "@src/components/MarkdownTextareaEditor";
import MarkdownEditorModeSwitch from "@src/components/MarkdownTextareaEditor/ModeSwitch";
import PersonAvatar from "@src/components/PersonAvatar";
import { PanelFooter } from "@src/components/layout/blocks";
import {
  ActivityHeaderActionButton,
  ConnectedTimelineItem,
  MarkdownContent,
  TimelineCard,
  TimelineCardHeader,
  TimelineStack,
} from "@src/features/GitHubWork/ActivityTimeline";
import type { useWorkItemImageInsert } from "@src/hooks/project";
import { HugeiconsIcon, Pen01Icon, RepeatIcon } from "@src/icons";
import {
  ProjectContentEditor,
  type ProjectContentEditorRef,
} from "@src/modules/ProjectManager/shared";
import { IssueTimelineItems } from "@src/modules/WorkStation/CodeEditor/Panels/EditorPrimarySidebar/content/IssuesContent/IssueTimelineItems";
import type { WorkItem } from "@src/types/core/workItem";

import type { useWorkItemContentModel } from "./hooks/useWorkItemContentModel";
import type { useWorkItemContentState } from "./hooks/useWorkItemContentState";
import { resolveCreationActivityKey } from "./presentation";
import type { GitHubIssueInteractionConfig } from "./types";

type WorkItemContentModel = ReturnType<typeof useWorkItemContentModel>;

interface WorkItemDescriptionSectionProps {
  workItem: WorkItem;
  isThread: boolean;
  isGitHubWorkItem: boolean;
  canEditDescription: boolean;
  isEditingThreadDescription: boolean;
  githubIssueInteraction?: GitHubIssueInteractionConfig;
  githubTimeline: WorkItemContentModel["githubTimeline"];
  githubTimelineLoading: boolean;
  githubTimelineError: WorkItemContentModel["githubTimelineError"];
  creatorName: string;
  normalizedRawDescription: string;
  displayedDescription: string;
  descriptionEditing: WorkItemContentModel["descriptionEditing"];
  handleTitleChange: ReturnType<
    typeof useWorkItemContentState
  >["handleTitleChange"];
  handleImageInsert: ReturnType<
    typeof useWorkItemImageInsert
  >["handleImageInsert"];
  editorRef: React.RefObject<ProjectContentEditorRef | null>;
  titleVisible: boolean;
  repoPath?: string | null;
}

/**
 * The description timeline card (creator header, routine chip, markdown /
 * editor body, save footer) followed by the GitHub issue timeline items.
 */
const WorkItemDescriptionSection: React.FC<WorkItemDescriptionSectionProps> = ({
  workItem,
  isThread,
  isGitHubWorkItem,
  canEditDescription,
  isEditingThreadDescription,
  githubIssueInteraction,
  githubTimeline,
  githubTimelineLoading,
  githubTimelineError,
  creatorName,
  normalizedRawDescription,
  displayedDescription,
  descriptionEditing,
  handleTitleChange,
  handleImageInsert,
  editorRef,
  titleVisible,
  repoPath,
}) => {
  const { t } = useTranslation(["projects", "common"]);
  const {
    descriptionDraft,
    descriptionHasChanges,
    descriptionSaveErrorWorkItemId,
    descriptionEditorMode,
    setDescriptionEditorMode,
    handleDescriptionDraftChange,
    handleCancelDescription,
    handleSaveDescription,
    beginDescriptionEdit,
  } = descriptionEditing;

  const descriptionActions =
    isThread && canEditDescription && !isEditingThreadDescription ? (
      <ActivityHeaderActionButton
        icon={
          <HugeiconsIcon
            icon={Pen01Icon}
            data-icon="pencil"
            size={12}
            aria-hidden
          />
        }
        label={t("common:actions.edit")}
        onClick={beginDescriptionEdit}
        data-testid="work-item-description-edit"
      />
    ) : null;

  return (
    <TimelineStack>
      <ConnectedTimelineItem
        isLast={
          !isGitHubWorkItem ||
          (!githubTimelineLoading && githubTimeline.length === 0)
        }
        trailLabel={
          isThread
            ? workItem.name ||
              t("common:labels.description", {
                defaultValue: "Description",
              })
            : undefined
        }
      >
        <TimelineCard
          copyBody={normalizedRawDescription}
          actions={descriptionActions}
          className={isThread ? "shadow-xs" : undefined}
          footer={
            canEditDescription &&
            (isThread ? isEditingThreadDescription : descriptionHasChanges) ? (
              <PanelFooter
                left={
                  isGitHubWorkItem || isThread ? (
                    <MarkdownEditorModeSwitch
                      mode={descriptionEditorMode}
                      onModeChange={setDescriptionEditorMode}
                      disabled={githubIssueInteraction?.updatingBody}
                      dataTestId="work-item-description-mode-switch"
                    />
                  ) : undefined
                }
                secondaryActions={[
                  {
                    label: t("common:actions.cancel"),
                    onClick: handleCancelDescription,
                    disabled: githubIssueInteraction?.updatingBody,
                    dataTestId: "work-item-description-cancel",
                  },
                ]}
                primaryAction={{
                  label: t("common:actions.save"),
                  onClick: () => void handleSaveDescription(),
                  disabled:
                    !descriptionHasChanges ||
                    githubIssueInteraction?.updatingBody,
                  loading: githubIssueInteraction?.updatingBody,
                  dataTestId: "work-item-description-save",
                }}
              />
            ) : null
          }
          header={
            <TimelineCardHeader
              avatar={
                <PersonAvatar
                  size={18}
                  name={creatorName}
                  src={workItem.createdBy?.avatar}
                  color={workItem.createdBy?.color}
                />
              }
              actor={creatorName}
              action={t(resolveCreationActivityKey(isGitHubWorkItem))}
              timestamp={workItem.created_time}
            />
          }
        >
          {workItem.routineSource && (
            <div
              className="mb-2 inline-flex items-center gap-1.5 rounded-full bg-fill-2 px-2 py-0.5 text-[11px] text-text-3"
              data-testid="work-item-routine-source-chip"
              title={workItem.routineSource.firedAt}
            >
              <HugeiconsIcon
                icon={RepeatIcon}
                data-icon="repeat"
                size={11}
                className="shrink-0"
              />
              <span className="truncate">
                {t("workItems.fromRoutine", {
                  name: workItem.routineSource.routineName,
                })}
              </span>
            </div>
          )}
          {(isGitHubWorkItem || isThread) && !isEditingThreadDescription ? (
            <MarkdownContent
              body={displayedDescription}
              emptyText="No description provided."
              fadeFrom="from-chat-pane"
            />
          ) : isGitHubWorkItem ? (
            <>
              <MarkdownTextareaEditor
                value={descriptionDraft}
                onChange={handleDescriptionDraftChange}
                onSubmit={() => void handleSaveDescription()}
                placeholder={t("workItems.descriptionPlaceholder")}
                minHeight={120}
                maxHeight={360}
                appearance="plain"
                editable={
                  canEditDescription && !githubIssueInteraction?.updatingBody
                }
                mode={descriptionEditorMode}
                onModeChange={setDescriptionEditorMode}
                dataTestId="github-issue-description-editor"
              />
              {descriptionSaveErrorWorkItemId === workItem.session_id ? (
                <p className="px-3 pb-2 text-xs text-danger-6" role="status">
                  {t("common:git.issues.composer.bodyUpdateFailed")}
                </p>
              ) : null}
            </>
          ) : (
            <ProjectContentEditor
              key={workItem.session_id}
              ref={editorRef}
              title={workItem.name || ""}
              onTitleChange={handleTitleChange}
              initialDescription={descriptionDraft}
              onDescriptionChange={handleDescriptionDraftChange}
              onImageInsert={canEditDescription ? handleImageInsert : undefined}
              titleVisible={titleVisible}
              separatorVisible={false}
              descriptionPlaceholder={t("workItems.descriptionPlaceholder")}
              editable={canEditDescription}
              descriptionMinHeight={isThread ? 120 : 200}
              descriptionMaxHeight={isThread ? 360 : 600}
              descriptionMode={isThread ? descriptionEditorMode : undefined}
              onDescriptionModeChange={
                isThread ? setDescriptionEditorMode : undefined
              }
              descriptionClassName="no-bottom-border"
              repoPath={repoPath}
              className="w-full"
              dataTestId="work-item-content-editor"
            />
          )}
        </TimelineCard>
      </ConnectedTimelineItem>
      {isGitHubWorkItem ? (
        <IssueTimelineItems
          timeline={githubTimeline}
          timelineLoading={githubTimelineLoading}
          timelineError={githubTimelineError}
          navigationEnabled={isThread}
        />
      ) : null}
    </TimelineStack>
  );
};

export default WorkItemDescriptionSection;
