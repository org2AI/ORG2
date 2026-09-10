import type React from "react";
import { useCallback } from "react";

import type {
  AddWorkingDirectoryModalStage,
  useAddWorkingDirectoryFlow,
} from "../../hooks";
import type { AddMenuKind, WorkingDirectoryPaletteText } from "./types";
import {
  importWorkingDirectoryPath,
  looksLikeWorkingDirectoryPath,
} from "./workingDirectoryPathImport";

interface UseWorkingDirectoryPaletteNavigationArgs {
  modalStage: AddWorkingDirectoryModalStage;
  addMenuKind: AddMenuKind;
  asBody: boolean;
  effectiveInitialStage: AddWorkingDirectoryModalStage;
  initialAddMenu: boolean;
  onClose: () => void;
  onGoBackToParent?: () => void;
  setModalStage: (stage: AddWorkingDirectoryModalStage) => void;
  setAddMenuKind: (kind: AddMenuKind) => void;
  setSearchQuery: (query: string) => void;
  workingDirectoryFlow: ReturnType<typeof useAddWorkingDirectoryFlow>;
  searchQuery: string;
  paletteText: WorkingDirectoryPaletteText;
}

export function useWorkingDirectoryPaletteNavigation({
  modalStage,
  addMenuKind,
  asBody,
  effectiveInitialStage,
  initialAddMenu,
  onClose,
  onGoBackToParent,
  setModalStage,
  setAddMenuKind,
  setSearchQuery,
  workingDirectoryFlow,
  searchQuery,
  paletteText,
}: UseWorkingDirectoryPaletteNavigationArgs) {
  const shouldReturnInitialStageToParent =
    !!onGoBackToParent && !!effectiveInitialStage;
  const shouldReturnInitialAddMenuToParent =
    !!onGoBackToParent && initialAddMenu;

  const handleGoBack = useCallback(() => {
    if (modalStage) {
      if (
        modalStage === "create-workspace" &&
        effectiveInitialStage === "create-workspace"
      ) {
        setModalStage(null);
        setAddMenuKind("add");
        setSearchQuery("");
        return;
      }

      if (shouldReturnInitialStageToParent) {
        onGoBackToParent?.();
        return;
      }

      workingDirectoryFlow.handleGoBack();
      return;
    }

    if (addMenuKind) {
      if (shouldReturnInitialAddMenuToParent) {
        onGoBackToParent?.();
        return;
      }

      setAddMenuKind(null);
      setSearchQuery("");
      return;
    }

    if (onGoBackToParent) {
      onGoBackToParent();
      return;
    }

    if (asBody) {
      onClose();
    }
  }, [
    addMenuKind,
    workingDirectoryFlow,
    asBody,
    effectiveInitialStage,
    modalStage,
    onClose,
    onGoBackToParent,
    setAddMenuKind,
    setModalStage,
    setSearchQuery,
    shouldReturnInitialAddMenuToParent,
    shouldReturnInitialStageToParent,
  ]);

  const handlePathImportSubmit = useCallback(async () => {
    if (modalStage || addMenuKind) return false;

    return importWorkingDirectoryPath({
      candidatePath: searchQuery,
      invalidPathTitle: paletteText.invalidPathTitle,
      invalidPathMessage: paletteText.invalidPathMessage,
      onImportWorkingDirectory:
        workingDirectoryFlow.workingDirectoryForm.handleImportWorkingDirectory,
    });
  }, [
    addMenuKind,
    workingDirectoryFlow.workingDirectoryForm.handleImportWorkingDirectory,
    modalStage,
    paletteText.invalidPathMessage,
    paletteText.invalidPathTitle,
    searchQuery,
  ]);

  const handleExternalKeyDown = useCallback(
    (
      event: React.KeyboardEvent<HTMLInputElement>,
      internal: (event: React.KeyboardEvent<HTMLInputElement>) => void
    ) => {
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        searchQuery === "" &&
        (!!modalStage || !!addMenuKind || asBody || !!onGoBackToParent)
      ) {
        event.preventDefault();
        handleGoBack();
        return;
      }

      if (event.key === "Enter" && looksLikeWorkingDirectoryPath(searchQuery)) {
        event.preventDefault();
        void handlePathImportSubmit();
        return;
      }

      internal(event);
    },
    [
      addMenuKind,
      asBody,
      handleGoBack,
      handlePathImportSubmit,
      modalStage,
      onGoBackToParent,
      searchQuery,
    ]
  );

  return {
    handleGoBack,
    handleExternalKeyDown,
  };
}
