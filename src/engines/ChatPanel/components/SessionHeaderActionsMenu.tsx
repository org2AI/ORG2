import { useAtom, useAtomValue, useSetAtom } from "jotai";
import React from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import { trackSessionAsProject } from "@src/api/tauri/agent/session";
import Button from "@src/components/Button";
import {
  ActionMenuSurface,
  ActionSubmenu,
} from "@src/components/Dropdown/ActionMenuSurface";
import DropdownItem from "@src/components/Dropdown/DropdownItem";
import { MenuSwitchRow } from "@src/components/Dropdown/MenuControlRows";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_PANEL,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import Message from "@src/components/Message";
import { useCopySessionReference } from "@src/features/Org2Cloud/useCopySessionReference";
import type { DropdownEnginePosition } from "@src/hooks/dropdown";
import { useSetting } from "@src/hooks/settings/useSettings";
import {
  AppWindowMacIcon,
  ArrowBigRightDashIcon,
  Copy01Icon,
  CursorInWindowIcon,
  DeliveryBox01Icon,
  FolderOutputIcon,
  HugeiconsIcon,
  Layers01Icon,
  Link01Icon,
  Link02Icon,
  MoreHorizontalIcon,
  Refresh04Icon,
  SearchList01Icon,
  Share02Icon,
  ThirdBracketIcon,
} from "@src/icons";
import { sessionByIdAtom, upsertSession } from "@src/store/session";
import { openSessionInNewWindowAtom } from "@src/store/session/sessionTabPlacementAtom";
import { collapseToolActivityAtom } from "@src/store/ui/chatPanel/displayPrefsAtoms";
import type { ChatHistoryDisplayMode } from "@src/store/ui/chatPanel/displayPrefsAtoms";
import {
  LINK_OPEN_TARGETS,
  type LinkOpenTarget,
  linkOpenTargetAtom,
} from "@src/store/ui/linkOpenTargetAtom";
import { isAgentSession } from "@src/util/session/sessionDispatch";

import { SessionInputSettingsSubmenu } from "./SessionInputSettingsSubmenu";
import { SessionOpenInAppMenuItem } from "./SessionOpenInAppMenuItem";

const HEADER_ICON_SIZE = 14;

const LINK_OPEN_TARGET_LABEL_KEYS = {
  internal: "chat.navigation.internalBrowser",
  external: "chat.navigation.externalBrowser",
} as const satisfies Record<LinkOpenTarget, string>;

export interface SessionHeaderActionsMenuProps {
  activeSessionExists: boolean;
  copyEventJsonLabel: "idle" | "copied" | "failed";
  currentSessionId: string | null;
  /** Existing binding owner selected by the canonical conversation resolver. */
  appOpenSessionId?: string | null;
  displayMode: ChatHistoryDisplayMode;
  eventsLength: number;
  handleCompactDisplayModeToggle: (checked: boolean) => void;
  handleCopyEventJson: () => void;
  handleMoveSession: () => void;
  handleOpenCloudShareSettings: () => void;
  handleOpenExportSessionJson: () => void;
  handleOpenLinkWorkItem: () => void;
  handleOpenSearch: () => void;
  handlePaginationToggle: (checked: boolean) => void;
  handleReloadFromMenu: () => void;
  handleTokenUsageVisibleToggle: (checked: boolean) => void;
  handleTurnMetadataVisibleToggle: (checked: boolean) => void;
  headerActionsDropdownRef: React.RefObject<HTMLDivElement | null>;
  headerActionsPosition: DropdownEnginePosition;
  headerActionsTriggerRef: React.RefObject<HTMLButtonElement | null>;
  isHeaderActionsOpen: boolean;
  isHeaderActionsPositioned: boolean;
  moveTarget: "chat-panel" | "workstation";
  paginationEnabled: boolean;
  showCloudShareSettings: boolean;
  /** Off in the detached session window, whose only surface is the session. */
  showMoveSession?: boolean;
  /** Off in the detached session window — it already is that window. */
  showOpenInNewWindow?: boolean;
  showTranscriptActions?: boolean;
  tokenUsageVisible: boolean;
  turnMetadataVisible: boolean;
  toggleHeaderActionsMenu: () => void;
  triggerTestId: string;
}

