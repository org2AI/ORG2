/**
 * useAddWorkingDirectoryFlow Hook
 *
 * Consolidates the add-working-directory modal flow used by the repo and
 * session-source selectors. It also exposes the saved multi-repo workspace form.
 */
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";

import { useRepoSelection } from "@src/hooks/git/useRepoSelection";
import { FolderAddIcon } from "@src/icons";

import { ICONS } from "../../config";
import type { SpotlightItem } from "../../types";
import { type UseCloneFormReturn, useCloneForm } from "./useCloneForm";
import {
  type UseCreateWorkspaceFormReturn,
  useCreateWorkspaceForm,
} from "./useCreateWorkspaceForm";
import {
  type UseWorkingDirectoryFormReturn,
  useWorkingDirectoryForm,
} from "./useWorkingDirectoryForm";

interface DragDropData {
  initialPath?: unknown;
}

function consumeDragDropInitialPath(): string | undefined {
  const raw = sessionStorage.getItem("dragDropData");
  if (!raw) return undefined;

  sessionStorage.removeItem("dragDropData");
  try {
    const parsed = JSON.parse(raw) as DragDropData;
    return typeof parsed.initialPath === "string"
      ? parsed.initialPath
      : undefined;
  } catch {
    return undefined;
  }
}

function isDirectOpenStage(stage: AddWorkingDirectoryModalStage): boolean {
  return stage === "add-workspace-existing";
}

export type AddWorkingDirectoryModalStage =
  | "add-workspace-new"
  | "add-workspace-clone"
  | "add-workspace-clone-url"
  | "add-workspace-clone-github"
  | "add-workspace-existing"
  | "create-workspace"
  | null;

interface UseAddWorkingDirectoryFlowOptions {
  modalStage: AddWorkingDirectoryModalStage;
  setModalStage: (stage: AddWorkingDirectoryModalStage) => void;
  onSuccess?: (repoId?: string) => void | Promise<void>;
  onClose?: () => void;
  onModalClose?: () => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
}

export interface UseAddWorkingDirectoryFlowReturn {
  workingDirectoryForm: UseWorkingDirectoryFormReturn;
  cloneForm: UseCloneFormReturn;
  multiRepoWorkspaceForm: UseCreateWorkspaceFormReturn;
  addWorkingDirectoryItems: SpotlightItem[];
  getModalSourceLabel: (stage: AddWorkingDirectoryModalStage) => string;
  getModalActionLabel: (stage: AddWorkingDirectoryModalStage) => string;
  handleGoBack: () => void;
  isLoading: boolean;
  actionPathSegment: {
    type: "action";
    id: string;
    label: string;
    icon: SpotlightItem["icon"];
    color: string;
    data: {
      template: string;
      requiredParams: string[];
    };
  };
  getSourceSegment: (stage: AddWorkingDirectoryModalStage) => {
    id: string;
    type: "source";
    label: string;
    icon: SpotlightItem["icon"];
    color: string;
  } | null;
}

