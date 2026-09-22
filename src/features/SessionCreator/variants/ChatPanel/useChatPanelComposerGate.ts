/**
 * SessionCreatorChatPanel — composer launch gate.
 *
 * Decides whether the composer's send is enabled and routes the send to
 * either the single-agent launch or the Compare-runners group launch.
 */
import { useCallback } from "react";

import {
  composerActionFor,
  parseNativeSlashCommand,
} from "@src/engines/ChatPanel/hooks/useInputArea/nativeSlashCommands";
import { createLogger } from "@src/hooks/logger";

import type { useChatPanelMultiRunner } from "./useChatPanelMultiRunner";

const log = createLogger("ChatPanel");

interface UseChatPanelComposerGateOptions {
  editorContent: string;
  isHumanMode: boolean;
  isCliTuiMode: boolean;
  hasAttachedImages: boolean;
  canLaunch: boolean;
  multiRunner: Pick<
    ReturnType<typeof useChatPanelMultiRunner>,
    "isActive" | "canLaunch" | "launchGroup"
  >;
  handleLaunch: () => Promise<unknown>;
}

export function useChatPanelComposerGate({
  editorContent,
  isHumanMode,
  isCliTuiMode,
  hasAttachedImages,
  canLaunch,
  multiRunner,
  handleLaunch,
}: UseChatPanelComposerGateOptions) {
  // In multi mode the launcher's own `canLaunch` is the wrong gate: it checks
  // the GLOBAL model selection, which multi mode hides because each row owns
  // its own. Row readiness is `multiRunner.canLaunch`; what remains here is the
  // prompt.
  const hasPromptContent = editorContent.trim().length > 0;
  const localCommand = parseNativeSlashCommand(editorContent);
  const canRunLocalCommand =
    !isHumanMode &&
    !isCliTuiMode &&
    !multiRunner.isActive &&
    !hasAttachedImages &&
    !!localCommand &&
    (Boolean(composerActionFor(localCommand.name)) ||
      ["model", "effort", "fast", "plan"].includes(localCommand.name));
  const composerCanLaunch =
    canRunLocalCommand ||
    (multiRunner.isActive
      ? hasPromptContent && multiRunner.canLaunch
      : canLaunch);

  const handleComposerLaunch = useCallback(() => {
    if (multiRunner.isActive) {
      multiRunner.launchGroup().catch((error: unknown) => {
        log.warn("multi-runner group launch failed", error);
      });
      return;
    }
    handleLaunch().catch((error: unknown) => {
      log.warn("composer launch failed", error);
    });
  }, [handleLaunch, multiRunner]);

  return { composerCanLaunch, handleComposerLaunch };
}
