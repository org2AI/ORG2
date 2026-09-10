import type { TFunction } from "i18next";

import { ICONS } from "../../config";
import type { SpotlightItem } from "../../types";
import type { WorkingDirectoryPaletteText } from "./types";

interface BuildPinnedWorkingDirectoryActionsArgs {
  isManageMode: boolean;
  selectedCount: number;
  paletteText: WorkingDirectoryPaletteText;
  t: TFunction;
  onOpenWorkingDirectory: () => void;
  onOpenAddMenu: () => void;
  onCreateWorkspace: () => void;
  onBulkDelete: () => void;
  onToggleManageMode: () => void;
}

export function buildPinnedWorkingDirectoryActions({
  isManageMode,
  selectedCount,
  paletteText,
  t,
  onOpenWorkingDirectory,
  onOpenAddMenu,
  onCreateWorkspace,
  onBulkDelete,
  onToggleManageMode,
}: BuildPinnedWorkingDirectoryActionsArgs): SpotlightItem[] {
  const actions: SpotlightItem[] = [];

  if (!isManageMode) {
    actions.push(
      {
        id: "pinned-open-workspace-entry",
        label: paletteText.openFolderLabel,
        icon: ICONS.folderOpen,
        type: "action",
        action: onOpenWorkingDirectory,
      },
      {
        id: "pinned-create-workspace-entry",
        label: t(
          "workspaceForm.createWorkspace",
          "Create Multi-repo Working Directory"
        ),
        icon: ICONS.workspace,
        type: "action",
        data: { showDisclosureChevron: true },
        action: onCreateWorkspace,
      },
      {
        id: "pinned-add-entry",
        label: `${paletteText.addEntryLabel}...`,
        icon: ICONS.addWorkspace,
        type: "action",
        data: { showDisclosureChevron: true },
        action: onOpenAddMenu,
      }
    );
  }

  if (isManageMode && selectedCount > 0) {
    actions.push({
      id: "pinned-delete-selected-entry",
      label: t("actions.removeFromOrgiiCount", { count: selectedCount }),
      icon: ICONS.removeRepo,
      type: "action",
      data: { isDanger: true },
      action: onBulkDelete,
    });
  }

  actions.push({
    id: "pinned-manage-entry",
    label: isManageMode
      ? t("actions.done", "Done")
      : t("actions.manage", "Manage"),
    icon: isManageMode ? ICONS.done : ICONS.config,
    type: "action",
    data: isManageMode ? undefined : { showDisclosureChevron: true },
    action: onToggleManageMode,
  });

  return actions;
}