export function useAddWorkingDirectoryFlow(
  options: UseAddWorkingDirectoryFlowOptions
): UseAddWorkingDirectoryFlowReturn {
  const { t } = useTranslation();
  const {
    modalStage,
    setModalStage,
    onSuccess,
    onClose: _onClose,
    onModalClose,
    inputRef,
  } = options;

  const { forceRefreshRepos, selectRepo } = useRepoSelection({
    autoLoad: false,
  });

  const workingDirectoryForm = useWorkingDirectoryForm({
    onSuccess: async (repoId?: string) => {
      await forceRefreshRepos();
      if (repoId) selectRepo(repoId);
      setModalStage(null);
      onModalClose?.();
      await onSuccess?.(repoId);
    },
    onClose: () => {
      setModalStage(null);
      onModalClose?.();
    },
  });

  const cloneForm = useCloneForm({
    onSuccess: async (repoId?: string) => {
      await forceRefreshRepos();
      if (repoId) selectRepo(repoId);
      setModalStage(null);
      onModalClose?.();
      await onSuccess?.(repoId);
    },
    onClose: () => {
      setModalStage(null);
      onModalClose?.();
    },
  });

  const multiRepoWorkspaceForm = useCreateWorkspaceForm({
    onSuccess: () => {
      setModalStage(null);
      onModalClose?.();
    },
    onClose: () => {
      setModalStage(null);
      onModalClose?.();
    },
  });

  const workingDirectoryText = useMemo(
    () => ({
      options: {
        openWorkspace: t("actions.openFolder"),
        createWorkspace: t("selectors.repo.addOptions.createWorkspace"),
        cloneFromGitHub: t("cloneForm.titleCloneFromGitHub"),
        cloneFromGitHubUrl: t("selectors.repo.addOptions.cloneFromGitHubUrl"),
        cloneFromMyGitHub: t("selectors.repo.addOptions.cloneFromMyGitHub"),
        createMultiRepoWorkspace: t(
          "workspaceForm.createWorkspace",
          "Create Multi-repo Working Directory"
        ),
      },
      sources: {
        creatingWorkspace: t("selectors.repo.sources.creatingWorkspace"),
        cloningFromGitHub: t("selectors.repo.sources.cloningFromGitHub"),
        cloningFromGitHubUrl: t("selectors.repo.sources.cloningFromGitHubUrl"),
        cloningFromMyGitHub: t("selectors.repo.sources.cloningFromMyGitHub"),
        creatingMultiRepoWorkspace: t(
          "selectors.repo.sources.creatingMultiRepoWorkspace",
          "composing workspace"
        ),
      },
      actionPath: {
        label: t("selectors.repo.path.addBy"),
        template: t("selectors.repo.path.addByTemplate"),
      },
    }),
    [t]
  );

  const addWorkingDirectoryItems = useMemo(
    (): SpotlightItem[] => [
      {
        id: "add-workspace-existing",
        label: workingDirectoryText.options.openWorkspace,
        icon: ICONS.folderOpen,
        type: "repo" as const,
        data: { isSelector: true },
        action: () => void workingDirectoryForm.handleOpenWorkingDirectory(),
      },
      {
        id: "add-workspace-new",
        label: workingDirectoryText.options.createWorkspace,
        icon: ICONS.newRepo,
        type: "repo" as const,
        data: { isSelector: true },
        action: () => setModalStage("add-workspace-new"),
      },
      {
        id: "add-workspace-clone-url",
        label: workingDirectoryText.options.cloneFromGitHubUrl,
        icon: ICONS.cloneRepoUrl,
        type: "repo" as const,
        data: { isSelector: true },
        action: () => setModalStage("add-workspace-clone-url"),
      },
      {
        id: "add-workspace-clone-github",
        label: workingDirectoryText.options.cloneFromMyGitHub,
        icon: ICONS.cloneRepo,
        type: "repo" as const,
        data: { isSelector: true },
        action: () => setModalStage("add-workspace-clone-github"),
      },
    ],
    [workingDirectoryText, workingDirectoryForm, setModalStage]
  );

  const getModalSourceLabel = useCallback(
    (stage: AddWorkingDirectoryModalStage): string => {
      switch (stage) {
        case "add-workspace-new":
          return workingDirectoryText.sources.creatingWorkspace;
        case "add-workspace-clone":
          return workingDirectoryText.sources.cloningFromGitHub;
        case "add-workspace-clone-url":
          return workingDirectoryText.sources.cloningFromGitHubUrl;
        case "add-workspace-clone-github":
          return workingDirectoryText.sources.cloningFromMyGitHub;
        case "create-workspace":
          return workingDirectoryText.sources.creatingMultiRepoWorkspace;
        default:
          return "";
      }
    },
    [workingDirectoryText]
  );

  const getModalActionLabel = useCallback(
    (stage: AddWorkingDirectoryModalStage): string => {
      switch (stage) {
        case "add-workspace-new":
          return workingDirectoryText.options.createWorkspace;
        case "add-workspace-clone":
          return workingDirectoryText.options.cloneFromGitHub;
        case "add-workspace-clone-url":
          return workingDirectoryText.options.cloneFromGitHubUrl;
        case "add-workspace-clone-github":
          return workingDirectoryText.options.cloneFromMyGitHub;
        case "create-workspace":
          return workingDirectoryText.options.createMultiRepoWorkspace;
        default:
          return "";
      }
    },
    [workingDirectoryText]
  );

  const handleGoBack = useCallback(() => {
    setModalStage(null);
  }, [setModalStage]);

  const actionPathSegment = useMemo(
    () => ({
      type: "action" as const,
      id: "add-workspace",
      label: workingDirectoryText.actionPath.label,
      icon: FolderAddIcon,
      color: "",
      data: {
        template: workingDirectoryText.actionPath.template,
        requiredParams: ["source"],
      },
    }),
    [workingDirectoryText]
  );

  const getSourceSegment = useCallback(
    (stage: AddWorkingDirectoryModalStage) => {
      if (!stage) return null;
      const icon =
        stage === "add-workspace-new" ? ICONS.newRepo : FolderAddIcon;
      return {
        id: stage,
        type: "source" as const,
        label: getModalSourceLabel(stage),
        icon,
        color: "",
      };
    },
    [getModalSourceLabel]
  );

  // The form hooks return fresh object identities each render, so effects
  // must read them through this ref instead of listing them as deps — a
  // fresh-object dep re-runs the effect on EVERY render. That exact mistake
  // in the reset effect below once produced a self-sustaining ~1000
  // commits/s loop: resetForm()'s setState batch scheduled another render
  // (React can't eagerly bail a multi-setState batch even when all values
  // are unchanged), which re-created the form objects and re-fired the
  // effect — pegging the webview at ~90% CPU whenever a closed
  // WorkingDirectoryPalette was mounted (e.g. the session-creator repo pill).
  const formsRef = useRef({
    workingDirectoryForm,
    cloneForm,
    multiRepoWorkspaceForm,
  });
  useEffect(() => {
    formsRef.current = {
      workingDirectoryForm,
      cloneForm,
      multiRepoWorkspaceForm,
    };
  });

  useEffect(() => {
    if (!isDirectOpenStage(modalStage)) return;

    const initialPath = consumeDragDropInitialPath();
    setModalStage(null);
    void formsRef.current.workingDirectoryForm.handleOpenWorkingDirectory(
      initialPath
    );
  }, [modalStage, setModalStage]);

  // Reset the forms when the modal CLOSES (stage transitions to null) — not
  // on every render while it is closed (see formsRef comment above).
  const prevModalStageRef = useRef<AddWorkingDirectoryModalStage>(modalStage);

  useEffect(() => {
    const previousStage = prevModalStageRef.current;
    prevModalStageRef.current = modalStage;
    if (modalStage === null && previousStage !== null) {
      formsRef.current.workingDirectoryForm.resetForm();
      formsRef.current.cloneForm.resetForm();
      formsRef.current.multiRepoWorkspaceForm.resetForm();
    }
  }, [modalStage]);

  const hasAttemptedGitHubFetchRef = useRef(false);
  const cloneFormReposLength = cloneForm.repositories.length;
  const cloneFormIsLoading = cloneForm.isLoadingRepos;
  const cloneFormFetchRepos = cloneForm.fetchGitHubRepos;

  useEffect(() => {
    const needsGitHubFetch =
      modalStage === "add-workspace-clone-github" ||
      (modalStage === "add-workspace-clone" && cloneForm.subTab === "myGitHub");
    if (!needsGitHubFetch) {
      hasAttemptedGitHubFetchRef.current = false;
      return;
    }
    if (
      cloneFormReposLength === 0 &&
      !cloneFormIsLoading &&
      !hasAttemptedGitHubFetchRef.current &&
      cloneFormFetchRepos
    ) {
      hasAttemptedGitHubFetchRef.current = true;
      cloneFormFetchRepos();
    }
  }, [
    modalStage,
    cloneForm.subTab,
    cloneFormReposLength,
    cloneFormIsLoading,
    cloneFormFetchRepos,
  ]);

  useEffect(() => {
    if (!modalStage && inputRef?.current) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [modalStage, inputRef]);

  return {
    workingDirectoryForm,
    cloneForm,
    multiRepoWorkspaceForm,
    addWorkingDirectoryItems,
    getModalSourceLabel,
    getModalActionLabel,
    handleGoBack,
    isLoading:
      workingDirectoryForm.loading ||
      cloneForm.isLoadingRepos ||
      multiRepoWorkspaceForm.loading,
    actionPathSegment,
    getSourceSegment,
  };
}

export default useAddWorkingDirectoryFlow;
