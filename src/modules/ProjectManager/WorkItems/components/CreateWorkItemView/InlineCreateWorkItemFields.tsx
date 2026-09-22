import { useAtomValue } from "jotai";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { type ProjectOrg, projectApi } from "@src/api/http/project";
import type { MarkdownEditorMode } from "@src/components/MarkdownTextareaEditor";
import { INPUT_AREA_EDITOR_HEIGHT } from "@src/config/inputAreaTokens";
import { org2CloudOrgsAtom } from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import { createLogger } from "@src/hooks/logger";
import {
  useWorkItemCreatorDraft,
  useWorkItemImageInsert,
} from "@src/hooks/project";
import {
  ProjectContentEditor,
  type ProjectContentEditorRef,
} from "@src/modules/ProjectManager/shared";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";
import type { Person } from "@src/types/core/shared";
import type { WorkItemLabel, WorkItemProject } from "@src/types/core/workItem";

import WorkItemContentStack from "../WorkItemContentStack";
import type { WorkItemPropertyFieldKey } from "../WorkItemProperties/types";
import type {
  CreateWorkItemProjectOption,
  InlineCreateWorkItemFieldsState,
  UseInlineCreateWorkItemFieldsOptions,
} from "./types";
import { useInlineCreateWorkItemDraftUndo } from "./useInlineCreateWorkItemDraftUndo";
import { useInlineCreateWorkItemMetaFields } from "./useInlineCreateWorkItemMetaFields";
import { useInlineCreateWorkItemOrgScope } from "./useInlineCreateWorkItemOrgScope";

export type {
  InlineCreateWorkItemFieldsState,
  UseInlineCreateWorkItemFieldsOptions,
} from "./types";

export const CREATE_WORK_ITEM_VISIBLE_FIELDS: WorkItemPropertyFieldKey[] = [
  "project",
  "status",
  "priority",
  "assignee",
  "milestone",
  "startDate",
  "date",
  "labels",
];

export { CREATE_WORK_ITEM_INLINE_FIELDS } from "./useInlineCreateWorkItemMetaFields";

const logger = createLogger("InlineCreateWorkItemFields");

interface UseInlineCreateWorkItemLookupsOptions {
  draft: WorkItemDraft;
  projectId?: string;
  projectSlug?: string;
  availableMembers: Person[];
  availableProjects: WorkItemProject[];
}

/**
 * Picker data the creator loads for itself when the host does not supply it:
 * project orgs, projects (with their slugs), and the selected project's
 * members and labels.
 */
