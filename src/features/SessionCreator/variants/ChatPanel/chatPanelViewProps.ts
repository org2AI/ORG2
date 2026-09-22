/**
 * SessionCreatorChatPanel — view prop builders.
 *
 * The two largest prop bags handed to `SessionCreatorChatPanelView` (the
 * composer `EditorArea` and the `SessionInfoLine`) are assembled here from
 * the hook results the panel already owns, so the panel body stays a
 * readable list of hook calls followed by the view.
 */
import type { TFunction } from "i18next";
import type React from "react";

import type { useSessionCreator } from "@src/engines/SessionCore/hooks/session/useSessionCreator";

import type SessionCreatorChatPanelView from "./SessionCreatorChatPanelView";
import { shouldUseCreatorComposerBreathing } from "./repoChromeLayout";
import type { SessionCreatorChatPanelSingleProps } from "./types";
import type { useChatPanelDraftRestore } from "./useChatPanelDraftRestore";
import type { useChatPanelHeroPresentation } from "./useChatPanelHeroPresentation";
import type { useChatPanelLaunch } from "./useChatPanelLaunch";
import type { useChatPanelMultiRunner } from "./useChatPanelMultiRunner";
import type { useChatPanelWorktreeSelection } from "./useChatPanelWorktreeSelection";
import type { useSessionCreatorChatPanelHandlers } from "./useSessionCreatorChatPanelHandlers";

type SessionCreatorChatPanelViewProps = React.ComponentProps<
  typeof SessionCreatorChatPanelView
>;
type EditorAreaProps = SessionCreatorChatPanelViewProps["editorAreaProps"];
type SessionInfoProps = SessionCreatorChatPanelViewProps["sessionInfoProps"];

type SessionCreatorResult = ReturnType<typeof useSessionCreator>;
type HeroPresentation = ReturnType<typeof useChatPanelHeroPresentation>;
type MultiRunner = ReturnType<typeof useChatPanelMultiRunner>;
type WorktreeSelection = ReturnType<typeof useChatPanelWorktreeSelection>;
type PanelHandlers = ReturnType<typeof useSessionCreatorChatPanelHandlers>;
type DraftRestore = ReturnType<typeof useChatPanelDraftRestore>;
type PanelLaunch = ReturnType<typeof useChatPanelLaunch>;

// ── EditorArea ────────────────────────────────────────────────────────────────

interface ChatPanelEditorAreaPropsInput extends Pick<
  SessionCreatorChatPanelSingleProps,
  | "layout"
  | "hideRepoLine"
  | "headerLayout"
  | "initialContent"
  | "dropdownDirection"
> {
  creator: SessionCreatorResult;
  hero: Pick<
    HeroPresentation,
    | "displayedRepoId"
    | "displayedRepoName"
    | "currentRepoPath"
    | "sessionRepoId"
    | "effectiveBranchName"
  >;
  multiRunner: Pick<MultiRunner, "isActive" | "isLaunching">;
  draft: DraftRestore;
  launch: Pick<PanelLaunch, "humanCreating">;
  handlers: Pick<PanelHandlers, "requestModelOpen" | "setRequestModelOpen">;
  isHumanMode: boolean;
  isOSMode: boolean;
  humanNoteHasContent: boolean;
  composerCanLaunch: boolean;
  currentRepoKind: EditorAreaProps["repoKind"];
  repoChromePosition: SessionCreatorChatPanelViewProps["repoChromePosition"];
  handleComposerLaunch: () => void;
  handleAdvancedConfigChange: EditorAreaProps["onAdvancedConfigChange"];
  t: TFunction<"sessions">;
}

