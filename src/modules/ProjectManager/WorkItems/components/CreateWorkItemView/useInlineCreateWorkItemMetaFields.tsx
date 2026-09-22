import type { TFunction } from "i18next";
import React, { useCallback, useMemo } from "react";

import { PropertyDropdownField } from "@src/components/PropertyField/PropertyDropdownField";
import type { PropertyDropdownOption } from "@src/components/PropertyField/PropertyDropdownField";
import { workItemDraftToStubWorkItem } from "@src/hooks/project";
import { DeliveryBox01Icon, HugeiconsIcon } from "@src/icons";
import { CreateComposerTitleInput } from "@src/modules/ProjectManager/shared";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";
import type { Person } from "@src/types/core/shared";
import type {
  WorkItem as WorkItemExtended,
  WorkItemLabel,
  WorkItemMilestone,
} from "@src/types/core/workItem";

import WorkItemProperties from "../WorkItemProperties";
import type { WorkItemPropertyFieldKey } from "../WorkItemProperties/types";
import type { CreateWorkItemProjectOption } from "./types";

export const CREATE_WORK_ITEM_INLINE_FIELDS: WorkItemPropertyFieldKey[] = [
  "status",
  "priority",
];

const CREATE_WORK_ITEM_BREADCRUMB_ICON_SIZE = 13;

interface UseInlineCreateWorkItemMetaFieldsOptions {
  t: TFunction<"projects">;
  draft: WorkItemDraft;
  projectName?: string;
  resolvedProjects: CreateWorkItemProjectOption[];
  resolvedLabels: WorkItemLabel[];
  resolvedMembers: Person[];
  availableMilestones: WorkItemMilestone[];
  effectiveOrgId: string;
  propertiesOpen: boolean;
  aiGenerateMode: boolean;
  dockedComposer: boolean;
  updateDraftWithUndo: (updates: Partial<WorkItemDraft>) => void;
  handleTitleChange: (name: string) => void;
  handlePropertyUpdate: (updates: Partial<WorkItemExtended>) => void;
}

/**
 * The inline creator's meta rows: the project pill breadcrumb, the draft's
 * stub Work Item with its inline property pills, and the title input.
 */
export function useInlineCreateWorkItemMetaFields({
  t,
  draft,
  projectName,
  resolvedProjects,
  resolvedLabels,
  resolvedMembers,
  availableMilestones,
  effectiveOrgId,
  propertiesOpen,
  aiGenerateMode,
  dockedComposer,
  updateDraftWithUndo,
  handleTitleChange,
  handlePropertyUpdate,
}: UseInlineCreateWorkItemMetaFieldsOptions) {
  const selectedProject = resolvedProjects.find(
    (project) => project.id === draft.projectId
  );
  const selectedProjectName = selectedProject?.name ?? projectName ?? "";
  const projectBreadcrumbLabel =
    selectedProjectName || t("projects.dashboardTitle");

  const projectOptions = useMemo<PropertyDropdownOption<string>[]>(
    () =>
      resolvedProjects.map((project) => ({
        value: project.id,
        label: project.name,
        icon: (
          <HugeiconsIcon
            icon={DeliveryBox01Icon}
            data-icon="box"
            size={CREATE_WORK_ITEM_BREADCRUMB_ICON_SIZE}
          />
        ),
        iconColor: project.color,
      })),
    [resolvedProjects]
  );

  const handleProjectBreadcrumbChange = useCallback(
    (value: string) => updateDraftWithUndo({ projectId: value }),
    [updateDraftWithUndo]
  );

  const projectBreadcrumbSegment =
    projectOptions.length > 0 ? (
      <PropertyDropdownField
        value={draft.projectId ?? ""}
        label={
          draft.projectId
            ? projectBreadcrumbLabel
            : t("projects.dashboardTitle")
        }
        icon={null}
        options={projectOptions}
        onChange={handleProjectBreadcrumbChange}
        placement="portal"
        fieldVariant="pill"
        triggerVariant="pill"
        searchable
        searchPlaceholder={t("workItems.properties.searchProjects")}
        selected={Boolean(draft.projectId)}
        maxWidthClassName="max-w-[220px] shrink-0"
        dataTestId="create-work-item-project-select"
      />
    ) : (
      <PropertyDropdownField
        value="project"
        label={projectBreadcrumbLabel}
        icon={null}
        placement="portal"
        fieldVariant="pill"
        triggerVariant="pill"
        readonly
        searchable={false}
        selected
        maxWidthClassName="max-w-[220px] shrink-0"
        dataTestId="create-work-item-project-select"
      />
    );

  const workItemPillBreadcrumb = (
    <div
      className="flex min-w-0 flex-nowrap items-center gap-1.5"
      data-testid="create-work-item-pill-breadcrumb"
    >
      {projectBreadcrumbSegment}
    </div>
  );

  const stubWorkItem = workItemDraftToStubWorkItem(draft, selectedProjectName);

  const inlinePropertyPills = !propertiesOpen ? (
    <div data-testid="create-work-item-property-pills">
      <WorkItemProperties
        statusOrgId={effectiveOrgId}
        workItem={stubWorkItem}
        onUpdate={handlePropertyUpdate}
        availableProjects={resolvedProjects}
        availableMilestones={availableMilestones}
        availableLabels={resolvedLabels}
        availableMembers={resolvedMembers}
        visibleFields={CREATE_WORK_ITEM_INLINE_FIELDS}
        fieldVariant="pill"
        showMoreMenu
      />
    </div>
  ) : undefined;

  const workItemTitlePlaceholder = t("workItems.titlePlaceholder");
  const optionalWorkItemTitlePlaceholder = `${workItemTitlePlaceholder} (${t("common:optional")})`;
  const titleSection = (
    <CreateComposerTitleInput
      value={draft.name}
      onChange={handleTitleChange}
      placeholder={
        aiGenerateMode
          ? optionalWorkItemTitlePlaceholder
          : workItemTitlePlaceholder
      }
      dataTestId="create-work-item-title-input"
      autoFocus={!dockedComposer}
    />
  );

  return {
    projectBreadcrumbSegment,
    workItemPillBreadcrumb,
    stubWorkItem,
    inlinePropertyPills,
    titleSection,
  };
}
