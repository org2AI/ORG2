/**
 * SessionCreatorChatPanel — launch flow.
 *
 * Tracks whether the Work-log note has content, restores text pushed back
 * into the composer, and builds the single-session launch handler (Work log,
 * CLI TUI, native slash command, or the regular launch) on that tracking.
 */
import type { TFunction } from "i18next";
import { useState } from "react";

import type { SessionCreatorChatPanelSingleProps } from "./types";
import type { useChatPanelAgentMode } from "./useChatPanelAgentMode";
import { useChatPanelDraftRestore } from "./useChatPanelDraftRestore";
import { useChatPanelLaunch } from "./useChatPanelLaunch";
import type { useChatPanelSessionCreator } from "./useChatPanelSessionCreator";

interface UseChatPanelLaunchFlowOptions extends Pick<
  SessionCreatorChatPanelSingleProps,
  "initialContent" | "onOpenCliTerminal"
> {
  mode: ReturnType<typeof useChatPanelAgentMode>;
  session: ReturnType<typeof useChatPanelSessionCreator>;
  t: TFunction<"sessions">;
}

export function useChatPanelLaunchFlow({
  initialContent,
  mode,
  onOpenCliTerminal,
  session,
  t,
}: UseChatPanelLaunchFlowOptions) {
  const {
    cli: { selectedCliAgent },
    cliAgentType,
    isCliTuiMode,
    isHumanMode,
  } = mode;
  const {
    chatPanelLaunchContext,
    creator: {
      attachedImages,
      composerInputRef,
      effectiveSource,
      handleContentChange,
      handleLaunch: originalHandleLaunch,
    },
    handleSessionStart,
    setAttachedWorkItemContext,
  } = session;
  const [humanNoteHasContent, setHumanNoteHasContent] = useState(
    Boolean(initialContent?.trim())
  );

  const draft = useChatPanelDraftRestore({
    composerInputRef,
    handleContentChange,
    setHumanNoteHasContent,
  });
  const { handleContentChangeWithTracking } = draft;

  const launch = useChatPanelLaunch({
    isHumanMode,
    hasAttachedImages: attachedImages.length > 0,
    isCliTuiMode,
    composerInputRef,
    effectiveSource,
    handleContentChangeWithTracking,
    handleSessionStart,
    onOpenCliTerminal,
    selectedCliAgent,
    cliAgentType,
    chatPanelLaunchContext,
    originalHandleLaunch,
    setAttachedWorkItemContext,
    t,
  });

  return { draft, humanNoteHasContent, launch };
}