function useInlineCreateWorkItemLookups({
  draft,
  projectId,
  projectSlug,
  availableMembers,
  availableProjects,
}: UseInlineCreateWorkItemLookupsOptions) {
  const [loadedMembers, setLoadedMembers] = useState<Person[]>([]);
  const [loadedProjects, setLoadedProjects] = useState<
    CreateWorkItemProjectOption[]
  >([]);
  const [projectOrgs, setProjectOrgs] = useState<ProjectOrg[]>([]);
  const [loadedProjectSlugById, setLoadedProjectSlugById] = useState<
    Record<string, string>
  >({});
  const [loadedLabels, setLoadedLabels] = useState<WorkItemLabel[]>([]);

  const selectedProjectSlug =
    draft.projectId && draft.projectId === projectId
      ? projectSlug
      : draft.projectId
        ? loadedProjectSlugById[draft.projectId]
        : undefined;

  useEffect(() => {
    let cancelled = false;

    const loadOrgs = async () => {
      try {
        const orgsData = await projectApi.readOrgs();
        if (!cancelled) setProjectOrgs(orgsData);
      } catch (err) {
        logger.warn("Failed to load orgs for work item picker", err);
      }
    };

    void loadOrgs();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (availableProjects.length > 0) return;
    let cancelled = false;

    const loadProjects = async () => {
      try {
        const projectsData = await projectApi.readProjects();
        if (cancelled) return;
        setLoadedProjects(
          projectsData.map((project) => ({
            id: project.meta.id,
            name: project.meta.name,
            slug: project.slug,
            orgId: project.meta.org_id,
          }))
        );
        setLoadedProjectSlugById(
          Object.fromEntries(
            projectsData.map((project) => [project.meta.id, project.slug])
          )
        );
      } catch (err) {
        logger.warn("Failed to load projects for work item picker", err);
      }
    };

    loadProjects();
    return () => {
      cancelled = true;
    };
  }, [availableProjects.length]);

  useEffect(() => {
    if (availableMembers.length > 0 || !selectedProjectSlug) return;
    let cancelled = false;

    const loadProjectLookups = async () => {
      try {
        const [membersFile, labelsFile] = await Promise.all([
          projectApi.readMembers(selectedProjectSlug),
          projectApi.readLabels(selectedProjectSlug),
        ]);
        if (cancelled) return;

        const activeMembers: Person[] = membersFile.members
          .filter((member) => member.active !== false)
          .map((member) => ({
            id: member.id,
            name: member.name,
            email: member.email,
            avatar: member.avatar,
          }));
        setLoadedMembers(activeMembers);
        setLoadedLabels(
          labelsFile.labels.map((label) => ({
            id: label.id,
            name: label.name,
            color: label.color,
          }))
        );
      } catch (err) {
        logger.warn("Failed to load project metadata for pickers", err);
      }
    };

    loadProjectLookups();
    return () => {
      cancelled = true;
    };
  }, [selectedProjectSlug, availableMembers.length]);

  return {
    loadedMembers,
    loadedProjects,
    projectOrgs,
    loadedLabels,
    selectedProjectSlug,
  };
}

