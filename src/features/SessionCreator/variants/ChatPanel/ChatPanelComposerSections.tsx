/**
 * SessionCreatorChatPanel — composer sections.
 *
 * Wingman's share-screen button above the composer, and the composer group:
 * the compact agent header, the TUI title row, the movable repository chrome
 * (above or below the frame), and the composer body — the TUI start button or
 * the `EditorArea`.
 */
import { useAtomValue } from "jotai";
import React from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import SelectorPill from "@src/components/SelectorPill";
import { CHAT_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";
import type { usePinnedActionsVisibilityContextMenu } from "@src/engines/ChatPanel/InputArea/components/PinnedActionsBar/usePinnedActionsVisibilityContextMenu";
import { HugeiconsIcon, ScreenRotationIcon } from "@src/icons";
import { composerGlowVisibleAtom } from "@src/store/session/composerGlowVisibleAtom";

import { EditorArea, SessionInfoLine } from "../../components";
import RepoChromeRow from "./RepoChromeRow";
import type { SessionCreatorChatPanelViewProps } from "./chatPanelViewTypes";
import { isRepoChromeAboveComposer } from "./repoChromeLayout";

interface ChatPanelShareScreenButtonProps {
  onClick: () => void;
}

/** Wingman's dashed "Share screen" button above the composer. */
export const ChatPanelShareScreenButton: React.FC<
  ChatPanelShareScreenButtonProps
> = ({ onClick }) => {
  const { t } = useTranslation(["sessions", "common"]);
  return (
    <Button
      size="mini"
      shape="round"
      className="gap-1.5 border-dashed bg-transparent text-[12px] text-text-2 hover:border-primary-4 hover:text-primary-6"
      onClick={onClick}
      icon={
        <HugeiconsIcon
          icon={ScreenRotationIcon}
          data-icon="airplay"
          size={13}
          strokeWidth={1.75}
        />
      }
    >
      {t("chat.shareScreen")}
    </Button>
  );
};

type ChatPanelComposerGroupProps = Pick<
  SessionCreatorChatPanelViewProps,
  | "agentHeroRef"
  | "canLaunch"
  | "cliLaunchModeSwitch"
  | "compactHeaderIcon"
  | "composerHeaderContent"
  | "editorAreaProps"
  | "headerLayout"
  | "heroContent"
  | "isCategorySelectorOpen"
  | "isCliTuiMode"
  | "isLaunchpadLayout"
  | "isLoading"
  | "onCategoryPickerOpen"
  | "onLaunch"
  | "onPinnedActionsVisibleChange"
  | "onRepoChromePositionChange"
  | "pinnedActionsVisible"
  | "repoChromePosition"
  | "sessionInfoProps"
> & {
  hasRepoChromeMenu: boolean;
  onPinnedActionsContextMenu: ReturnType<
    typeof usePinnedActionsVisibilityContextMenu
  >;
  spotlight: boolean;
};

/** Composer frame with its header rows, repository chrome and body. */
export const ChatPanelComposerGroup: React.FC<ChatPanelComposerGroupProps> = ({
  agentHeroRef,
  canLaunch,
  cliLaunchModeSwitch,
  compactHeaderIcon,
  composerHeaderContent,
  editorAreaProps,
  hasRepoChromeMenu,
  headerLayout,
  heroContent,
  isCategorySelectorOpen,
  isCliTuiMode,
  isLaunchpadLayout,
  isLoading,
  onCategoryPickerOpen,
  onLaunch,
  onPinnedActionsContextMenu: handlePinnedActionsContextMenu,
  onPinnedActionsVisibleChange,
  onRepoChromePositionChange,
  pinnedActionsVisible,
  repoChromePosition,
  sessionInfoProps,
  spotlight,
}) => {
  const { t } = useTranslation(["sessions", "common"]);
  const composerGlowVisible = useAtomValue(composerGlowVisibleAtom);
  const sessionInfoLine = (
    <SessionInfoLine
      {...sessionInfoProps}
      strongSurface={!spotlight}
      leadingContent={cliLaunchModeSwitch}
      dropdownDirection={
        isLaunchpadLayout ? "up" : sessionInfoProps.dropdownDirection
      }
    />
  );
  const repoPills = (
    <div className="flex w-full justify-center">
      <div
        className={`flex w-full flex-wrap items-center justify-start gap-0.5 ${CHAT_PANEL_WIDTH_TOKENS.contentMaxWidth}`}
      >
        {sessionInfoLine}
      </div>
    </div>
  );
  const repoChromeAboveComposer = isRepoChromeAboveComposer(repoChromePosition);
  const repoPillsRow = hasRepoChromeMenu ? (
    <RepoChromeRow
      pinnedActionsVisible={pinnedActionsVisible}
      position={repoChromePosition}
      onPinnedActionsVisibleChange={onPinnedActionsVisibleChange}
      onPositionChange={onRepoChromePositionChange}
    >
      {repoPills}
    </RepoChromeRow>
  ) : null;
  const compactHeader = headerLayout === "compact" && (
    <div className="session-creator-chat-panel-compact-header flex w-full items-center justify-between gap-2 bg-bg-2 px-1 pt-1 pb-2">
      <SelectorPill
        ref={agentHeroRef}
        icon={compactHeaderIcon}
        label={heroContent.name}
        active={isCategorySelectorOpen}
        danger={heroContent.danger}
        size={spotlight ? "sm" : "md"}
        appearance={spotlight ? "default" : "bare"}
        tooltip={t("creator.switchAgent")}
        tooltipPosition="top"
        onClick={onCategoryPickerOpen}
        ariaLabel={heroContent.name}
      />
      <div className="ml-auto flex min-w-0 flex-1 flex-wrap items-center justify-end gap-0.5">
        {sessionInfoLine}
      </div>
    </div>
  );
  const tuiComposerHeader = composerHeaderContent ? (
    <div className="session-creator-chat-panel-fullscreen-header-row px-1 pt-2 pb-3">
      {composerHeaderContent}
    </div>
  ) : null;
  const editorHeaderContent =
    composerHeaderContent ?? editorAreaProps.headerContent;
  const composerGroupClassName = `session-creator-chat-panel-fullscreen-composer-group mx-auto w-full ${CHAT_PANEL_WIDTH_TOKENS.contentMaxWidth} ${
    isLaunchpadLayout && !isCliTuiMode ? "composer-bottom-glow" : ""
  } ${composerGlowVisible ? "" : "composer-glow-hidden"}`;
  const composerFrameClassName = `session-creator-chat-panel-fullscreen-composer w-full ${
    headerLayout === "compact"
      ? "session-creator-chat-panel-fullscreen-composer-compact"
      : ""
  }`;
  const composerBody = isCliTuiMode ? (
    <div className="rounded-xl bg-chat-container p-3">
      <Button
        variant="primary"
        shape="round"
        onClick={onLaunch}
        disabled={!canLaunch || isLoading}
        className="w-full text-[13px] font-semibold disabled:cursor-not-allowed disabled:opacity-40"
      >
        {t("creator.start")}
      </Button>
    </div>
  ) : (
    <EditorArea
      {...editorAreaProps}
      headerContent={editorHeaderContent}
      dropdownDirection={
        isLaunchpadLayout ? "up" : editorAreaProps.dropdownDirection
      }
    />
  );

  return (
    <div
      className={composerGroupClassName}
      onContextMenu={handlePinnedActionsContextMenu}
    >
      <div className={composerFrameClassName}>
        {compactHeader}
        {isCliTuiMode && tuiComposerHeader}
        {/* Keep this slot mounted so moving only the chrome cannot
            shift or remount the composer input below it. */}
        <div className="contents">
          {repoChromeAboveComposer && repoPillsRow}
        </div>
        {composerBody}
      </div>
      {/* The bottom slot sits outside the complete composer frame;
          its existing overlap, radii, and z-order stay in CSS. */}
      <div className="contents">{!repoChromeAboveComposer && repoPillsRow}</div>
    </div>
  );
};
