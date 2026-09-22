import { useAtomValue } from "jotai";
import React, { memo } from "react";

import {
  CHAT_PANEL_TAB_TYPE_POLICY,
  type ChatPanelTab,
} from "@src/store/chatPanel/chatPanelTabsModel";
import { activeChatPanelTabAtom } from "@src/store/chatPanel/chatPanelTabsState";

import { ChatPanelTabIcon } from "../ChatPanelTabBar/ChatPanelTabIcon";
import { useChatPanelTabDisplayTitle } from "../hooks/useChatPanelTabDisplayTitle";

const CollapsedTabHeadingLabel: React.FC<{ tab: ChatPanelTab }> = ({ tab }) => {
  const title = useChatPanelTabDisplayTitle(tab);
  const showIcon = CHAT_PANEL_TAB_TYPE_POLICY[tab.type].collapsedHeadingIcon;

  return (
    <span className="flex min-w-0 items-center gap-2 px-1 text-[13px] font-medium text-text-1">
      {showIcon && <ChatPanelTabIcon tab={tab} isActive />}
      <span className="truncate">{title}</span>
    </span>
  );
};

/**
 * Names the lone surface in the collapsed 36px header.
 *
 * Only surfaces that publish no header content of their own reach this: with
 * the tab row folded away, a terminal or Launchpad tab would otherwise sit
 * under an unlabeled bar. The label is the pill's, so folding the row never
 * renames the surface.
 */
export const ChatPanelCollapsedTabHeading: React.FC = memo(() => {
  const activeTab = useAtomValue(activeChatPanelTabAtom);
  if (!activeTab) return null;
  return <CollapsedTabHeadingLabel tab={activeTab} />;
});

ChatPanelCollapsedTabHeading.displayName = "ChatPanelCollapsedTabHeading";
