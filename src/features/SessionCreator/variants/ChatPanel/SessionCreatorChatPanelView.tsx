import React from "react";

import { CREATOR_BOTTOM_DOCK_PADDING_CLASS } from "@src/components/layout/blocks";
import { COMPOSER_HORIZONTAL_GUTTER_CLASS } from "@src/config/composerStackTokens";
import { CHAT_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";
import { CREATOR_COMPOSER_POSITION } from "@src/config/sessionCreatorConfig";
import { usePinnedActionsVisibilityContextMenu } from "@src/engines/ChatPanel/InputArea/components/PinnedActionsBar/usePinnedActionsVisibilityContextMenu";

import {
  ChatPanelComposerGroup,
  ChatPanelShareScreenButton,
} from "./ChatPanelComposerSections";
import { ChatPanelCreatorPickers } from "./ChatPanelCreatorPickers";
import {
  ChatPanelAgentHero,
  ChatPanelLaunchpadActions,
  ChatPanelLaunchpadMiddle,
} from "./ChatPanelLaunchpadSections";
import {
  ChatPanelCliVersionWarning,
  ChatPanelSessionSetupActions,
  ChatPanelSetupFooter,
} from "./ChatPanelSetupSections";
import type { SessionCreatorChatPanelViewProps } from "./chatPanelViewTypes";
import { shouldShowCreatorPinnedActions } from "./repoChromeLayout";

const SessionCreatorChatPanelView: React.FC<
  SessionCreatorChatPanelViewProps
> = ({
  agentHeroRef,
  browserElementScrollNav,
  canLaunch,
  centerFullScreenContent,
  className,
  cliLaunchModeSwitch,
  cliVersionAlert,
  compactHeaderIcon,
  composerHeaderContent,
  composerPosition,
  composerInputRef,
  editorAreaProps,
  fileInputRef,
  footerSlot,
  headerLayout,
  spotlight = false,
  heroFooterSlot,
  heroContent,
  heroIcon,
  hidePresenceButton,
  hideRepoLine,
  hideWorkItemAttachmentControl,
  innerClassName,
  isCategorySelectorOpen,
  isCliTuiMode,
  isFullScreenVariant,
  isLaunchpadLayout,
  launchpadIntent,
  isLoading,
  hideSessionSetupControls,
  isOrgMembersPanelOpen,
  isWingmanMode,
  leadingActionSlot,
  multiRunnerContent,
  onAttachedWorkItemContextChange,
  onCategoryPickerOpen,
  onFileUpload,
  onLaunch,
  onPinnedActionsVisibleChange,
  onRepoChromePositionChange,
  onShareScreen,
  onToggleOrgMembers,
  orgMembersPanelProps,
  pinnedActionsContent,
  pinnedActionsVisible,
  repoChromePosition,
  categoryPickerProps,
  screenPickerProps,
  sessionInfoProps,
  showMissingGitAlert,
  workItemContext,
}) => {
  const handlePinnedActionsContextMenu = usePinnedActionsVisibilityContextMenu({
    visible: pinnedActionsVisible,
    onVisibleChange: onPinnedActionsVisibleChange,
  });
  const isCenteredComposer =
    isLaunchpadLayout && composerPosition === CREATOR_COMPOSER_POSITION.MIDDLE;
  const hasRepoChromeMenu = !hideRepoLine && headerLayout !== "compact";
  const showPinnedActionPills = shouldShowCreatorPinnedActions(
    headerLayout,
    hasRepoChromeMenu,
    pinnedActionsVisible
  );
  const cliVersionWarning =
    !hideSessionSetupControls && cliVersionAlert ? (
      <ChatPanelCliVersionWarning cliVersionAlert={cliVersionAlert} />
    ) : null;
  const agentHero = headerLayout !== "compact" && (
    <ChatPanelAgentHero
      agentHeroRef={agentHeroRef}
      heroContent={heroContent}
      heroIcon={heroIcon}
      isCategorySelectorOpen={isCategorySelectorOpen}
      isLaunchpadLayout={isLaunchpadLayout}
      launchpadIntent={launchpadIntent}
      onCategoryPickerOpen={onCategoryPickerOpen}
    />
  );
  const launchpadActionPresentation = isCenteredComposer ? "pill" : "card";
  const groupAgentHeroWithLaunchpadActions =
    launchpadActionPresentation === "card" && !hideWorkItemAttachmentControl;
  const launchpadSuggestionContent = hideWorkItemAttachmentControl ? (
    heroFooterSlot
  ) : (
    <ChatPanelLaunchpadActions
      composerInputRef={composerInputRef}
      header={groupAgentHeroWithLaunchpadActions ? agentHero : undefined}
      heroFooterSlot={heroFooterSlot}
      onAttachedWorkItemContextChange={onAttachedWorkItemContextChange}
      presentation={launchpadActionPresentation}
      repoId={sessionInfoProps.repoId}
      repoPath={sessionInfoProps.repoPath}
      workItemContext={workItemContext}
    />
  );
  const launchpadMiddleContent = isLaunchpadLayout ? (
    <ChatPanelLaunchpadMiddle
      agentHero={agentHero}
      groupAgentHeroWithLaunchpadActions={groupAgentHeroWithLaunchpadActions}
      isCenteredComposer={isCenteredComposer}
      launchpadSuggestionContent={launchpadSuggestionContent}
      multiRunnerContent={multiRunnerContent}
    />
  ) : null;
  const composerDockClassName = isLaunchpadLayout
    ? "relative z-10 mt-auto flex w-full shrink-0 flex-col gap-3"
    : "contents";

  return (
    <div
      className={`session-creator-chat-panel-wrapper ${spotlight ? "spotlight-session-creator" : ""} ${
        isLaunchpadLayout ? "h-full" : ""
      } ${
        isCenteredComposer ? "session-creator-chat-panel-centered-composer" : ""
      } ${className}`}
      data-testid="session-creator-chat-panel"
      data-creator-composer-position={
        isLaunchpadLayout ? composerPosition : undefined
      }
    >
      <div
        className={`session-creator-chat-panel-content flex min-h-0 flex-1 ${COMPOSER_HORIZONTAL_GUTTER_CLASS} ${CHAT_PANEL_WIDTH_TOKENS.headerWidth} ${
          isLaunchpadLayout
            ? `session-creator-chat-panel-launchpad-content flex-col ${CREATOR_BOTTOM_DOCK_PADDING_CLASS}`
            : `items-center justify-center ${
                innerClassName ??
                (isFullScreenVariant
                  ? centerFullScreenContent
                    ? "pb-[10vh]"
                    : "pb-[18vh]"
                  : "pb-[4vh]")
              }`
        }`}
      >
        <div
          className={`flex w-full flex-col items-stretch gap-3 ${
            isLaunchpadLayout
              ? "session-creator-chat-panel-launchpad-stack relative min-h-0 flex-1"
              : ""
          }`}
        >
          {launchpadMiddleContent}
          {!isLaunchpadLayout && agentHero}
          <div className={composerDockClassName}>
            {!isCliTuiMode && isWingmanMode && (
              <ChatPanelShareScreenButton
                onClick={() => {
                  void onShareScreen();
                }}
              />
            )}
            {/* Skills/actions stay above the input in every creator layout. */}
            <ChatPanelSessionSetupActions
              browserElementScrollNav={browserElementScrollNav}
              composerInputRef={composerInputRef}
              hideSessionSetupControls={hideSessionSetupControls}
              isOrgMembersPanelOpen={isOrgMembersPanelOpen}
              leadingActionSlot={leadingActionSlot}
              onPinnedActionsContextMenu={handlePinnedActionsContextMenu}
              onToggleOrgMembers={onToggleOrgMembers}
              orgMembersPanelProps={orgMembersPanelProps}
              pinnedActionsContent={pinnedActionsContent}
              showPinnedActionPills={showPinnedActionPills}
              spotlight={spotlight}
            />
            {isLaunchpadLayout && cliVersionWarning}
            <ChatPanelComposerGroup
              agentHeroRef={agentHeroRef}
              canLaunch={canLaunch}
              cliLaunchModeSwitch={cliLaunchModeSwitch}
              compactHeaderIcon={compactHeaderIcon}
              composerHeaderContent={composerHeaderContent}
              editorAreaProps={editorAreaProps}
              hasRepoChromeMenu={hasRepoChromeMenu}
              headerLayout={headerLayout}
              heroContent={heroContent}
              isCategorySelectorOpen={isCategorySelectorOpen}
              isCliTuiMode={isCliTuiMode}
              isLaunchpadLayout={isLaunchpadLayout}
              isLoading={isLoading}
              onCategoryPickerOpen={onCategoryPickerOpen}
              onLaunch={onLaunch}
              onPinnedActionsContextMenu={handlePinnedActionsContextMenu}
              onPinnedActionsVisibleChange={onPinnedActionsVisibleChange}
              onRepoChromePositionChange={onRepoChromePositionChange}
              pinnedActionsVisible={pinnedActionsVisible}
              repoChromePosition={repoChromePosition}
              sessionInfoProps={sessionInfoProps}
              spotlight={spotlight}
            />
          </div>

          <ChatPanelSetupFooter
            cliVersionWarning={cliVersionWarning}
            footerSlot={footerSlot}
            hidePresenceButton={hidePresenceButton}
            hideSessionSetupControls={hideSessionSetupControls}
            isLaunchpadLayout={isLaunchpadLayout}
            isOrgMembersPanelOpen={isOrgMembersPanelOpen}
            orgMembersPanelProps={orgMembersPanelProps}
            showMissingGitAlert={showMissingGitAlert}
          />
        </div>
        {isCenteredComposer &&
          !multiRunnerContent &&
          launchpadSuggestionContent && (
            <div
              className={`mx-auto w-full shrink-0 pt-4 ${CHAT_PANEL_WIDTH_TOKENS.contentMaxWidth}`}
              data-testid="session-creator-bottom-suggestions"
            >
              {launchpadSuggestionContent}
            </div>
          )}
      </div>

      <ChatPanelCreatorPickers
        categoryPickerProps={categoryPickerProps}
        fileInputRef={fileInputRef}
        hideSessionSetupControls={hideSessionSetupControls}
        isCategorySelectorOpen={isCategorySelectorOpen}
        onFileUpload={onFileUpload}
        screenPickerProps={screenPickerProps}
      />
    </div>
  );
};

SessionCreatorChatPanelView.displayName = "SessionCreatorChatPanelView";

export default SessionCreatorChatPanelView;
