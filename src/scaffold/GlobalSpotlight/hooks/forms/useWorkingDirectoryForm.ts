/**
 * useWorkingDirectoryForm Hook
 *
 * Manages local working-directory creation and import state and actions.
 * Uses .git presence to decide whether a directory is a Git repository.
 */
import { open } from "@tauri-apps/plugin-dialog";
import { useAtomValue } from "jotai";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { zodActionRegistry } from "@src/ActionSystem/schema/zodRegistry";
import { repoApi } from "@src/api/tauri/repo";
import Message from "@src/components/Message";
import { createLogger } from "@src/hooks/logger";
import {
  effectiveWorkspaceDefaultRepoLocationAtom,
  workspaceCustomDefaultRepoPathAtom,
} from "@src/store/config/configAtom";
import { askNativeDialogSafely } from "@src/util/dialogs/nativeDialog";
import { resolveDefaultRepoParentPath } from "@src/util/workspace/defaultRepoPath";

const logger = createLogger("WorkingDirectoryForm");
const SYSTEM_DIRECTORY_NAMES = new Set(["desktop", "documents", "downloads"]);

function getNormalizedPathSegments(path: string): string[] {
  return path
    .replace(/^file:\/\//, "")
    .split(/[\\/]+/)
    .filter(Boolean);
}

function isSystemDirectory(path: string): boolean {
  const segments = getNormalizedPathSegments(path);
  const lastSegment = segments.at(-1)?.toLowerCase();
  return Boolean(lastSegment && SYSTEM_DIRECTORY_NAMES.has(lastSegment));
}

interface UseWorkingDirectoryFormOptions {
  onSuccess?: (repoId?: string) => Promise<void>;
  onClose?: () => void;
}

export interface UseWorkingDirectoryFormReturn {
  directoryName: string;
  setDirectoryName: (name: string) => void;
  parentDirectoryPath: string;
  setParentDirectoryPath: (path: string) => void;
  loading: boolean;
  handleChoosePath: (mode: "new" | "existing") => Promise<string | null>;
  handleCreateWorkingDirectory: (
    name: string,
    path: string
  ) => Promise<string | undefined>;
  handleImportWorkingDirectory: (
    path: string,
    options?: { promptForGitInit?: boolean }
  ) => Promise<string | undefined>;
  handleOpenWorkingDirectory: (
    initialPath?: string
  ) => Promise<string | undefined>;
  resetForm: () => void;
}

export function useWorkingDirectoryForm(
  options: UseWorkingDirectoryFormOptions = {}
): UseWorkingDirectoryFormReturn {
  const { t } = useTranslation();
  const { onSuccess, onClose } = options;
  const defaultRepoLocation = useAtomValue(
    effectiveWorkspaceDefaultRepoLocationAtom
  );
  const customDefaultRepoPath = useAtomValue(
    workspaceCustomDefaultRepoPathAtom
  );

  const [directoryName, setDirectoryName] = useState("");
  const [parentDirectoryPath, setParentDirectoryPath] = useState("");
  const [loading, setLoading] = useState(false);

  const resetForm = useCallback(() => {
    setDirectoryName("");
    setParentDirectoryPath("");
    setLoading(false);
  }, []);

  useEffect(() => {
    if (parentDirectoryPath.trim()) return;

    let cancelled = false;
    resolveDefaultRepoParentPath({
      location: defaultRepoLocation,
      customPath: customDefaultRepoPath,
    })
      .then((path) => {
        if (!cancelled && path.trim()) {
          setParentDirectoryPath(path);
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [customDefaultRepoPath, defaultRepoLocation, parentDirectoryPath]);

  const handleChoosePath = useCallback(
    async (mode: "new" | "existing"): Promise<string | null> => {
      try {
        const selected = await open({
          directory: true,
          multiple: false,
          title:
            mode === "new"
              ? t("toasts.chooseFolderNewWorkspace")
              : t("toasts.chooseExistingWorkspace"),
        });

        return selected && typeof selected === "string" ? selected : null;
      } catch (error) {
        logger.error("Failed to open folder picker:", error);
        Message.error(t("toasts.selectDirectoryFailed"));
        return null;
      }
    },
    [t]
  );

  const shouldInitializeGit = useCallback(
    async (path: string): Promise<boolean> => {
      if (isSystemDirectory(path)) return false;

      return askNativeDialogSafely(t("selectors.repo.gitInitPrompt.message"), {
        title: t("selectors.repo.gitInitPrompt.title"),
        kind: "info",
        okLabel: t("selectors.repo.gitInitPrompt.ok"),
        cancelLabel: t("selectors.repo.gitInitPrompt.cancel"),
      });
    },
    [t]
  );

  const handleCreateWorkingDirectory = useCallback(
    async (name: string, path: string): Promise<string | undefined> => {
      if (!name.trim() || !path.trim()) return undefined;

      setLoading(true);
      try {
        const requestedPath = path.trim();
        const defaultPath = await resolveDefaultRepoParentPath({
          location: defaultRepoLocation,
          customPath: customDefaultRepoPath,
        });
        const trimmedPath =
          requestedPath === defaultPath
            ? await resolveDefaultRepoParentPath({
                location: defaultRepoLocation,
                customPath: customDefaultRepoPath,
                ensureDirectory: true,
              })
            : requestedPath;
        const trimmedName = name.trim();
        const pathSeparator = trimmedPath.includes("\\") ? "\\" : "/";
        const fullPath = trimmedPath.endsWith(pathSeparator)
          ? `${trimmedPath}${trimmedName}`
          : `${trimmedPath}${pathSeparator}${trimmedName}`;

        const initializeGit = await shouldInitializeGit(fullPath);
        const result = await zodActionRegistry.execute("repo.create", {
          path: fullPath,
          name: trimmedName,
          git: initializeGit,
        });

        if (result.success) {
          const repoId = (result.data as { repo_id?: string } | undefined)
            ?.repo_id;
          Message.success(t("toasts.workspaceCreated"));
          resetForm();
          onClose?.();
          await onSuccess?.(repoId);
          return repoId;
        }

        Message.error(result.message || t("toasts.workspaceCreateFailed"));
        return undefined;
      } catch (error) {
        Message.error(
          error instanceof Error
            ? error.message
            : t("toasts.workspaceCreateFailed")
        );
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [
      customDefaultRepoPath,
      defaultRepoLocation,
      resetForm,
      onClose,
      onSuccess,
      shouldInitializeGit,
      t,
    ]
  );

  const handleImportWorkingDirectory = useCallback(
    async (
      path: string,
      options: { promptForGitInit?: boolean } = {}
    ): Promise<string | undefined> => {
      if (!path.trim()) return undefined;

      setLoading(true);
      try {
        const fsPath = path.trim();
        const isGitRepository = await repoApi.checkIsGitRepo(fsPath);
        const promptForGitInit = options.promptForGitInit ?? true;
        const initializeGit = isGitRepository
          ? true
          : promptForGitInit && (await shouldInitializeGit(fsPath));
        const result = initializeGit
          ? await repoApi.importLocalRepo({ fs_path: fsPath })
          : await repoApi.importWorkFolder({ fs_path: fsPath });
        const repoId = result.data.repo_id;
        Message.success(t("toasts.workspaceImported"));
        resetForm();
        onClose?.();
        await onSuccess?.(repoId);
        return repoId;
      } catch (error) {
        Message.error(
          error instanceof Error
            ? error.message
            : t("toasts.workspaceImportFailed")
        );
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    [resetForm, onClose, onSuccess, shouldInitializeGit, t]
  );

  const handleOpenWorkingDirectory = useCallback(
    async (initialPath?: string): Promise<string | undefined> => {
      const selectedPath = initialPath ?? (await handleChoosePath("existing"));
      if (!selectedPath) return undefined;
      return handleImportWorkingDirectory(selectedPath);
    },
    [handleChoosePath, handleImportWorkingDirectory]
  );

  return {
    directoryName,
    setDirectoryName,
    parentDirectoryPath,
    setParentDirectoryPath,
    loading,
    handleChoosePath,
    handleCreateWorkingDirectory,
    handleImportWorkingDirectory,
    handleOpenWorkingDirectory,
    resetForm,
  };
}

export default useWorkingDirectoryForm;