/** The canonical session dropdown shared by Chat Panel and My Station. */
export const SessionHeaderActionsMenu: React.FC<
  SessionHeaderActionsMenuProps
> = ({
  activeSessionExists,
  copyEventJsonLabel,
  currentSessionId,
  appOpenSessionId,
  displayMode,
  eventsLength,
  handleCompactDisplayModeToggle,
  handleCopyEventJson,
  handleMoveSession,
  handleOpenCloudShareSettings,
  handleOpenExportSessionJson,
  handleOpenLinkWorkItem,
  handleOpenSearch,
  handlePaginationToggle,
  handleReloadFromMenu,
  handleTokenUsageVisibleToggle,
  handleTurnMetadataVisibleToggle,
  headerActionsDropdownRef,
  headerActionsPosition,
  headerActionsTriggerRef,
  isHeaderActionsOpen,
  isHeaderActionsPositioned,
  moveTarget,
  paginationEnabled,
  showCloudShareSettings,
  showMoveSession = true,
  showOpenInNewWindow = true,
  showTranscriptActions = true,
  tokenUsageVisible,
  turnMetadataVisible,
  toggleHeaderActionsMenu,
  triggerTestId,
}) => {
  const { t } = useTranslation([
    "sessions",
    "common",
    "navigation",
    "settings",
  ]);
  const moveToWorkstation = moveTarget === "workstation";

  const currentSession = useAtomValue(sessionByIdAtom(currentSessionId ?? ""));
  const [collapseToolActivity, setCollapseToolActivity] = useAtom(
    collapseToolActivityAtom
  );
  const [linkOpenTarget, setLinkOpenTarget] = useAtom(linkOpenTargetAtom);
  const [typingEffectEnabled, setTypingEffectEnabled] = useSetting(
    "chat.typingEffectEnabled"
  );

  // Track this / Convert to Project (orgtrack/v1 §7.2). Self-contained:
  // the backend command persists the switch + root WorkItem; only the
  // local store row needs a merge afterwards.
  const canTrackAsProject =
    !!currentSessionId &&
    isAgentSession(currentSessionId) &&
    currentSession?.productMode !== "project";
  const handleTrackAsProject = React.useCallback(async () => {
    if (!currentSessionId) return;
    toggleHeaderActionsMenu();
    try {
      const result = await trackSessionAsProject(currentSessionId);
      if (currentSession) {
        upsertSession({
          ...currentSession,
          productMode: result.productMode,
          agentExecMode: result.agentExecMode,
          workItemId: result.workItemId ?? currentSession.workItemId,
        });
      }
      Message.success(t("sessions:chat.trackAsProject.success"));
    } catch (err) {
      Message.error(err instanceof Error ? err.message : String(err));
    }
  }, [currentSessionId, toggleHeaderActionsMenu, currentSession, t]);

  // Open in new window — detach the session into its own OS window and drop
  // this window's tab(s) for it. Self-contained like Track-as-Project: the
  // atom talks to the backend and both tab owners, so neither host has to
  // wire a handler through.
  const openSessionInNewWindow = useSetAtom(openSessionInNewWindowAtom);
  const handleOpenInNewWindow = React.useCallback(async () => {
    if (!currentSessionId) return;
    toggleHeaderActionsMenu();
    try {
      await openSessionInNewWindow({
        sessionId: currentSessionId,
        title: currentSession?.name,
      });
    } catch (err) {
      Message.error(err instanceof Error ? err.message : String(err));
    }
  }, [
    currentSessionId,
    currentSession,
    openSessionInNewWindow,
    toggleHeaderActionsMenu,
  ]);

  // Copy URL — the non-secret `orgii://cloud/session/ref` reference, same
  // action as the sidebar row menus. Hidden until the session has been
  // published to a cloud org, because a reference to an unpublished session
  // resolves for nobody (see useCopySessionReference).
  const { isCopyReferenceEligible, handleCopyReference, copyReferenceLabel } =
    useCopySessionReference();
  const canCopyReference =
    !!currentSession && isCopyReferenceEligible(currentSession);
  const handleCopySessionUrl = React.useCallback(() => {
    if (!currentSession) return;
    toggleHeaderActionsMenu();
    handleCopyReference(currentSession);
  }, [currentSession, handleCopyReference, toggleHeaderActionsMenu]);

  return (
    <>
      <Button
        ref={headerActionsTriggerRef}
        variant="tertiary"
        size="small"
        iconOnly
        className={isHeaderActionsOpen ? "bg-fill-1! text-primary-6!" : ""}
        onClick={(event) => {
          event.stopPropagation();
          toggleHeaderActionsMenu();
        }}
        aria-label={t("common:actions.more")}
        aria-expanded={isHeaderActionsOpen}
        data-testid={triggerTestId}
        icon={
          <HugeiconsIcon
            icon={MoreHorizontalIcon}
            data-icon="ellipsis"
            size={HEADER_ICON_SIZE}
            strokeWidth={2}
          />
        }
      />
      {isHeaderActionsOpen &&
        isHeaderActionsPositioned &&
        createPortal(
          <ActionMenuSurface
            panelRef={headerActionsDropdownRef}
            onClose={toggleHeaderActionsMenu}
            className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.sidebarMenuClass}`}
            style={{
              position: "fixed",
              top: headerActionsPosition.top ?? 0,
              right: headerActionsPosition.right ?? 0,
              zIndex: DROPDOWN_PANEL.zIndex,
            }}
          >
            {showTranscriptActions && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                onClick={handleOpenSearch}
                icon={
                  <HugeiconsIcon
                    icon={SearchList01Icon}
                    data-icon="search-list-01"
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                  />
                }
              >
                {t("chat.findInChat")}
              </DropdownItem>
            )}
            <DropdownItem
              role="menuitem"
              fullWidth
              tabIndex={0}
              onClick={handleReloadFromMenu}
              disabled={!currentSessionId}
              icon={
                <HugeiconsIcon
                  icon={Refresh04Icon}
                  data-icon="refresh-cw"
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={1.75}
                />
              }
            >
              {t("common:actions.reload")}
            </DropdownItem>
            {(showMoveSession || showOpenInNewWindow) && (
              <ActionSubmenu
                label={t("chat.moveTo")}
                icon={
                  <HugeiconsIcon
                    icon={CursorInWindowIcon}
                    data-icon="cursor-in-window"
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                  />
                }
                disabled={!currentSessionId}
                dataTestId="session-move-submenu"
              >
                {showMoveSession && (
                  <DropdownItem
                    role="menuitem"
                    fullWidth
                    tabIndex={0}
                    onClick={handleMoveSession}
                    disabled={!currentSessionId}
                    dataTestId={
                      moveToWorkstation
                        ? "move-session-to-workstation"
                        : "move-session-to-chat-panel"
                    }
                    icon={
                      <HugeiconsIcon
                        icon={ArrowBigRightDashIcon}
                        data-icon="arrow-big-right-dash"
                        size={DROPDOWN_ITEM.iconSize}
                        strokeWidth={1.75}
                      />
                    }
                  >
                    {moveToWorkstation
                      ? t("chat.moveToWorkstation")
                      : t("chat.moveToChatPanel")}
                  </DropdownItem>
                )}
                {showOpenInNewWindow && (
                  <DropdownItem
                    role="menuitem"
                    fullWidth
                    tabIndex={0}
                    onClick={handleOpenInNewWindow}
                    disabled={!currentSessionId}
                    dataTestId="open-session-in-new-window"
                    icon={
                      <HugeiconsIcon
                        icon={AppWindowMacIcon}
                        data-icon="app-window-mac"
                        size={DROPDOWN_ITEM.iconSize}
                        strokeWidth={1.75}
                      />
                    }
                  >
                    {t("common:actions.openInNewWindow")}
                  </DropdownItem>
                )}
              </ActionSubmenu>
            )}
            {(showTranscriptActions || canCopyReference) && (
              <ActionSubmenu
                label={t("chat.copyAndExport")}
                icon={
                  <HugeiconsIcon
                    icon={Copy01Icon}
                    data-icon="copy"
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                  />
                }
                dataTestId="session-copy-submenu"
              >
                {showTranscriptActions && (
                  <DropdownItem
                    role="menuitem"
                    fullWidth
                    tabIndex={0}
                    onClick={handleCopyEventJson}
                    disabled={eventsLength === 0}
                    dataTestId="session-copy-event-json-button"
                    icon={
                      <HugeiconsIcon
                        icon={ThirdBracketIcon}
                        data-icon="braces"
                        size={DROPDOWN_ITEM.iconSize}
                        strokeWidth={1.75}
                      />
                    }
                  >
                    {copyEventJsonLabel === "copied"
                      ? t("chat.copyEventJsonCopied")
                      : copyEventJsonLabel === "failed"
                        ? t("chat.copyEventJsonFailed")
                        : t("chat.copyEventJson")}
                  </DropdownItem>
                )}
                {canCopyReference && (
                  <DropdownItem
                    role="menuitem"
                    fullWidth
                    tabIndex={0}
                    onClick={handleCopySessionUrl}
                    dataTestId="session-copy-url-button"
                    icon={
                      <HugeiconsIcon
                        icon={Link01Icon}
                        data-icon="link"
                        size={DROPDOWN_ITEM.iconSize}
                        strokeWidth={1.75}
                      />
                    }
                  >
                    {copyReferenceLabel}
                  </DropdownItem>
                )}
                {showTranscriptActions && (
                  <DropdownItem
                    role="menuitem"
                    fullWidth
                    tabIndex={0}
                    onClick={handleOpenExportSessionJson}
                    disabled={!activeSessionExists}
                    dataTestId="session-export-button"
                    icon={
                      <HugeiconsIcon
                        icon={FolderOutputIcon}
                        data-icon="folder-output"
                        size={DROPDOWN_ITEM.iconSize}
                        strokeWidth={1.75}
                      />
                    }
                  >
                    {t("chat.importExport.exportJson")}
                  </DropdownItem>
                )}
              </ActionSubmenu>
            )}
            {showCloudShareSettings && (
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                onClick={handleOpenCloudShareSettings}
                dataTestId="cloud-session-share-settings-button"
                icon={
                  <HugeiconsIcon
                    icon={Share02Icon}
                    data-icon="share-2"
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                  />
                }
              >
                {t("navigation:cloud.share.menuItem")}
              </DropdownItem>
            )}
            <ActionSubmenu
              label={t("chat.projectLinks")}
              icon={
                <HugeiconsIcon
                  icon={Link02Icon}
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={1.75}
                />
              }
              disabled={!currentSessionId}
              dataTestId="session-project-links-submenu"
            >
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                onClick={handleTrackAsProject}
                disabled={!canTrackAsProject}
                dataTestId="session-track-as-project-button"
                icon={
                  <HugeiconsIcon
                    icon={DeliveryBox01Icon}
                    data-icon="box"
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                  />
                }
              >
                {t("sessions:chat.trackAsProject.menuItem")}
              </DropdownItem>
              <DropdownItem
                role="menuitem"
                fullWidth
                tabIndex={0}
                onClick={handleOpenLinkWorkItem}
                disabled={!currentSessionId}
                dataTestId="session-link-work-item-button"
                icon={
                  <HugeiconsIcon
                    icon={Link02Icon}
                    data-icon="link-2"
                    size={DROPDOWN_ITEM.iconSize}
                    strokeWidth={1.75}
                  />
                }
              >
                {t("chat.linkWorkItem.menuItem")}
              </DropdownItem>
            </ActionSubmenu>
            <SessionOpenInAppMenuItem
              key={`${currentSessionId ?? ""}:${appOpenSessionId ?? ""}`}
              sessionId={currentSessionId}
              appOpenSessionId={appOpenSessionId}
              onCloseMenu={toggleHeaderActionsMenu}
            />
            <div className={DROPDOWN_CLASSES.menuGroupSeparator} />
            {showTranscriptActions && (
              <>
                <ActionSubmenu
                  label={t("common:common.display")}
                  icon={
                    <HugeiconsIcon
                      icon={Layers01Icon}
                      size={DROPDOWN_ITEM.iconSize}
                      strokeWidth={1.75}
                    />
                  }
                  dataTestId="session-ui-settings-submenu"
                >
                  <MenuSwitchRow
                    label={t("common:layoutSettings.paginateChatHistory")}
                    checked={paginationEnabled}
                    onCheckedChange={handlePaginationToggle}
                  />
                  <div
                    role="separator"
                    className={DROPDOWN_CLASSES.menuGroupSeparator}
                  />
                  <MenuSwitchRow
                    label={t("chat.showTokenUsage")}
                    checked={tokenUsageVisible}
                    onCheckedChange={handleTokenUsageVisibleToggle}
                  />
                  <MenuSwitchRow
                    label={t("chat.showTurnMetadata")}
                    checked={turnMetadataVisible}
                    onCheckedChange={handleTurnMetadataVisibleToggle}
                    dataTestId="session-menu-turn-metadata-toggle"
                  />
                  <MenuSwitchRow
                    label={t("chat.showInlineDiffs")}
                    checked={displayMode === "full"}
                    onCheckedChange={(checked) =>
                      handleCompactDisplayModeToggle(!checked)
                    }
                  />
                  <MenuSwitchRow
                    label={t("chat.collapseToolActivity")}
                    checked={collapseToolActivity}
                    onCheckedChange={setCollapseToolActivity}
                    dataTestId="session-menu-collapse-tool-activity-toggle"
                  />
                  <MenuSwitchRow
                    label={t("settings:agentSessions.typingAnimation")}
                    checked={typingEffectEnabled}
                    onCheckedChange={setTypingEffectEnabled}
                    dataTestId="session-menu-typing-animation-toggle"
                  />
                </ActionSubmenu>
                <SessionInputSettingsSubmenu />
              </>
            )}
            <ActionSubmenu
              label={t("chat.navigation.title")}
              icon={
                <HugeiconsIcon
                  icon={AppWindowMacIcon}
                  size={DROPDOWN_ITEM.iconSize}
                  strokeWidth={1.75}
                />
              }
              dataTestId="session-navigation-submenu"
            >
              <div className={DROPDOWN_CLASSES.sectionLabel}>
                {t("chat.navigation.openLinksIn")}
              </div>
              {LINK_OPEN_TARGETS.map((target) => {
                const selected = linkOpenTarget === target;
                return (
                  <DropdownItem
                    key={target}
                    role="menuitemradio"
                    ariaChecked={selected}
                    tabIndex={0}
                    fullWidth
                    selected={selected}
                    onClick={() => setLinkOpenTarget(target)}
                    dataTestId={`session-menu-link-target-${target}`}
                  >
                    {t(LINK_OPEN_TARGET_LABEL_KEYS[target])}
                  </DropdownItem>
                );
              })}
            </ActionSubmenu>
          </ActionMenuSurface>,
          document.body
        )}
    </>
  );
};

SessionHeaderActionsMenu.displayName = "SessionHeaderActionsMenu";
