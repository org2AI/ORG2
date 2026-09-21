import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React, { useLayoutEffect } from "react";
import { useTranslation } from "react-i18next";

import { useBrowserAddToConversationAction } from "@src/engines/ChatPanel/hooks/useBrowserAddToConversationAction";
import { useAgentOrgs } from "@src/modules/MainApp/AgentOrgs/hooks/useAgentOrgs";
import {
  SESSION_TARGET_KIND,
  creatorRepoChromePositionAtom,
  normalizeAgentOnlySessionCreatorState,
  pinnedActionsVisibleAtom,
  sessionCreatorStateAtom,
} from "@src/store/session";
import { creatorComposerPositionAtom } from "@src/store/session/creatorComposerPositionAtom";

import SessionCreatorChatPanelView from "./SessionCreatorChatPanelView";
import {
  buildChatPanelComposerViewProps,
  buildChatPanelRepoChromeViewProps,
} from "./chatPanelComposerViewProps";
import {
  buildChatPanelAgentViewProps,
  buildChatPanelLaunchpadViewProps,
  buildChatPanelLayoutViewProps,
  buildChatPanelSetupViewProps,
} from "./chatPanelSectionViewProps";
import "./index.scss";
import type { SessionCreatorChatPanelSingleProps } from "./types";
import { useChatPanelAgentMode } from "./useChatPanelAgentMode";
import { useChatPanelLaunchControls } from "./useChatPanelLaunchControls";
import { useChatPanelLaunchFlow } from "./useChatPanelLaunchFlow";
import { useChatPanelPresentation } from "./useChatPanelPresentation";
import { useChatPanelSelectionHandlers } from "./useChatPanelSelectionHandlers";
import { useChatPanelSessionCreator } from "./useChatPanelSessionCreator";

export type { SessionCreatorChatPanelProps } from "./types";

// ── Component ─────────────────────────────────────────────────────────────────

const SessionCreatorChatPanelContent: React.FC<
  SessionCreatorChatPanelSingleProps
> = ({
  centerFullScreenContent = false,
  className = "",
  composerHeaderContent,
  heroFooterSlot,
  pinnedActionsContent,
  innerClassName,
  footerSlot,
  leadingActionSlot,
  headerLayout = "hero",
  spotlight = false,
  hideRepoLine = false,
  hideWorkItemAttachmentControl = false,
  includeHumanSession = true,
  initialContent,
  dropdownDirection = "down",
  multiRunnerLauncher = false,
  onExitMultiRunner,
  onOpenCliTerminal,
  onRegionNoticeChange,
  onSessionStart,
  hidePresenceButton = false,
  launchMode,
  layout = "default",
  launchpadIntent = "build",
  variant = "default",
  workItemContext,
  resolveWorkItemContext,
}) => {
  const { t } = useTranslation("sessions");
  const composerPosition = useAtomValue(creatorComposerPositionAtom);
  const browserAddToConversationNav = useBrowserAddToConversationAction();
  const { orgs } = useAgentOrgs();
  const [repoChromePosition, setRepoChromePositionPreference] = useAtom(
    creatorRepoChromePositionAtom
  );
  const [pinnedActionsVisible, setPinnedActionsVisible] = useAtom(
    pinnedActionsVisibleAtom
  );

  // Keep this order: the groups contain effects, which run in call order.
  const mode = useChatPanelAgentMode();
  const session = useChatPanelSessionCreator({
    initialContent,
    launchMode,
    mode,
    multiRunnerLauncher,
    onSessionStart,
    resolveWorkItemContext,
    t,
    workItemContext,
  });
  const selection = useChatPanelSelectionHandlers({ mode, session });
  const launchFlow = useChatPanelLaunchFlow({
    initialContent,
    mode,
    onOpenCliTerminal,
    session,
    t,
  });
  const presentation = useChatPanelPresentation({
    browserAddToConversationNav,
    mode,
    onRegionNoticeChange,
    orgs,
    session,
    t,
    variant,
  });
  const launchControls = useChatPanelLaunchControls({
    launchFlow,
    mode,
    multiRunnerLauncher,
    onExitMultiRunner,
    presentation,
    resolveWorkItemContext,
    session,
    t,
    workItemContext,
  });

  return (
    <SessionCreatorChatPanelView
      {...buildChatPanelLayoutViewProps({
        centerFullScreenContent,
        className,
        composerPosition,
        headerLayout,
        innerClassName,
        layout,
        mode,
        presentation,
        spotlight,
      })}
      {...buildChatPanelAgentViewProps({
        includeHumanSession,
        mode,
        presentation,
        selection,
      })}
      {...buildChatPanelLaunchpadViewProps({
        heroFooterSlot,
        hideWorkItemAttachmentControl,
        launchControls,
        launchpadIntent,
        session,
      })}
      {...buildChatPanelComposerViewProps({
        composerHeaderContent,
        dropdownDirection,
        headerLayout,
        hideRepoLine,
        initialContent,
        launchControls,
        launchFlow,
        layout,
        mode,
        presentation,
        repoChromePosition,
        selection,
        session,
        t,
      })}
      {...buildChatPanelRepoChromeViewProps({
        hideRepoLine,
        launchControls,
        mode,
        pinnedActionsVisible,
        presentation,
        repoChromePosition,
        selection,
        session,
        setPinnedActionsVisible,
        setRepoChromePositionPreference,
      })}
      {...buildChatPanelSetupViewProps({
        footerSlot,
        hidePresenceButton,
        launchControls,
        leadingActionSlot,
        mode,
        pinnedActionsContent,
        presentation,
        selection,
        session,
      })}
    />
  );
};

const SessionCreatorChatPanelSingle: React.FC<
  SessionCreatorChatPanelSingleProps
> = (props) => {
  const creatorState = useAtomValue(sessionCreatorStateAtom);
  const setCreatorState = useSetAtom(sessionCreatorStateAtom);
  const shouldResetHumanSelection =
    props.includeHumanSession === false &&
    (creatorState.dispatchCategory === "human_session" ||
      creatorState.targetKind === SESSION_TARGET_KIND.HUMAN);

  useLayoutEffect(() => {
    if (!shouldResetHumanSelection) return;
    setCreatorState((previous) =>
      normalizeAgentOnlySessionCreatorState(previous)
    );
  }, [setCreatorState, shouldResetHumanSelection]);

  if (shouldResetHumanSelection) return null;

  return <SessionCreatorChatPanelContent {...props} />;
};

SessionCreatorChatPanelSingle.displayName = "SessionCreatorChatPanelSingle";

export default SessionCreatorChatPanelSingle;
