/**
 * SessionCreatorChatPanel — launch controls.
 *
 * What the view offers to start work: the Compare-runners list and its group
 * launch, the composer send gate that routes between the single and the group
 * launch, and the CLI launch-mode switch and outdated-version alert.
 */
import type { TFunction } from "i18next";
import { useMemo } from "react";

import type { SessionCreatorChatPanelSingleProps } from "./types";
import type { useChatPanelAgentMode } from "./useChatPanelAgentMode";
import { useChatPanelCliChrome } from "./useChatPanelCliChrome";
import { useChatPanelComposerGate } from "./useChatPanelComposerGate";
import type { useChatPanelLaunchFlow } from "./useChatPanelLaunchFlow";
import { useChatPanelMultiRunner } from "./useChatPanelMultiRunner";
import type { useChatPanelPresentation } from "./useChatPanelPresentation";
import type { useChatPanelSessionCreator } from "./useChatPanelSessionCreator";

interface UseChatPanelLaunchControlsOptions extends Pick<
  SessionCreatorChatPanelSingleProps,
  "onExitMultiRunner" | "resolveWorkItemContext" | "workItemContext"
> {
  launchFlow: ReturnType<typeof useChatPanelLaunchFlow>;
  mode: ReturnType<typeof useChatPanelAgentMode>;
  multiRunnerLauncher: boolean;
  presentation: ReturnType<typeof useChatPanelPresentation>;
  session: ReturnType<typeof useChatPanelSessionCreator>;
  t: TFunction<"sessions">;
}

export function useChatPanelLaunchControls({
  launchFlow,
  mode,
  multiRunnerLauncher,
  onExitMultiRunner,
  presentation,
  resolveWorkItemContext,
  session,
  t,
  workItemContext,
}: UseChatPanelLaunchControlsOptions) {
  const {
    cli,
    cliAgentType,
    dispatchCategory,
    isCliMode,
    isCliTuiMode,
    isHumanMode,
    selectedAgentDefId,
  } = mode;
  const { enabledCliAgentList } = cli;
  const {
    attachedWorkItemContext,
    chatPanelLaunchContext,
    creator: {
      advancedConfig,
      attachedImages,
      canLaunch,
      clearImages,
      composerInputRef,
      editorContent,
      effectiveSource,
    },
    worktree: { handleWorktreeLocationChange },
  } = session;
  const { allAgentDefinitions } = presentation;
  const {
    launch: { handleLaunch },
  } = launchFlow;

  const composerImageDataUrls = useMemo(
    () => attachedImages.map((image) => image.dataUrl),
    [attachedImages]
  );

  const multiRunner = useChatPanelMultiRunner({
    enabled: multiRunnerLauncher && !isHumanMode,
    advancedConfig,
    allAgents: allAgentDefinitions,
    cliAgents: enabledCliAgentList,
    cliAgentType,
    composerInputRef,
    dispatchCategory,
    editorContent,
    effectiveSource,
    imageDataUrls: composerImageDataUrls,
    clearImages,
    selectedAgentDefinitionId: selectedAgentDefId,
    sessionName: "",
    workItemContext:
      attachedWorkItemContext ?? workItemContext ?? chatPanelLaunchContext,
    resolveWorkItemContext,
    onWorktreeLocationChange: handleWorktreeLocationChange,
    onExit: onExitMultiRunner ?? (() => undefined),
    t,
  });

  const { composerCanLaunch, handleComposerLaunch } = useChatPanelComposerGate({
    editorContent,
    isHumanMode,
    isCliTuiMode,
    hasAttachedImages: attachedImages.length > 0,
    canLaunch,
    multiRunner,
    handleLaunch,
  });

  const { cliLaunchModeSwitch, cliVersionAlert } = useChatPanelCliChrome({
    cli,
    cliAgentType,
    isCliMode,
    isMultiRunnerActive: multiRunner.isActive,
  });

  return {
    cliLaunchModeSwitch,
    cliVersionAlert,
    composerCanLaunch,
    handleComposerLaunch,
    multiRunner,
  };
}
