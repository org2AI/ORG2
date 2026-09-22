/**
 * SessionCreatorChatPanel — composer and repository chrome view props.
 *
 * The two view sections assembled around the prop bags in
 * `chatPanelViewProps.ts`: the composer (its `EditorArea` props, send gate,
 * header content, file upload and screen share) and the repository chrome
 * (the `SessionInfoLine` props and its movable row).
 */
import type { TFunction } from "i18next";

import { createLogger } from "@src/hooks/logger";

import ChatPanelHumanSessionHeader from "./ChatPanelHumanSessionHeader";
import {
  buildChatPanelEditorAreaProps,
  buildChatPanelSessionInfoProps,
} from "./chatPanelViewProps";
import type { SessionCreatorChatPanelViewProps as ViewProps } from "./chatPanelViewTypes";
import type { SessionCreatorChatPanelSingleProps } from "./types";
import type { useChatPanelAgentMode } from "./useChatPanelAgentMode";
import type { useChatPanelLaunchControls } from "./useChatPanelLaunchControls";
import type { useChatPanelLaunchFlow } from "./useChatPanelLaunchFlow";
import type { useChatPanelPresentation } from "./useChatPanelPresentation";
import type { useChatPanelSelectionHandlers } from "./useChatPanelSelectionHandlers";
import type { useChatPanelSessionCreator } from "./useChatPanelSessionCreator";

const log = createLogger("ChatPanel");

type AgentMode = ReturnType<typeof useChatPanelAgentMode>;
type SessionCreator = ReturnType<typeof useChatPanelSessionCreator>;
type SelectionHandlers = ReturnType<typeof useChatPanelSelectionHandlers>;
type LaunchFlow = ReturnType<typeof useChatPanelLaunchFlow>;
type Presentation = ReturnType<typeof useChatPanelPresentation>;
type LaunchControls = ReturnType<typeof useChatPanelLaunchControls>;

// ── Composer ──────────────────────────────────────────────────────────────────

interface ChatPanelComposerViewPropsInput
  extends
    Pick<
      ViewProps,
      | "composerHeaderContent"
      | "headerLayout"
      | "hideRepoLine"
      | "repoChromePosition"
    >,
    Pick<
      SessionCreatorChatPanelSingleProps,
      "dropdownDirection" | "initialContent" | "layout"
    > {
  launchControls: LaunchControls;
  launchFlow: LaunchFlow;
  mode: AgentMode;
  presentation: Presentation;
  selection: SelectionHandlers;
  session: SessionCreator;
  t: TFunction<"sessions">;
}

/** Composer body and send, its header content, file upload and screen share. */
export function buildChatPanelComposerViewProps({
  composerHeaderContent,
  dropdownDirection,
  headerLayout,
  hideRepoLine,
  initialContent,
  launchControls: { composerCanLaunch, handleComposerLaunch, multiRunner },
  launchFlow: { draft, humanNoteHasContent, launch },
  layout,
  mode: { isCliTuiMode, isHumanMode, isOSMode, isWingmanMode },
  presentation: { hero },
  repoChromePosition,
  selection: { handleAdvancedConfigChange, handlers },
  session: { creator, currentRepo },
  t,
}: ChatPanelComposerViewPropsInput): Pick<
  ViewProps,
  | "canLaunch"
  | "composerHeaderContent"
  | "composerInputRef"
  | "editorAreaProps"
  | "fileInputRef"
  | "isCliTuiMode"
  | "isLoading"
  | "isWingmanMode"
  | "onFileUpload"
  | "onLaunch"
  | "onShareScreen"
  | "screenPickerProps"
> {
  const { composerInputRef, fileInputRef, handleFileUpload, isLoading } =
    creator;
  const {
    handleScreenPicked,
    handleShareScreenClick,
    screenPickerMonitors,
    setScreenPickerMonitors,
  } = handlers;
  const { humanCreating, humanTitle, setHumanTitle } = launch;

  return {
    canLaunch: isHumanMode ? humanNoteHasContent : composerCanLaunch,
    composerHeaderContent: isHumanMode ? (
      <ChatPanelHumanSessionHeader
        humanTitle={humanTitle}
        setHumanTitle={setHumanTitle}
        humanCreating={humanCreating}
        t={t}
      />
    ) : (
      composerHeaderContent
    ),
    composerInputRef,
    editorAreaProps: buildChatPanelEditorAreaProps({
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
      currentRepoKind: currentRepo?.kind,
      repoChromePosition,
      handleComposerLaunch,
      handleAdvancedConfigChange,
      layout,
      hideRepoLine,
      headerLayout,
      initialContent,
      dropdownDirection,
      t,
    }),
    fileInputRef,
    isCliTuiMode,
    isLoading: isHumanMode
      ? humanCreating
      : isLoading || multiRunner.isLaunching,
    isWingmanMode,
    onFileUpload: handleFileUpload,
    onLaunch: handleComposerLaunch,
    onShareScreen: () => handleShareScreenClick().catch(log.error),
    screenPickerProps: screenPickerMonitors
      ? {
          monitors: screenPickerMonitors,
          onSelect: handleScreenPicked,
          onClose: () => setScreenPickerMonitors(null),
        }
      : undefined,
  };
}

// ── Repository chrome ─────────────────────────────────────────────────────────

interface ChatPanelRepoChromeViewPropsInput extends Pick<
  ViewProps,
  "hideRepoLine" | "pinnedActionsVisible" | "repoChromePosition"
> {
  launchControls: LaunchControls;
  mode: AgentMode;
  presentation: Presentation;
  selection: SelectionHandlers;
  session: SessionCreator;
  setPinnedActionsVisible: ViewProps["onPinnedActionsVisibleChange"];
  setRepoChromePositionPreference: ViewProps["onRepoChromePositionChange"];
}

/** Session info pills, their movable row and the CLI launch-mode switch. */
export function buildChatPanelRepoChromeViewProps({
  hideRepoLine,
  launchControls: { cliLaunchModeSwitch, multiRunner },
  mode: { isOSMode, isSDEMode },
  pinnedActionsVisible,
  presentation: { hero },
  repoChromePosition,
  selection: { handlers },
  session: {
    branchLoading,
    creator: { handleBranchChange },
    worktree: {
      activeWorktreeSelection,
      handleWorktreeSourceSelect,
      runningLocation,
    },
  },
  setPinnedActionsVisible,
  setRepoChromePositionPreference,
}: ChatPanelRepoChromeViewPropsInput): Pick<
  ViewProps,
  | "cliLaunchModeSwitch"
  | "hideRepoLine"
  | "onPinnedActionsVisibleChange"
  | "onRepoChromePositionChange"
  | "pinnedActionsVisible"
  | "repoChromePosition"
  | "sessionInfoProps"
> {
  return {
    cliLaunchModeSwitch,
    hideRepoLine,
    onPinnedActionsVisibleChange: setPinnedActionsVisible,
    onRepoChromePositionChange: setRepoChromePositionPreference,
    pinnedActionsVisible,
    repoChromePosition,
    sessionInfoProps: buildChatPanelSessionInfoProps({
      hero,
      handlers,
      worktree: {
        runningLocation,
        activeWorktreeSelection,
        handleWorktreeSourceSelect,
      },
      multiRunner,
      handleBranchChange,
      isOSMode,
      isSDEMode,
      branchLoading,
    }),
  };
}