export function buildChatPanelEditorAreaProps({
  creator,
  hero,
  multiRunner,
  draft,
  launch,
  handlers,
  isHumanMode,
  isOSMode,
  humanNoteHasContent,
  composerCanLaunch,
  currentRepoKind,
  repoChromePosition,
  handleComposerLaunch,
  handleAdvancedConfigChange,
  layout,
  hideRepoLine,
  headerLayout,
  initialContent,
  dropdownDirection,
  t,
}: ChatPanelEditorAreaPropsInput): EditorAreaProps {
  const {
    composerInputRef,
    uploadedFiles,
    isLoading,
    advancedConfig,
    showContextMenu,
    setShowContextMenu,
    atSearchQuery,
    setAtSearchQuery,
    handleRemoveFile,
    handleUploadClick,
    handleAtMention,
    handleAtMentionClose,
    handleAtSelect,
    handleBranchChange,
    attachedImages,
    handleImagePaste,
    removeImage,
    slashCommandKeyboardHandlerRef,
    showSlashMenu,
    slashQuery,
    handleSlashCommand,
    handleSlashCommandClose,
    handleSlashSelect,
    handleModeSelect,
    currentMode,
    includeProjectMode,
    filteredSlashItems,
    slashLoading,
  } = creator;
  const {
    displayedRepoId,
    displayedRepoName,
    currentRepoPath,
    sessionRepoId,
    effectiveBranchName,
  } = hero;
  const { handleContentChangeWithTracking, initialRestoreText } = draft;
  const { humanCreating } = launch;
  const { requestModelOpen, setRequestModelOpen } = handlers;

  return {
    variant: "chatPanelFullScreen",
    uploadedFiles: isHumanMode ? [] : uploadedFiles,
    onRemoveFile: handleRemoveFile,
    composerInputRef,
    onContentChange: handleContentChangeWithTracking,
    onAtMention: handleAtMention,
    onAtMentionClose: handleAtMentionClose,
    onSubmit: handleComposerLaunch,
    showContextMenu,
    setShowContextMenu,
    atSearchQuery,
    setAtSearchQuery,
    onAtSelect: handleAtSelect,
    repoPath: currentRepoPath,
    onUploadClick: isHumanMode ? () => undefined : handleUploadClick,
    isLoading: isHumanMode
      ? humanCreating
      : isLoading || multiRunner.isLaunching,
    onLaunch: handleComposerLaunch,
    advancedConfig,
    onAdvancedConfigChange: handleAdvancedConfigChange,
    hideInfoLine: true,
    repoId: displayedRepoId,
    repoName: displayedRepoName,
    repoKind: isOSMode && !sessionRepoId ? undefined : currentRepoKind,
    branchName: isOSMode && !sessionRepoId ? undefined : effectiveBranchName,
    onBranchChange: handleBranchChange,
    onImagePaste: isHumanMode ? undefined : handleImagePaste,
    attachedImages: isHumanMode ? [] : attachedImages,
    onRemoveImage: isHumanMode ? undefined : removeImage,
    launchDisabled: isHumanMode ? !humanNoteHasContent : !composerCanLaunch,
    launchAriaLabel: isHumanMode ? t("humanSession.createAction") : undefined,
    // Model belongs to a runner in multi mode; a second picker in the
    // composer would be lying about which runner it applies to.
    hideModelSourcePill: isHumanMode || multiRunner.isActive,
    editorPlaceholder: isHumanMode
      ? t("humanSession.createPlaceholder")
      : undefined,
    requestModelOpen: isHumanMode ? false : requestModelOpen,
    onModelOpenHandled: () => setRequestModelOpen(false),
    shellClassName: `session-creator-chat-panel-fullscreen-input-shell ${
      shouldUseCreatorComposerBreathing(
        layout === "launchpad",
        repoChromePosition,
        !hideRepoLine && headerLayout !== "compact"
      )
        ? "composer-breathing"
        : ""
    }`.trim(),
    initialContent: initialRestoreText || initialContent || undefined,
    autoFocus: !isHumanMode,
    showSlashMenu,
    slashQuery,
    slashCommandKeyboardHandlerRef,
    onSlashCommand: handleSlashCommand,
    onSlashCommandClose: handleSlashCommandClose,
    onSlashSelect: handleSlashSelect,
    onModeSelect: handleModeSelect,
    currentMode,
    includeProjectMode: isHumanMode ? false : includeProjectMode,
    filteredSlashItems,
    slashLoading,
    dropdownDirection,
  };
}

// ── SessionInfoLine ───────────────────────────────────────────────────────────

interface ChatPanelSessionInfoPropsInput {
  hero: Pick<
    HeroPresentation,
    | "displayedRepoId"
    | "displayedRepoName"
    | "currentRepoPath"
    | "sessionRepoId"
    | "sessionRepoKind"
    | "effectiveBranchName"
    | "isDisplayedSystemPath"
  >;
  handlers: Pick<
    PanelHandlers,
    "handleRepoChange" | "handleRepoSelectForSession"
  >;
  worktree: Pick<
    WorktreeSelection,
    "runningLocation" | "activeWorktreeSelection" | "handleWorktreeSourceSelect"
  >;
  multiRunner: Pick<
    MultiRunner,
    "isActive" | "worktreeSourceLabel" | "handleWorktreeLocationChange"
  >;
  handleBranchChange: SessionCreatorResult["handleBranchChange"];
  isOSMode: boolean;
  isSDEMode: boolean;
  branchLoading: boolean;
}

export function buildChatPanelSessionInfoProps({
  hero,
  handlers,
  worktree,
  multiRunner,
  handleBranchChange,
  isOSMode,
  isSDEMode,
  branchLoading,
}: ChatPanelSessionInfoPropsInput): SessionInfoProps {
  const {
    displayedRepoId,
    displayedRepoName,
    currentRepoPath,
    sessionRepoId,
    sessionRepoKind,
    effectiveBranchName,
    isDisplayedSystemPath,
  } = hero;
  const { handleRepoChange, handleRepoSelectForSession } = handlers;
  const {
    runningLocation,
    activeWorktreeSelection,
    handleWorktreeSourceSelect,
  } = worktree;

  return {
    repoId: displayedRepoId,
    repoName: displayedRepoName,
    repoPath: currentRepoPath,
    onRepoChange: handleRepoChange,
    onRepoSelect: handleRepoSelectForSession,
    repoKind: sessionRepoKind,
    includeSystemPaths: isOSMode || isSDEMode,
    branchName: isOSMode && !sessionRepoId ? undefined : effectiveBranchName,
    branchLoading: branchLoading && !effectiveBranchName,
    onBranchChange: handleBranchChange,
    // Multi-runner always isolates (see useMultiRunnerLaunch); the pill
    // reports that rather than the launcher's stored preference.
    worktreeLocation: isDisplayedSystemPath
      ? undefined
      : multiRunner.isActive
        ? "worktree"
        : runningLocation,
    worktreeLocationLabel: multiRunner.worktreeSourceLabel,
    worktreeSourceLabel:
      runningLocation === "worktree" || multiRunner.isActive
        ? activeWorktreeSelection?.source.sourceRef?.startsWith("pr:")
          ? activeWorktreeSelection.source.label
          : (activeWorktreeSelection?.source.title ??
            activeWorktreeSelection?.source.baseBranch)
        : undefined,
    worktreeSource: activeWorktreeSelection?.source,
    selectedWorktreePath:
      activeWorktreeSelection?.source.existingWorktreePath ?? null,
    onWorktreeLocationChange: multiRunner.handleWorktreeLocationChange,
    onWorktreeSourceSelect: handleWorktreeSourceSelect,
    fullWidth: true,
  };
}
