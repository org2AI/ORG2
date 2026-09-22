/**
 * SessionCreatorChatPanel — session setup sections.
 *
 * The setup chrome that `hideSessionSetupControls` removes for Work log: the
 * pinned Skills & Tools row above the composer, the outdated-CLI warning,
 * and the notices, org-members panel, presence button and footer slot below
 * the composer.
 */
import React, { useMemo } from "react";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { pillControlStateClass } from "@src/components/CompoundPill/config";
import PageNotice from "@src/components/PageNotice";
import { CHAT_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";
import CollapsedInlineRow from "@src/engines/ChatPanel/InputArea/components/CollapsedInlineRow";
import LazyPinnedActionsBar from "@src/engines/ChatPanel/InputArea/components/PinnedActionsBar/LazyPinnedActionsBar";
import type { usePinnedActionsVisibilityContextMenu } from "@src/engines/ChatPanel/InputArea/components/PinnedActionsBar/usePinnedActionsVisibilityContextMenu";
import { HierarchyCircle01Icon, HugeiconsIcon } from "@src/icons";
import { PresenceMenuButton } from "@src/scaffold/NavigationSidebar/blocks/SidebarBottomBar";

import SessionCreatorOrgMembersPanel from "./SessionCreatorOrgMembersPanel";
import type { SessionCreatorChatPanelViewProps } from "./chatPanelViewTypes";

export { ChatPanelCliVersionWarning } from "./ChatPanelCliVersionWarning";

type ChatPanelSessionSetupActionsProps = Pick<
  SessionCreatorChatPanelViewProps,
  | "browserElementScrollNav"
  | "composerInputRef"
  | "hideSessionSetupControls"
  | "isOrgMembersPanelOpen"
  | "leadingActionSlot"
  | "onToggleOrgMembers"
  | "orgMembersPanelProps"
  | "pinnedActionsContent"
> & {
  onPinnedActionsContextMenu: ReturnType<
    typeof usePinnedActionsVisibilityContextMenu
  >;
  showPinnedActionPills: boolean;
  spotlight: boolean;
};

/** Pinned Skills & Tools row above the composer, with the org-members toggle. */
export const ChatPanelSessionSetupActions: React.FC<
  ChatPanelSessionSetupActionsProps
> = ({
  browserElementScrollNav,
  composerInputRef,
  hideSessionSetupControls,
  isOrgMembersPanelOpen,
  leadingActionSlot,
  onPinnedActionsContextMenu: handlePinnedActionsContextMenu,
  onToggleOrgMembers,
  orgMembersPanelProps,
  pinnedActionsContent,
  showPinnedActionPills,
  spotlight,
}) => {
  const { t } = useTranslation(["sessions", "common"]);
  const browserElementRowContent = useMemo(
    () =>
      browserElementScrollNav.showAddToConversation ? (
        <CollapsedInlineRow sections={[]} scrollNav={browserElementScrollNav} />
      ) : null,
    [browserElementScrollNav]
  );
  const showSessionSetupActions =
    !hideSessionSetupControls &&
    (!spotlight ||
      showPinnedActionPills ||
      browserElementRowContent ||
      leadingActionSlot ||
      orgMembersPanelProps ||
      pinnedActionsContent);
  return showSessionSetupActions ? (
    <div
      className={`mx-auto flex w-full items-center ${CHAT_PANEL_WIDTH_TOKENS.contentMaxWidth}`}
      onContextMenu={handlePinnedActionsContextMenu}
    >
      <LazyPinnedActionsBar
        composerInputRef={composerInputRef}
        manageButtonPlacement="before-actions"
        managePanelAlign="left"
        showBeforeActionsSeparator={false}
        showPinnedActions={showPinnedActionPills}
        trailingContent={pinnedActionsContent}
        leadingContent={
          <>
            {browserElementRowContent}
            {leadingActionSlot}
            {orgMembersPanelProps && (
              <Button
                size="small"
                shape="round"
                icon={
                  <HugeiconsIcon
                    icon={HierarchyCircle01Icon}
                    data-icon="network"
                    size={14}
                    strokeWidth={1.75}
                  />
                }
                title={t("creator.orgMembers.configButton")}
                aria-label={t("creator.orgMembers.configButton")}
                aria-expanded={isOrgMembersPanelOpen}
                aria-controls="session-creator-org-members-panel"
                onClick={onToggleOrgMembers}
                className={`shrink-0 ${pillControlStateClass(isOrgMembersPanelOpen)}`}
                data-testid="session-creator-org-members-toggle"
              >
                {t("creator.orgMembers.configButton")}
              </Button>
            )}
          </>
        }
      />
    </div>
  ) : null;
};

type ChatPanelSetupFooterProps = Pick<
  SessionCreatorChatPanelViewProps,
  | "footerSlot"
  | "hidePresenceButton"
  | "hideSessionSetupControls"
  | "isLaunchpadLayout"
  | "isOrgMembersPanelOpen"
  | "orgMembersPanelProps"
  | "showMissingGitAlert"
> & {
  /** The warning element; the default layout renders it below the composer. */
  cliVersionWarning: React.ReactNode;
};

/** Notices, org-members panel, presence button and footer below the composer. */
export const ChatPanelSetupFooter: React.FC<ChatPanelSetupFooterProps> = ({
  cliVersionWarning,
  footerSlot,
  hidePresenceButton,
  hideSessionSetupControls,
  isLaunchpadLayout,
  isOrgMembersPanelOpen,
  orgMembersPanelProps,
  showMissingGitAlert,
}) => {
  const { t } = useTranslation(["sessions", "common"]);
  return (
    <>
      {!hideSessionSetupControls && showMissingGitAlert && (
        <div
          className={`mx-auto w-full ${CHAT_PANEL_WIDTH_TOKENS.contentMaxWidth}`}
        >
          <PageNotice type="warning" title={t("creator.missingGit.title")}>
            {t("creator.missingGit.body")}
          </PageNotice>
        </div>
      )}

      {!isLaunchpadLayout && cliVersionWarning}

      {!hideSessionSetupControls &&
        orgMembersPanelProps &&
        isOrgMembersPanelOpen && (
          <div id="session-creator-org-members-panel">
            <SessionCreatorOrgMembersPanel {...orgMembersPanelProps} />
          </div>
        )}

      {!hideSessionSetupControls && !hidePresenceButton && (
        <div className="flex w-full items-center justify-center gap-2 pt-1">
          <PresenceMenuButton
            variant="detailed"
            dropdownPosition={isLaunchpadLayout ? "top-start" : "bottom-start"}
          />
        </div>
      )}
      {!hideSessionSetupControls && footerSlot}
    </>
  );
};
