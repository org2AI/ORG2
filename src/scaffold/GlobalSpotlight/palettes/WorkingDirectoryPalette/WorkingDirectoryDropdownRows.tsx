/**
 * WorkingDirectoryDropdown — row presenters.
 *
 * One row per `DropdownRepoItem` kind: a saved repo / folder / system path,
 * a multi-repo workspace, and the "open this path" action row. Each row
 * wraps itself in `SpotlightDetailPane` so hovering shows the detail pane.
 */
import React from "react";

import AnyIcon from "@src/components/AnyIcon";
import { DROPDOWN_ITEM } from "@src/components/Dropdown/tokens";
import {
  isSystemHomeRepoItem,
  isSystemPathRepoItem,
} from "@src/features/SessionCreator/utils/systemPathSource";
import type { UseDropdownListNavigationReturn } from "@src/hooks/dropdown";
import { REPO_KIND } from "@src/store/repo";

import { PickerOptionRow } from "../../components/PickerOptionRow";
import { SpotlightDetailPane } from "../../components/SpotlightDetailPane";
import { ICONS } from "../../config";
import type { WorkspaceSwitchEntry } from "../../hooks";
import type { RepoItem, SpotlightItem } from "../../types";

interface RepoRowProps {
  repo: RepoItem;
  isCurrent: boolean;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

interface OpenPathRowProps {
  item: SpotlightItem;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

interface WorkspaceRowProps {
  entry: WorkspaceSwitchEntry;
  keyboardProps: ReturnType<UseDropdownListNavigationReturn["getItemProps"]>;
}

export const RepoRow: React.FC<RepoRowProps> = ({
  repo,
  isCurrent,
  keyboardProps,
}) => {
  const isSystemPath = isSystemPathRepoItem(repo);
  const Icon = isSystemHomeRepoItem(repo)
    ? ICONS.home
    : isSystemPath || repo.kind === REPO_KIND.FOLDER
      ? ICONS.folder
      : ICONS.repo;

  return (
    <SpotlightDetailPane
      item={{
        id: repo.id,
        label: repo.name,
        icon: Icon,
        type: "repo",
        data: { ...repo, isCurrentSelection: isCurrent },
      }}
    >
      <PickerOptionRow
        label={repo.name}
        selected={isCurrent}
        role="menuitem"
        testId={`repo-dropdown-row-${repo.id}`}
        keyboardProps={keyboardProps}
        icon={<AnyIcon icon={Icon} size={DROPDOWN_ITEM.iconSize} />}
      />
    </SpotlightDetailPane>
  );
};

export const WorkspaceRow: React.FC<WorkspaceRowProps> = ({
  entry,
  keyboardProps,
}) => {
  const { workspace, isActive } = entry;

  const row = (
    <PickerOptionRow
      label={workspace.name}
      selected={isActive}
      role="menuitem"
      testId={`repo-dropdown-workspace-row-${workspace.workspaceId}`}
      keyboardProps={keyboardProps}
      icon={<AnyIcon icon={ICONS.workspace} size={DROPDOWN_ITEM.iconSize} />}
    />
  );
  return (
    <SpotlightDetailPane
      item={{
        id: workspace.workspaceId,
        label: workspace.name,
        icon: ICONS.workspace,
        desc: entry.folderNames.join(", "),
        data: {
          isCurrentSelection: isActive,
          detailFolders: workspace.folders.map((folder, index) => ({
            name: entry.folderNames[index],
            path: folder.folderPath,
          })),
        },
      }}
    >
      {row}
    </SpotlightDetailPane>
  );
};

export const OpenPathRow: React.FC<OpenPathRowProps> = ({
  item,
  keyboardProps,
}) => {
  const Icon = typeof item.icon === "string" ? ICONS.folder : item.icon;

  return (
    <SpotlightDetailPane item={item}>
      <PickerOptionRow
        label={item.label}
        role="menuitem"
        testId="repo-dropdown-open-path-row"
        keyboardProps={keyboardProps}
        icon={Icon && <AnyIcon icon={Icon} size={DROPDOWN_ITEM.iconSize} />}
      />
    </SpotlightDetailPane>
  );
};