export function useInlineCreateWorkItemFields({
  draftId,
  aiGenerateMode = false,
  availableLabels = [],
  availableMembers = [],
  availableMilestones = [],
  availableProjects = [],
  chatPanelFooter = false,
  defaultProjectId,
  dockedComposer = false,
  onDraftChange,
  onSetUnsaved,
  orgId: surfaceOrgId,
  propertiesOpen = false,
  projectId,
  projectName,
  projectSlug,
  repoPath,
}: UseInlineCreateWorkItemFieldsOptions): InlineCreateWorkItemFieldsState {
  const { t } = useTranslation("projects");
  const [editorResetKey, setEditorResetKey] = useState(0);
  const [editorMode, setEditorMode] = useState<MarkdownEditorMode>("write");
  const cloudOrgs = useAtomValue(org2CloudOrgsAtom);

  const { draft, updateDraft, setDraft, resetDraft, clearDraft } =
    useWorkItemCreatorDraft({
      draftId,
      seedProjectId: projectId,
      defaultProjectId,
      onSetUnsaved,
    });

  const editorRef = useRef<ProjectContentEditorRef>(null);

  useEffect(() => {
    onDraftChange?.(draft);
  }, [draft, onDraftChange]);

  const {
    loadedMembers,
    loadedProjects,
    projectOrgs,
    loadedLabels,
    selectedProjectSlug,
  } = useInlineCreateWorkItemLookups({
    draft,
    projectId,
    projectSlug,
    availableMembers,
    availableProjects,
  });

  const { handleImageInsert } = useWorkItemImageInsert({
    projectSlug: selectedProjectSlug ?? "",
    editorRef,
  });

  const { selectableProjectOrgs, effectiveOrgId, resolvedProjects } =
    useInlineCreateWorkItemOrgScope({
      cloudOrgs,
      projectOrgs,
      surfaceOrgId,
      availableProjects,
      loadedProjects,
    });

  const resolvedMembers =
    availableMembers.length > 0 ? availableMembers : loadedMembers;
  const resolvedLabels =
    availableLabels.length > 0 ? availableLabels : loadedLabels;

  const {
    updateDraftWithUndo,
    handleTitleChange,
    handleDescriptionChange,
    handlePropertyUpdate,
  } = useInlineCreateWorkItemDraftUndo({ draft, setDraft, updateDraft });

  const {
    projectBreadcrumbSegment,
    workItemPillBreadcrumb,
    stubWorkItem,
    inlinePropertyPills,
    titleSection,
  } = useInlineCreateWorkItemMetaFields({
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
  });

  // Standalone creations carry the org explicitly, so keep the draft in step
  // with the scope even though nothing in this view can change it. Held back
  // until the org list has loaded so the first render does not stamp the
  // personal-org fallback over a real scope.
  useEffect(() => {
    if (selectableProjectOrgs.length === 0) return;
    if (draft.orgId === effectiveOrgId) return;
    updateDraft({ orgId: effectiveOrgId });
  }, [draft.orgId, effectiveOrgId, selectableProjectOrgs.length, updateDraft]);

  const showManualInputs = !(chatPanelFooter && aiGenerateMode);

  const descriptionSection = (
    <ProjectContentEditor
      key={editorResetKey}
      ref={editorRef}
      title={draft.name}
      onTitleChange={handleTitleChange}
      initialDescription={draft.description || ""}
      onDescriptionChange={handleDescriptionChange}
      titleVisible={false}
      separatorVisible={false}
      descriptionPlaceholder={t("workItems.descriptionPlaceholder")}
      onImageInsert={handleImageInsert}
      descriptionClassName="no-bottom-border [&_textarea]:pl-1.5! [&_textarea]:pt-0! [&_textarea]:text-[14px]! [&_.markdown-formatting-toolbar]:mb-1.5! [&_.markdown-formatting-toolbar]:pl-0!"
      autoFocusDescription={dockedComposer}
      // Two rows keeps the autosize floor under the explicit min height, so
      // an empty editor is exactly as tall as the session composer.
      descriptionMinRows={2}
      descriptionMinHeight={
        dockedComposer ? INPUT_AREA_EDITOR_HEIGHT.min : undefined
      }
      descriptionMaxHeight={
        dockedComposer ? INPUT_AREA_EDITOR_HEIGHT.max : "100%"
      }
      descriptionMode={editorMode}
      onDescriptionModeChange={setEditorMode}
      repoPath={repoPath}
      className="flex min-h-0 flex-1 flex-col"
      dataTestId="create-work-item-editor"
    />
  );

  const resetDraftForCreateMore = useCallback(() => {
    resetDraft(defaultProjectId);
    setEditorResetKey((value) => value + 1);
  }, [defaultProjectId, resetDraft]);

  return {
    clearDraft,
    descriptionSection,
    draft,
    editorResetKey,
    editorRef,
    editorMode,
    handlePropertyUpdate,
    inlinePropertyPills,
    resetDraftForCreateMore,
    resolvedLabels,
    resolvedMembers,
    resolvedProjects,
    selectedProjectSlug,
    setEditorMode,
    setDraft,
    showManualInputs,
    statusOrgId: effectiveOrgId,
    stubWorkItem,
    titleSection,
    updateDraft,
    workItemProjectPill: projectBreadcrumbSegment,
    workItemPillBreadcrumb,
  };
}

export interface InlineCreateWorkItemFieldsProps {
  className?: string;
  descriptionClassName?: string;
  showDividers?: boolean;
  showDescription?: boolean;
  state: InlineCreateWorkItemFieldsState;
}

export const InlineCreateWorkItemFields: React.FC<
  InlineCreateWorkItemFieldsProps
> = ({
  className = "h-full w-full",
  descriptionClassName = "min-h-0 overflow-hidden",
  showDividers = true,
  showDescription,
  state,
}) => {
  const shouldShowDescription = showDescription ?? state.showManualInputs;

  return (
    <WorkItemContentStack
      className={className}
      titleContent={state.titleSection}
      pathContent={state.workItemPillBreadcrumb}
      propertiesContent={state.inlinePropertyPills}
      descriptionContent={
        shouldShowDescription ? state.descriptionSection : undefined
      }
      descriptionFlexible={shouldShowDescription}
      metaClassName="py-2"
      titleClassName="flex h-10 items-center py-0"
      descriptionClassName={descriptionClassName}
      separatorClassName=""
      showDividers={showDividers}
    />
  );
};
