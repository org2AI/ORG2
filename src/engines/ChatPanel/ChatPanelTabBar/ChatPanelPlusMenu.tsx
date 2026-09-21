/**
 * ChatPanelPlusMenu — the "+" button and its dropdown, placed in the chat
 * panel header toolbar (right of the "..." menu on Launchpad).
 */
import { useAtomValue, useSetAtom } from "jotai";
import React, { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Dropdown from "@src/components/Dropdown";
import DropdownActionItem from "@src/components/Dropdown/DropdownActionItem";
import {
  DROPDOWN_CLASSES,
  DROPDOWN_ITEM,
  DROPDOWN_WIDTHS,
} from "@src/components/Dropdown/tokens";
import { RecentTabsMenuSection } from "@src/components/RecentTabsMenuSection";
import { TabBarTrailingIconButton } from "@src/components/TabPill/TabBarTrailingIconButton";
import { HEADER_ICON_SIZE } from "@src/config/workstation/tokens";
import {
  Add01Icon,
  Briefcase02Icon,
  DeliveryBox01Icon,
  GaugeIcon,
  HugeiconsIcon,
  KanbanIcon,
  MessageAdd02Icon,
  PictureInPicture01Icon,
} from "@src/icons";
import {
  openRecentChatPanelTabAtom,
  recentChatPanelTabsAtom,
} from "@src/store/chatPanel/chatPanelTabsAtom";
import { type ChatPanelTab } from "@src/store/chatPanel/chatPanelTabsModel";
import { shouldShowInRecentTabsMenu } from "@src/util/tabs/recentTabsMenu";

import { SessionIdentityIconById } from "../components/SessionIdentityIcon";
import { CHAT_PANEL_HEADER_NO_DRAG_STYLE } from "../header";

// ─── Plus-menu dropdown ───────────────────────────────────────────────────────

export interface ChatPanelPlusMenuProps {
  onOpenLaunchpad: () => void;
  onOpenKanban: () => void;
  onOpenRuntime: () => void;
  onNewProject: () => void;
  onNewWorkItem: () => void;
  onOpenSideChat: () => void;
}

interface PlusMenuContentProps extends ChatPanelPlusMenuProps {
  recentTabs: readonly ChatPanelTab[];
  onOpenRecentTab: (tabId: string) => void;
  onClose: () => void;
}

export function PlusMenuContent({
  onOpenLaunchpad,
  onOpenKanban,
  onOpenRuntime,
  onNewProject,
  onNewWorkItem,
  onOpenSideChat,
  recentTabs,
  onOpenRecentTab,
  onClose,
}: PlusMenuContentProps) {
  const { t } = useTranslation(["sessions", "navigation"]);

  // New session opens the singleton start page. It carries the ⌘N hint since
  // that shortcut (handled in ChatPanelTabBar) opens the same surface.
  const items = [
    {
      id: "launchpad",
      icon: (
        <HugeiconsIcon
          icon={MessageAdd02Icon}
          data-icon="message-add"
          size={DROPDOWN_ITEM.iconSize}
          strokeWidth={1.8}
        />
      ),
      label: t("sessions:chat.startPage.newSession.title"),
      shortcutId: "new_session",
      onClick: onOpenLaunchpad,
    },
    {
      id: "work-management",
      icon: (
        <HugeiconsIcon
          icon={KanbanIcon}
          data-icon="kanban"
          size={DROPDOWN_ITEM.iconSize}
          strokeWidth={1.8}
        />
      ),
      label: t("sessions:simulator.tabs.kanban"),
      onClick: onOpenKanban,
    },
    {
      id: "runtime",
      icon: (
        <HugeiconsIcon
          icon={GaugeIcon}
          data-icon="gauge"
          size={DROPDOWN_ITEM.iconSize}
          strokeWidth={1.8}
        />
      ),
      label: t("sessions:chat.startPage.tabs.runtime"),
      onClick: onOpenRuntime,
    },
    {
      id: "new-project",
      icon: (
        <HugeiconsIcon
          icon={DeliveryBox01Icon}
          data-icon="box"
          size={DROPDOWN_ITEM.iconSize}
          strokeWidth={1.8}
        />
      ),
      label: t("sessions:creator.createTarget.project"),
      onClick: onNewProject,
    },
    {
      id: "new-work-item",
      icon: (
        <HugeiconsIcon
          icon={Briefcase02Icon}
          data-icon="briefcase-business"
          size={DROPDOWN_ITEM.iconSize}
          strokeWidth={1.8}
        />
      ),
      label: t("chat.startPage.newWorkItem.title"),
      onClick: onNewWorkItem,
    },
    {
      id: "side-chat",
      icon: (
        <HugeiconsIcon
          icon={PictureInPicture01Icon}
          data-icon="picture-in-picture-2"
          size={DROPDOWN_ITEM.iconSize}
          strokeWidth={1.8}
        />
      ),
      label: t("sessions:chat.sideChat.title"),
      onClick: onOpenSideChat,
    },
  ] as const;

  return (
    <div
      className={`${DROPDOWN_CLASSES.menuPanelBase} ${DROPDOWN_WIDTHS.sidebarMenuClass}`}
    >
      <div className={DROPDOWN_CLASSES.itemsColumn}>
        {items.map((item) => (
          <DropdownActionItem
            key={item.id}
            icon={item.icon}
            shortcutId={"shortcutId" in item ? item.shortcutId : undefined}
            onClick={() => {
              onClose();
              item.onClick();
            }}
          >
            {item.label}
          </DropdownActionItem>
        ))}
        <RecentTabsMenuSection
          tabs={recentTabs.filter(shouldShowInRecentTabsMenu).map((tab) => ({
            id: tab.id,
            title: tab.title,
            leadingIcon:
              tab.type === "session" && tab.sessionId ? (
                <SessionIdentityIconById
                  sessionId={tab.sessionId}
                  isSelected={false}
                />
              ) : undefined,
          }))}
          label={t("navigation:workstation.plusMenu.recent")}
          onOpen={(tabId) => {
            onClose();
            onOpenRecentTab(tabId);
          }}
        />
      </div>
    </div>
  );
}

// ─── Exported + menu button (placed in header toolbar, left of ...) ───────────

export function ChatPanelPlusMenu(
  actions: ChatPanelPlusMenuProps
): React.ReactNode {
  const { t } = useTranslation("sessions");
  const [menuOpen, setMenuOpen] = useState(false);
  const recentTabs = useAtomValue(recentChatPanelTabsAtom);
  const openRecentTab = useSetAtom(openRecentChatPanelTabAtom);
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const plusLabel = t("chat.tabs.newTab", "New tab");

  return (
    <Dropdown
      droplist={
        <PlusMenuContent
          {...actions}
          recentTabs={recentTabs}
          onOpenRecentTab={openRecentTab}
          onClose={closeMenu}
        />
      }
      position="bottom-end"
      trigger="click"
      popupVisible={menuOpen}
      onVisibleChange={setMenuOpen}
      getPopupContainer={() => document.body}
      avoidViewportOverflow
    >
      <span
        className="inline-flex shrink-0"
        style={CHAT_PANEL_HEADER_NO_DRAG_STYLE}
      >
        <TabBarTrailingIconButton
          title={plusLabel}
          active={menuOpen}
          tooltipDisabled
          nativeTitle={false}
        >
          <HugeiconsIcon
            icon={Add01Icon}
            data-icon="plus"
            size={HEADER_ICON_SIZE.md}
            strokeWidth={2}
          />
        </TabBarTrailingIconButton>
      </span>
    </Dropdown>
  );
}
