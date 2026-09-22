/**
 * SessionCreatorChatPanel — launchpad sections.
 *
 * The agent hero (with the launchpad question), the launchpad action grid
 * (work-item attachment plus the caller's hero-footer actions), and the
 * centered middle block that places them — or the multi-runner list — above
 * the docked composer.
 */
import React, { Children } from "react";
import { useTranslation } from "react-i18next";

import { CREATOR_MIDDLE_POSITION_STYLE } from "@src/components/layout/blocks";
import { CHAT_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";
import {
  LaunchpadActionGrid,
  type LaunchpadActionPresentation,
} from "@src/features/SessionCreator/components/LaunchpadActionGrid";

import SessionCreatorAgentHero from "./SessionCreatorAgentHero";
import WorkItemAttachmentControl from "./WorkItemAttachmentControl";
import type { SessionCreatorChatPanelViewProps } from "./chatPanelViewTypes";

type SessionInfoProps = SessionCreatorChatPanelViewProps["sessionInfoProps"];

type ChatPanelAgentHeroProps = Pick<
  SessionCreatorChatPanelViewProps,
  | "agentHeroRef"
  | "heroContent"
  | "heroIcon"
  | "isCategorySelectorOpen"
  | "isLaunchpadLayout"
  | "launchpadIntent"
  | "onCategoryPickerOpen"
>;

/** Agent identity hero; the launchpad layout adds its question around it. */
export const ChatPanelAgentHero: React.FC<ChatPanelAgentHeroProps> = ({
  agentHeroRef,
  heroContent,
  heroIcon,
  isCategorySelectorOpen,
  isLaunchpadLayout,
  launchpadIntent,
  onCategoryPickerOpen,
}) => {
  const { t } = useTranslation(["sessions", "common"]);
  const launchpadQuestionKey =
    launchpadIntent === "plan"
      ? "creator.planLaunchpadQuestion"
      : "creator.launchpadQuestion";
  const launchpadQuestionSuffixKey =
    launchpadIntent === "plan"
      ? "creator.planLaunchpadQuestionSuffix"
      : "creator.launchpadQuestionSuffix";
  return (
    <SessionCreatorAgentHero
      ref={agentHeroRef}
      name={heroContent.name}
      description={heroContent.description}
      avatarIcon={heroIcon}
      question={isLaunchpadLayout ? t(launchpadQuestionKey) : undefined}
      questionSuffix={
        isLaunchpadLayout
          ? t(launchpadQuestionSuffixKey, { defaultValue: "" })
          : undefined
      }
      active={isCategorySelectorOpen}
      danger={heroContent.danger}
      onClick={onCategoryPickerOpen}
    />
  );
};

type ChatPanelLaunchpadActionsProps = Pick<
  SessionCreatorChatPanelViewProps,
  | "composerInputRef"
  | "heroFooterSlot"
  | "onAttachedWorkItemContextChange"
  | "workItemContext"
> & {
  header: React.ReactNode;
  presentation: LaunchpadActionPresentation;
  repoId: SessionInfoProps["repoId"];
  repoPath: SessionInfoProps["repoPath"];
};

/** Launchpad action grid: work-item attachment plus the hero-footer actions. */
export const ChatPanelLaunchpadActions: React.FC<
  ChatPanelLaunchpadActionsProps
> = ({
  composerInputRef,
  header,
  heroFooterSlot,
  onAttachedWorkItemContextChange,
  presentation,
  repoId,
  repoPath,
  workItemContext,
}) => {
  const { t } = useTranslation(["sessions", "common"]);
  return (
    <LaunchpadActionGrid
      className="mx-auto w-full"
      layoutActionCount={Children.count(heroFooterSlot) + 1}
      presentation={presentation}
      collapsible
      controlAlignment="center"
      collapseLabel={t("common:actions.collapse")}
      expandLabel={t("common:actions.expand")}
      header={header}
    >
      <WorkItemAttachmentControl
        composerInputRef={composerInputRef}
        currentWorkItemContext={workItemContext}
        onWorkItemContextChange={onAttachedWorkItemContextChange}
        repoId={repoId}
        repoPath={repoPath}
        mode="solve"
        presentation={presentation}
      />
      {heroFooterSlot}
    </LaunchpadActionGrid>
  );
};

type ChatPanelLaunchpadMiddleProps = Pick<
  SessionCreatorChatPanelViewProps,
  "multiRunnerContent"
> & {
  agentHero: React.ReactNode;
  groupAgentHeroWithLaunchpadActions: boolean;
  isCenteredComposer: boolean;
  launchpadSuggestionContent: React.ReactNode;
};

/** Centered launchpad block: the hero and suggestions, or the runner list. */
export const ChatPanelLaunchpadMiddle: React.FC<
  ChatPanelLaunchpadMiddleProps
> = ({
  agentHero,
  groupAgentHeroWithLaunchpadActions,
  isCenteredComposer,
  launchpadSuggestionContent,
  multiRunnerContent,
}) => (
  <div
    // `top` resolves to a percentage of the pane height and `-translate-y-1/2`
    // subtracts half of a text-driven box height, so this block almost always
    // lands on a fractional device pixel (measured 325.43px / 108.5px tall on
    // a 904px viewport). Everything inside — the hero pill and every action
    // card icon — then rasterizes off the pixel grid, and any repaint that
    // re-layers the subtree re-rounds it, which reads as the icons shaking.
    // `transform-gpu` pins the block to its own compositor layer so the
    // fractional offset is snapped once instead of on every hover.
    className="session-creator-chat-panel-launchpad-middle absolute inset-x-0 flex -translate-y-1/2 transform-gpu flex-col items-center gap-2"
    style={CREATOR_MIDDLE_POSITION_STYLE}
  >
    {/* Multi-runner owns the whole middle slot: with N runners listed below
        it, a single-harness hero pill would name one of them and imply the
        others do not exist. */}
    {multiRunnerContent ? (
      <div
        className={`session-creator-chat-panel-launchpad-runners mx-auto w-full ${CHAT_PANEL_WIDTH_TOKENS.contentMaxWidth}`}
      >
        {multiRunnerContent}
      </div>
    ) : (
      <>
        {!groupAgentHeroWithLaunchpadActions && agentHero}
        {!isCenteredComposer && launchpadSuggestionContent && (
          <div className="session-creator-chat-panel-launchpad-suggestions w-full">
            {launchpadSuggestionContent}
          </div>
        )}
      </>
    )}
  </div>
);
