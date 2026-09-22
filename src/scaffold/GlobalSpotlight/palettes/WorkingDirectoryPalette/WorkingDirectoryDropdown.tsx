/**
 * WorkingDirectoryDropdown
 *
 * Anchored, compact variant of `WorkingDirectoryPalette` for the core switch path
 * (pick a repo / workspace). Add-source / Manage / multi-root flows are
 * intentionally absent — those remain in the Spotlight variant because
 * they include nested modal stages that don't fit a 320px anchored panel.
 *
 * Chosen by `general.modelPickerStyle === "dropdown"`. Falls through to
 * `WorkingDirectoryPalette` (Spotlight) otherwise.
 */
import { useAtomValue, useSetAtom } from "jotai";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import { repoApi } from "@src/api/tauri/repo";
import DropdownSearch from "@src/components/Dropdown/DropdownSearch";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_PANEL,
} from "@src/components/Dropdown/tokens";
import { useDropdownEngine } from "@src/hooks/dropdown";
import { cachedReposAtom } from "@src/store/repo";
import {
  isMultiRootWorkspaceAtom,
  setWorkspaceFoldersAtom,
} from "@src/store/ui/workspaceFoldersAtom";

import {
  useExternalRecentPaths,
  useSharedRepoList,
  useWorkspaceSwitch,
} from "../../hooks";
import { useWorkingDirectoryForm } from "../../hooks/forms";
import { PickerDropdownShell } from "../../shell/PickerDropdownShell";
import type { RepoItem } from "../../types";
import {
  OpenPathRow,
  RepoRow,
  WorkspaceRow,
} from "./WorkingDirectoryDropdownRows";
import { buildOpenPathItem } from "./pathActionItem";
import { useWorkingDirectoryDropdownScope } from "./useWorkingDirectoryDropdownScope";
import { buildWorkingDirectoryDropdownSections } from "./workingDirectoryDropdownSections";
import type {
  DropdownRepoItem,
  WorkingDirectoryDropdownSection,
} from "./workingDirectoryDropdownTypes";
import { importWorkingDirectoryPath } from "./workingDirectoryPathImport";

const LIST_MAX_HEIGHT = 360;
const MIN_DROPDOWN_WIDTH = 320;

interface WorkingDirectoryDropdownProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (repoId: string, repo: RepoItem) => void;
  currentRepoId?: string;
  /** Element the dropdown is anchored to. */
  anchorRef: React.RefObject<HTMLElement | null>;
  /** Preferred vertical side of the anchor. */
  placement?: "top" | "bottom" | "auto";
  /** Optional first-class system path source rows. */
  leadingRepos?: readonly RepoItem[];
  /** Row eligibility predicate (e.g. active cloud org repo scope). */
  repoFilter?: (repo: {
    repo_url?: string | null;
    fs_uri?: string | null;
  }) => boolean;
  /** Display name for the organization represented by `repoFilter`. */
  orgScopeName?: string;
}

export const WorkingDirectoryDropdown: React.FC<
  WorkingDirectoryDropdownProps
