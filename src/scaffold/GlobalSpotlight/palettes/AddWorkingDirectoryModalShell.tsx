/**
 * AddWorkingDirectoryModalShell Component
 *
 * Shared modal shell for the add-working-directory flow used by
 * WorkingDirectoryPalette.
 */
import React from "react";

import { SpotlightSearchBar } from "../components";
import type {
  AddWorkingDirectoryModalStage,
  UseAddWorkingDirectoryFlowReturn,
} from "../hooks/forms/useAddWorkingDirectoryFlow";
import { SpotlightShell } from "../shell";
import { SpotlightModalView } from "../views";

interface AddWorkingDirectoryModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  handleKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  modalStage: AddWorkingDirectoryModalStage;
  workingDirectoryFlow: UseAddWorkingDirectoryFlowReturn;
  currentRepoId?: string;
  onGoBack?: () => void;
  asBody?: boolean;
}

export const AddWorkingDirectoryModalShell: React.FC<
  AddWorkingDirectoryModalShellProps
> = ({
  isOpen,
  onClose,
  inputRef,
  handleKeyDown,
  modalStage,
  workingDirectoryFlow,
  currentRepoId,
  onGoBack,
  asBody = false,
}) => {
  if (!modalStage) return null;

  const rawSourceSegment = workingDirectoryFlow.getSourceSegment(modalStage);
  if (!rawSourceSegment) return null;

  const sourceSegment = {
    ...rawSourceSegment,
    icon: rawSourceSegment.icon ?? "",
  };

  const searchPath = [
    {
      ...sourceSegment,
      type: "action" as const,
      label: workingDirectoryFlow.getModalActionLabel(modalStage),
      icon: rawSourceSegment.icon ?? "",
    },
  ];

  const body = (
    <>
      <SpotlightSearchBar
        inputRef={inputRef}
        searchQuery=""
        onSearchQueryChange={() => {}}
        onKeyDown={handleKeyDown}
        placeholder=""
        isLoading={workingDirectoryFlow.isLoading}
        isCountingDown={false}
        hideActionClose={false}
        hideInput
        path={searchPath}
        onRemoveSegment={(index) => {
          if (index === 0) (onGoBack ?? onClose)();
          if (index === 1) workingDirectoryFlow.handleGoBack();
        }}
      />
      <SpotlightModalView
        sourceSegment={sourceSegment}
        workingDirectoryForm={workingDirectoryFlow.workingDirectoryForm}
        cloneForm={workingDirectoryFlow.cloneForm}
        multiRepoWorkspaceForm={workingDirectoryFlow.multiRepoWorkspaceForm}
        currentRepoId={currentRepoId}
        onCancel={onGoBack ?? workingDirectoryFlow.handleGoBack}
      />
    </>
  );

  if (asBody) return body;

  return (
    <SpotlightShell
      isOpen={isOpen}
      onClose={onClose}
      stopPropagation
      hasActiveAction
    >
      {body}
    </SpotlightShell>
  );
};
