import type React from "react";

import type { MarkdownEditorMode } from "@src/components/MarkdownTextareaEditor";
import type { ProjectContentEditorRef } from "@src/modules/ProjectManager/shared";
import type { WorkItemDraft } from "@src/store/workstation/projectManager";
import type { Person } from "@src/types/core/shared";
import type {
  WorkItem as WorkItemExtended,
  WorkItemLabel,
  WorkItemMilestone,
  WorkItemProject,
} from "@src/types/core/workItem";

export interface CreateWorkItemProjectOption extends WorkItemProject {
  slug?: string;
  orgId?: string;
}

export interface InlineCreateWorkItemFieldsState {
  descriptionSection: React.ReactNode;
  draft: WorkItemDraft;
  editorResetKey: number;
  editorRef: React.RefObject<ProjectContentEditorRef | null>;
  editorMode: MarkdownEditorMode;
  setEditorMode: React.Dispatch<React.SetStateAction<MarkdownEditorMode>>;
  handlePropertyUpdate: (updates: Partial<WorkItemExtended>) => void;
  inlinePropertyPills?: React.ReactNode;
  resetDraftForCreateMore: () => void;
  resolvedLabels: WorkItemLabel[];
  resolvedMembers: Person[];
  resolvedProjects: CreateWorkItemProjectOption[];
  selectedProjectSlug?: string;
  clearDraft: () => void;
  setDraft: (draft: WorkItemDraft) => void;
  showManualInputs: boolean;
  statusOrgId: string;
  stubWorkItem: WorkItemExtended;
  titleSection: React.ReactNode;
  updateDraft: (patch: Partial<WorkItemDraft>) => void;
  /** Project picker, scoped to the org the creator is operating under. */
  workItemProjectPill: React.ReactNode;
  workItemPillBreadcrumb: React.ReactNode;
}

export interface UseInlineCreateWorkItemFieldsOptions {
  draftId?: string;
  aiGenerateMode?: boolean;
  availableLabels?: WorkItemLabel[];
  availableMembers?: Person[];
  availableMilestones?: WorkItemMilestone[];
  availableProjects?: WorkItemProject[];
  chatPanelFooter?: boolean;
  defaultProjectId?: string;
  /**
   * Render the fields for the chat-panel composer dock rather than the
   * full-height creator page. The dock matches the session composer it swaps
   * with: same editor height range, same text size, and focus on the main
   * content instead of the title.
   */
  dockedComposer?: boolean;
  onDraftChange?: (draft: WorkItemDraft) => void;
  onSetUnsaved: (hasUnsaved: boolean) => void;
  orgId?: string | null;
  propertiesOpen?: boolean;
  projectId?: string;
  projectName?: string;
  projectSlug?: string;
  repoPath?: string | null;
}
