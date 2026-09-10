/**
 * Kanban View State atoms.
 *
 * Holds the bits of `TaskKanban` UI state that must survive when the user
 * toggles between Kanban and Canvas views (which unmounts `KanbanBoard`)
 * or briefly navigates away and comes back.
 *
 * Tier split mirrors the rest of the app:
 *   - `kanbanTimeFilterAtom` is a real user preference (the pill choice
 *     should outlive a reload), so it persists to localStorage — same
 *     pattern as `creatorDefaultExecModeAtom` (`orgii:agentExecMode`).
 *   - `kanbanSelectedTaskIdAtom` and `kanbanDetailPanelVisibleAtom` are
 *     transient session state. Module-level Jotai atoms are enough to
 *     survive remounts during navigation while still resetting on reload,
 *     so route transitions do not discard the user's board preferences.
 *
 * Selection is stored as the task **id**, not the `KanbanTask` object:
 * the task list is rebuilt every render from live session data, so
 * snapshotting the object would freeze status / unread badges. Callers
 * re-resolve via `tasks.find(t => t.id === selectedTaskId)`.
 */
import { atom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import {
  DEFAULT_KANBAN_TIME_FILTER,
  KANBAN_AGENT_TYPE_FILTER,
  KANBAN_SIDEBAR_FILTER,
  type KanbanAgentTypeFilter,
  type KanbanAutoArchiveTtl,
  type KanbanSidebarFilter,
  type KanbanTimeFilter,
} from "@src/features/TaskKanban/config";
import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

const AGENT_TYPE_FILTER_STORAGE_KEY = "orgii:kanbanAgentTypeFilter";
const SIDEBAR_FILTER_STORAGE_KEY = "orgii:kanbanSidebarFilter";
const TIME_FILTER_STORAGE_KEY = "orgii:kanbanTimeFilter";
const AUTO_ARCHIVE_TTL_STORAGE_KEY = "orgii:kanbanAutoArchiveTtl";
const MANUAL_ARCHIVED_STORAGE_KEY = "orgii:kanbanManualArchivedSessions";
const MAX_MANUAL_ARCHIVED_SESSION_IDS = 1000;

const StoredAgentTypeFilterSchema = z.string().min(1);

const StoredSidebarFilterSchema = z.enum(Object.values(KANBAN_SIDEBAR_FILTER));

const StoredTimeFilterSchema = z.enum(["12h", "24h", "3d", "7d"]);

const StoredAutoArchiveTtlSchema = z.enum(["never", "12h", "24h", "3d", "7d"]);

const StoredManualArchivedSessionIdsSchema = z
  .array(z.unknown())
  .transform((value) =>
    value
      .filter((item): item is string => typeof item === "string")
      .slice(0, MAX_MANUAL_ARCHIVED_SESSION_IDS)
  );

export const kanbanAgentTypeFilterAtom = atomWithStorage<KanbanAgentTypeFilter>(
  AGENT_TYPE_FILTER_STORAGE_KEY,
  KANBAN_AGENT_TYPE_FILTER.ALL,
  createZodJsonStorage(StoredAgentTypeFilterSchema),
  { getOnInit: true }
);
kanbanAgentTypeFilterAtom.debugLabel = "kanban/agentTypeFilter";

export const kanbanSidebarFilterAtom = atomWithStorage<KanbanSidebarFilter>(
  SIDEBAR_FILTER_STORAGE_KEY,
  KANBAN_SIDEBAR_FILTER.ALL,
  createZodJsonStorage(StoredSidebarFilterSchema),
  { getOnInit: true }
);
kanbanSidebarFilterAtom.debugLabel = "kanban/sidebarFilter";

/** Persisted user preference — the active time-window pill. */
export const kanbanTimeFilterAtom = atomWithStorage<KanbanTimeFilter>(
  TIME_FILTER_STORAGE_KEY,
  DEFAULT_KANBAN_TIME_FILTER,
  createZodJsonStorage(StoredTimeFilterSchema),
  { getOnInit: true }
);
kanbanTimeFilterAtom.debugLabel = "kanban/timeFilter";

export const kanbanAutoArchiveTtlAtom = atomWithStorage<KanbanAutoArchiveTtl>(
  AUTO_ARCHIVE_TTL_STORAGE_KEY,
  "24h",
  createZodJsonStorage(StoredAutoArchiveTtlSchema),
  { getOnInit: true }
);
kanbanAutoArchiveTtlAtom.debugLabel = "kanban/autoArchiveTtl";

export const kanbanManualArchivedSessionIdsAtom = atomWithStorage<string[]>(
  MANUAL_ARCHIVED_STORAGE_KEY,
  [],
  createZodJsonStorage(StoredManualArchivedSessionIdsSchema, {
    serialize: (value) =>
      JSON.stringify(value.slice(0, MAX_MANUAL_ARCHIVED_SESSION_IDS)),
  }),
  { getOnInit: true }
);
kanbanManualArchivedSessionIdsAtom.debugLabel =
  "kanban/manualArchivedSessionIds";

export const kanbanManualArchivedSessionsAtom = atom<Set<string>>((get) => {
  return new Set(get(kanbanManualArchivedSessionIdsAtom));
});
kanbanManualArchivedSessionsAtom.debugLabel = "kanban/manualArchivedSessions";

/** Currently previewed task id. `null` when no task is selected. */
export const kanbanSelectedTaskIdAtom = atom<string | null>(null);
kanbanSelectedTaskIdAtom.debugLabel = "kanban/selectedTaskId";

/** Whether the floating session-preview panel is visible. */
export const kanbanDetailPanelVisibleAtom = atom<boolean>(false);
kanbanDetailPanelVisibleAtom.debugLabel = "kanban/detailPanelVisible";

/**
 * Team-session card currently previewed on the board, paired with the local
 * session id its remote import materializes. The cloud card carries no
 * `session_id` of its own, and the imported copy only joins the board once
 * the transcript lands — this is what lets the preview render the session in
 * between. Transient, like the selection atoms above.
 */
export interface KanbanCloudPreviewTarget {
  /** Cloud task id (`cloud-remote:<row id>`) that was clicked. */
  taskId: string;
  /** Local session id the remote import writes into. */
  sessionId: string;
}
export const kanbanCloudPreviewTargetAtom =
  atom<KanbanCloudPreviewTarget | null>(null);
kanbanCloudPreviewTargetAtom.debugLabel = "kanban/cloudPreviewTarget";

/** Transient session-name query; intentionally resets on app reload. */
export const kanbanSearchQueryAtom = atom<string>("");
kanbanSearchQueryAtom.debugLabel = "kanban/searchQuery";
