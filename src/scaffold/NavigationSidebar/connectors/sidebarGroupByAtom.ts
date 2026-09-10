/**
 * Sidebar group-by preference atoms
 *
 * Persists sidebar presentation choices to localStorage so the user's
 * grouping and per-group row count survive reloads. Used only by
 * `WorkstationSidebarConnector` — keep colocated rather than promoting to
 * `src/store/`.
 */
import { atomWithStorage } from "jotai/utils";
import { z } from "zod/v4";

import { createZodJsonStorage } from "@src/util/core/storage/zodStorage";

import {
  DEFAULT_SESSION_GROUP_VISIBLE_COUNT,
  GROUP_BY_MODES,
  type GroupByMode,
  PROJECTS_GROUP_BY_MODES,
  type ProjectsGroupByMode,
  SESSION_GROUP_VISIBLE_COUNTS,
  type SessionGroupVisibleCount,
} from "./types";

const STORAGE_KEY = "orgii:sidebarGroupBy";
const HIDDEN_WORKSPACES_STORAGE_KEY = "orgii:sidebarHiddenWorkspaces";
const PINNED_WORKSPACES_STORAGE_KEY = "orgii:sidebarPinnedWorkspaces";
const PROJECTS_STORAGE_KEY = "orgii:projectsSidebarGroupBy";
const INCLUDE_EXTERNAL_STORAGE_KEY = "orgii:sidebarIncludeExternal";
const GROUP_VISIBLE_COUNT_STORAGE_KEY = "orgii:sidebarGroupVisibleCount";
const DEFAULT_MODE: GroupByMode = "byTime";
const DEFAULT_PROJECTS_MODE: ProjectsGroupByMode = "byOrg";
const DEFAULT_INCLUDE_EXTERNAL = true;

const StoredGroupByModeSchema = z.enum([...GROUP_BY_MODES]);
const StoredProjectsGroupByModeSchema = z.enum([...PROJECTS_GROUP_BY_MODES]);
const StoredIncludeExternalSchema = z.boolean();
const StoredGroupVisibleCountSchema = z.literal([
  ...SESSION_GROUP_VISIBLE_COUNTS,
]);
/** Non-empty string keys, de-duplicated; anything else in the list is dropped. */
const StoredWorkspaceKeysSchema = z
  .array(z.unknown())
  .transform((raw) =>
    Array.from(
      new Set(
        raw.filter(
          (value): value is string =>
            typeof value === "string" && value.length > 0
        )
      )
    )
  );

export const sidebarGroupByAtom = atomWithStorage<GroupByMode>(
  STORAGE_KEY,
  DEFAULT_MODE,
  createZodJsonStorage(StoredGroupByModeSchema),
  { getOnInit: true }
);
sidebarGroupByAtom.debugLabel = "sidebarGroupByAtom";

const projectsSidebarGroupByAtom = atomWithStorage<ProjectsGroupByMode>(
  PROJECTS_STORAGE_KEY,
  DEFAULT_PROJECTS_MODE,
  createZodJsonStorage(StoredProjectsGroupByModeSchema),
  { getOnInit: true }
);
projectsSidebarGroupByAtom.debugLabel = "projectsSidebarGroupByAtom";

export const sidebarIncludeExternalAtom = atomWithStorage<boolean>(
  INCLUDE_EXTERNAL_STORAGE_KEY,
  DEFAULT_INCLUDE_EXTERNAL,
  createZodJsonStorage(StoredIncludeExternalSchema),
  { getOnInit: true }
);
sidebarIncludeExternalAtom.debugLabel = "sidebarIncludeExternalAtom";

export const sidebarGroupVisibleCountAtom =
  atomWithStorage<SessionGroupVisibleCount>(
    GROUP_VISIBLE_COUNT_STORAGE_KEY,
    DEFAULT_SESSION_GROUP_VISIBLE_COUNT,
    createZodJsonStorage(StoredGroupVisibleCountSchema),
    { getOnInit: true }
  );
sidebarGroupVisibleCountAtom.debugLabel = "sidebarGroupVisibleCountAtom";

/**
 * Workspace group keys the viewer hid from the Organize-by-workspace list.
 *
 * A key is the group's repo path (or `NO_WORKSPACE_KEY`), matching the section
 * id the sidebar collapses by. Hiding is a view preference, never a filter:
 * the group still renders, sorted last and collapsed, so its sessions stay
 * reachable and the state is reversible from the same `…` menu.
 */
export const sidebarHiddenWorkspacesAtom = atomWithStorage<string[]>(
  HIDDEN_WORKSPACES_STORAGE_KEY,
  [],
  createZodJsonStorage(StoredWorkspaceKeysSchema),
  { getOnInit: true }
);
sidebarHiddenWorkspacesAtom.debugLabel = "sidebarHiddenWorkspacesAtom";

/**
 * Workspace group keys the viewer pinned. Pinned groups sort above every other
 * workspace; pinning and hiding are mutually exclusive (see
 * `useWorkspaceGroupActions`), so a key never appears in both lists.
 */
export const sidebarPinnedWorkspacesAtom = atomWithStorage<string[]>(
  PINNED_WORKSPACES_STORAGE_KEY,
  [],
  createZodJsonStorage(StoredWorkspaceKeysSchema),
  { getOnInit: true }
);
sidebarPinnedWorkspacesAtom.debugLabel = "sidebarPinnedWorkspacesAtom";