> = ({
  isOpen,
  onClose,
  onSelect,
  currentRepoId,
  anchorRef,
  placement = "bottom",
  leadingRepos = [],
  repoFilter,
  orgScopeName,
}) => {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [prevIsOpen, setPrevIsOpen] = useState(isOpen);
  if (isOpen !== prevIsOpen) {
    setPrevIsOpen(isOpen);
    if (!isOpen && searchQuery) setSearchQuery("");
  }

  const workingDirectoryForm = useWorkingDirectoryForm({
    onSuccess: async (repoId?: string) => {
      if (!repoId) return;
      const result = await repoApi.getRepoById(repoId);
      const repo = result.data;
      onSelect(repo.repo_id, {
        id: repo.repo_id,
        name: repo.name,
        fs_uri: repo.path,
        kind: repo.kind,
      });
      onClose();
    },
  });

  const { repos, filteredRepos, repoLoading, refreshReposForce } =
    useSharedRepoList(searchQuery);
  const cachedRepos = useAtomValue(cachedReposAtom);

  const existingRepoPaths = useMemo(
    () => repos.map((repo) => repo.fs_uri ?? "").filter(Boolean),
    [repos]
  );

  const { recentPathRepos: externalRecentRepos } = useExternalRecentPaths({
    enabled: isOpen,
    existingRepoPaths,
    searchQuery,
  });

  const isMultiRoot = useAtomValue(isMultiRootWorkspaceAtom);
  const dispatchSetFolders = useSetAtom(setWorkspaceFoldersAtom);

  const { workspaces, activateWorkspace } = useWorkspaceSwitch({
    repos,
    onActivate: onClose,
  });

  const { outsideOrgRepoIds, outsideOrgWorkspaceIds, filteredWorkspaces } =
    useWorkingDirectoryDropdownScope({
      repos,
      leadingRepos,
      workspaces,
      searchQuery,
      repoFilter,
    });
  const invalidPathTitle = t("selectors.repo.pathImport.invalidTitle");
  const invalidPathMessage = useCallback(
    (path: string) => t("selectors.repo.pathImport.invalidMessage", { path }),
    [t]
  );

  const openPathItem = useMemo(
    () =>
      buildOpenPathItem({
        searchQuery,
        addLabel: t("selectors.repo.pathImport.addLabel"),
        onOpenPath: (candidatePath) => {
          void importWorkingDirectoryPath({
            candidatePath,
            invalidPathTitle,
            invalidPathMessage,
            onImportWorkingDirectory:
              workingDirectoryForm.handleImportWorkingDirectory,
          });
        },
      }),
    [
      workingDirectoryForm.handleImportWorkingDirectory,
      invalidPathMessage,
      invalidPathTitle,
      searchQuery,
      t,
    ]
  );

  const sections = useMemo<WorkingDirectoryDropdownSection[]>(
    () =>
      buildWorkingDirectoryDropdownSections({
        leadingRepos,
        filteredRepos,
        externalRecentRepos,
        currentRepoId,
        cachedRepos,
        outsideOrgRepoIds,
        outsideOrgWorkspaceIds,
        filteredWorkspaces,
        searchQuery,
        openPathItem,
        orgScopeName,
        t,
      }),
    [
      filteredRepos,
      filteredWorkspaces,
      cachedRepos,
      currentRepoId,
      externalRecentRepos,
      outsideOrgRepoIds,
      outsideOrgWorkspaceIds,
      leadingRepos,
      openPathItem,
      orgScopeName,
      searchQuery,
      t,
    ]
  );

  const dropdownItems = useMemo(
    () => sections.flatMap((section) => section.items),
    [sections]
  );

  const handleSelect = useCallback(
    (item: DropdownRepoItem) => {
      if (item.kind === "openPath") {
        item.item.action?.();
        return;
      }

      if (item.kind === "workspace") {
        activateWorkspace(item.entry.workspace);
        return;
      }

      if (isMultiRoot) {
        dispatchSetFolders([], null);
      }
      if (item.repo.id.startsWith("external-recent:")) {
        const path = item.repo.fs_uri;
        if (!path) return;
        void workingDirectoryForm
          .handleImportWorkingDirectory(path)
          .then(() => {
            void refreshReposForce();
          });
        return;
      }
      onSelect(item.repo.id, item.repo);
      onClose();
    },
    [
      isMultiRoot,
      dispatchSetFolders,
      onSelect,
      onClose,
      activateWorkspace,
      workingDirectoryForm,
      refreshReposForce,
    ]
  );

  const { isPositioned, panelRef, panelPosition, keyboard } = useDropdownEngine<
    HTMLElement,
    DropdownRepoItem
  >({
    open: isOpen,
    onOpenChange: (open) => {
      if (!open) onClose();
    },
    anchorRef,
    placement,
    gap: DROPDOWN_PANEL.triggerGap,
    listNavigation: {
      items: dropdownItems,
      onSelect: handleSelect,
      initialSelectedIndex: -1,
    },
  });

  useEffect(() => {
    if (!isOpen || !isPositioned) return;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, isPositioned]);

  if (!isOpen || !isPositioned) return null;

  return (
    <PickerDropdownShell
      ref={panelRef}
      role="menu"
      position={panelPosition}
      preferredWidth={Math.max(MIN_DROPDOWN_WIDTH, panelPosition.width)}
    >
      <DropdownSearch
        ref={inputRef}
        type="text"
        value={searchQuery}
        onChange={setSearchQuery}
        placeholder={t("selectors.spotlight.placeholders.workspace")}
      />

      <div
        className={DROPDOWN_CLASSES.optionsContainerOverlay}
        style={{ maxHeight: LIST_MAX_HEIGHT }}
      >
        {repoLoading && dropdownItems.length === 0 ? (
          <div className={DROPDOWN_CLASSES.listMessage}>
            {t("status.loading")}
          </div>
        ) : dropdownItems.length === 0 ? (
          <div className={DROPDOWN_CLASSES.listMessage}>
            {t("selectors.modelSelector.noResults")}
          </div>
        ) : (
          sections.map((section) => (
            <React.Fragment key={section.key}>
              {section.label && (
                <div className={DROPDOWN_CLASSES.sectionLabel}>
                  {section.label}
                </div>
              )}
              {section.items.map((item) => {
                const index = dropdownItems.indexOf(item);
                if (item.kind === "openPath") {
                  return (
                    <OpenPathRow
                      key={item.item.id}
                      item={item.item}
                      keyboardProps={keyboard.getItemProps(index)}
                    />
                  );
                }
                if (item.kind === "workspace") {
                  return (
                    <WorkspaceRow
                      key={`workspace-${item.entry.workspace.workspaceId}`}
                      entry={item.entry}
                      keyboardProps={keyboard.getItemProps(index)}
                    />
                  );
                }
                return (
                  <RepoRow
                    key={item.repo.id}
                    repo={item.repo}
                    isCurrent={item.repo.id === currentRepoId}
                    keyboardProps={keyboard.getItemProps(index)}
                  />
                );
              })}
            </React.Fragment>
          ))
        )}
      </div>
    </PickerDropdownShell>
  );
};

WorkingDirectoryDropdown.displayName = "WorkingDirectoryDropdown";
