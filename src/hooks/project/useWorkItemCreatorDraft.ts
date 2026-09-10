/**
 * Keyed creator drafts. Agent and floating manual creators keep independent
 * entries so both surfaces can remain mounted without overwriting each other.
 */
import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useEffect, useRef } from "react";

import {
  WORK_ITEM_CREATOR_DRAFT_ID,
  type WorkItemDraft,
  createDefaultWorkItemDraft,
  patchWorkItemDraftAtom,
  removeWorkItemDraftAtom,
  setWorkItemDraftAtom,
  workItemDraftsAtom,
} from "@src/store/workstation/projectManager";
import type { WorkItem as WorkItemExtended } from "@src/types/core/workItem";

export { WORK_ITEM_CREATOR_DRAFT_ID };

export interface UseWorkItemCreatorDraftOptions {
  draftId?: string;
  /** Seed project once when the draft has no project (modal launch context). */
  seedProjectId?: string;
  /** Seed project once when the draft has no project (e.g. first loaded project). */
  defaultProjectId?: string;
  onSetUnsaved?: (hasUnsaved: boolean) => void;
}

export interface UseWorkItemCreatorDraftReturn {
  draft: WorkItemDraft;
  updateDraft: (patch: Partial<WorkItemDraft>) => void;
  setDraft: (draft: WorkItemDraft) => void;
  resetDraft: (projectId?: string) => void;
  clearDraft: () => void;
}

export function workItemDraftToStubWorkItem(
  draft: WorkItemDraft,
  selectedProjectName: string
): WorkItemExtended {
  return {
    session_id: "",
    user_id: "",
    name: draft.name,
    target_date: draft.targetDate ?? null,
    updated_time: "",
    star: false,
    created_time: "",
    spec: draft.description,
    status: draft.status,
    workItemStatus: draft.status as WorkItemExtended["workItemStatus"],
    priority: draft.priority as WorkItemExtended["priority"],
    assignee: draft.assigneeId ? { id: draft.assigneeId, name: "" } : undefined,
    assigneeType: draft.assigneeType,
    orchestratorConfig: draft.orchestratorConfig,
    project: draft.projectId
      ? { id: draft.projectId, name: selectedProjectName }
      : undefined,
    milestone: draft.milestoneId
      ? { id: draft.milestoneId, name: "" }
      : undefined,
    labels: draft.labelIds.map((id) => ({ id, name: "", color: "" })),
    startDate: draft.startDate,
    endDate: draft.targetDate,
    schedule: draft.schedule,
  };
}

export function mapWorkItemUpdatesToDraftPatch(
  updates: Partial<WorkItemExtended>
): Partial<WorkItemDraft> {
  const mapped: Partial<WorkItemDraft> = {};
  if (updates.workItemStatus !== undefined) {
    mapped.status = updates.workItemStatus;
  }
  if (updates.priority !== undefined) mapped.priority = updates.priority;
  if ("assignee" in updates) mapped.assigneeId = updates.assignee?.id;
  if ("assigneeType" in updates) mapped.assigneeType = updates.assigneeType;
  if (updates.orchestratorConfig !== undefined) {
    mapped.orchestratorConfig = updates.orchestratorConfig;
  }
  if ("project" in updates) mapped.projectId = updates.project?.id;
  if ("milestone" in updates) mapped.milestoneId = updates.milestone?.id;
  if ("labels" in updates) {
    mapped.labelIds = updates.labels?.map((label) => label.id) ?? [];
  }
  if ("startDate" in updates) mapped.startDate = updates.startDate;
  if ("endDate" in updates) mapped.targetDate = updates.endDate;
  if (updates.schedule !== undefined) mapped.schedule = updates.schedule;
  return mapped;
}

export function useWorkItemCreatorDraft(
  options: UseWorkItemCreatorDraftOptions = {}
): UseWorkItemCreatorDraftReturn {
  const {
    draftId = WORK_ITEM_CREATOR_DRAFT_ID,
    seedProjectId,
    defaultProjectId,
    onSetUnsaved,
  } = options;
  const draftsMap = useAtomValue(workItemDraftsAtom);
  const setDraftAtom = useSetAtom(setWorkItemDraftAtom);
  const patchDraftAtom = useSetAtom(patchWorkItemDraftAtom);
  const removeDraftAtom = useSetAtom(removeWorkItemDraftAtom);

  const initializedRef = useRef(false);
  const seedProjectAppliedRef = useRef(false);
  const defaultProjectAppliedRef = useRef(false);

  const draft = draftsMap.get(draftId) ?? createDefaultWorkItemDraft();

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (!draftsMap.has(draftId)) {
      setDraftAtom({
        tabId: draftId,
        draft: createDefaultWorkItemDraft(),
      });
    }
  }, [draftId, draftsMap, setDraftAtom]);

  useEffect(() => {
    if (seedProjectAppliedRef.current || !seedProjectId) return;
    const existing = draftsMap.get(draftId);
    if (existing?.projectId) {
      seedProjectAppliedRef.current = true;
      return;
    }
    patchDraftAtom({
      tabId: draftId,
      patch: { projectId: seedProjectId },
    });
    seedProjectAppliedRef.current = true;
  }, [draftId, draftsMap, patchDraftAtom, seedProjectId]);

  useEffect(() => {
    if (defaultProjectAppliedRef.current || !defaultProjectId) return;
    const existing = draftsMap.get(draftId);
    if (existing?.projectId) {
      defaultProjectAppliedRef.current = true;
      return;
    }
    patchDraftAtom({
      tabId: draftId,
      patch: { projectId: defaultProjectId },
    });
    defaultProjectAppliedRef.current = true;
  }, [draftId, defaultProjectId, draftsMap, patchDraftAtom]);

  const updateDraft = useCallback(
    (patch: Partial<WorkItemDraft>) => {
      patchDraftAtom({ tabId: draftId, patch });
      onSetUnsaved?.(true);
    },
    [draftId, onSetUnsaved, patchDraftAtom]
  );

  const setDraft = useCallback(
    (nextDraft: WorkItemDraft) => {
      setDraftAtom({ tabId: draftId, draft: nextDraft });
    },
    [draftId, setDraftAtom]
  );

  const resetDraft = useCallback(
    (projectId?: string) => {
      setDraftAtom({
        tabId: draftId,
        draft: createDefaultWorkItemDraft(projectId),
      });
      onSetUnsaved?.(false);
    },
    [draftId, onSetUnsaved, setDraftAtom]
  );

  const clearDraft = useCallback(() => {
    removeDraftAtom(draftId);
    initializedRef.current = false;
    seedProjectAppliedRef.current = false;
    defaultProjectAppliedRef.current = false;
  }, [draftId, removeDraftAtom]);

  return {
    draft,
    updateDraft,
    setDraft,
    resetDraft,
    clearDraft,
  };
}
