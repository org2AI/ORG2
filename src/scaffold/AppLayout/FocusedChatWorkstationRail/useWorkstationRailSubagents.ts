/**
 * Subagent rows of the focused-chat workstation rail: the inline preview,
 * the "load more" submenu that holds the rest, and the side-chat handoff a
 * row performs. The submenu is anchored to a row of the compact menu, so the
 * menu's visibility handler lives here too.
 */
import type { TFunction } from "i18next";
import { useSetAtom } from "jotai";
import type React from "react";
import { useCallback, useMemo } from "react";

import { MoreHorizontalIcon } from "@src/icons";
import { openSideChatAtom } from "@src/store/ui/sideChatAtom";

import { useWorkstationRailSubmenu } from "./WorkstationRailSubmenu";
import { resolveSubagentRowStatus } from "./WorkstationSubagentsSubmenu";
import type {
  FocusedChatRailIcon,
  FocusedChatRailItem,
  FocusedChatRailSubagent,
} from "./types";

/** Subagent rows shown inline; the rest sit behind the "load more" submenu. */
const SUBAGENT_PREVIEW_COUNT = 5;

export function useWorkstationRailSubagents({
  setMenuOpen,
  subagentIcon,
  subagents,
  t,
}: {
  setMenuOpen: (open: boolean) => void;
  subagentIcon: FocusedChatRailIcon;
  subagents: FocusedChatRailSubagent[];
  t: TFunction;
}) {
  const openSideChat = useSetAtom(openSideChatAtom);
  const {
    anchor: subagentsSubmenuAnchor,
    close: closeSubagentsSubmenu,
    maxHeight: subagentsSubmenuMaxHeight,
    panelRef: subagentsSubmenuPanelRef,
    toggle: toggleSubagentsSubmenu,
    width: subagentsSubmenuWidth,
  } = useWorkstationRailSubmenu();
  const subagentsSubmenuInsideRefs = useMemo(
    () => [subagentsSubmenuPanelRef],
    [subagentsSubmenuPanelRef]
  );

  /** Watch a subagent in the floating side chat without leaving this tab. */
  const openSubagentSession = useCallback(
    (subagentSessionId: string) => {
      closeSubagentsSubmenu();
      setMenuOpen(false);
      openSideChat(subagentSessionId);
    },
    [closeSubagentsSubmenu, openSideChat, setMenuOpen]
  );

  const subagentItems = useMemo<FocusedChatRailItem[]>(() => {
    const previewed = subagents
      .slice(0, SUBAGENT_PREVIEW_COUNT)
      .map((subagent) => ({
        key: `subagent:${subagent.sessionId}`,
        label: subagent.description || subagent.name,
        // The harness mark, never the generic bot: a subagent runs on its
        // parent's runtime, and `subagentIcon` is resolved from that session
        // through the same projection the sidebar row uses.
        icon: subagentIcon,
        status: resolveSubagentRowStatus(t, subagent.status),
        onClick: () => openSubagentSession(subagent.sessionId),
      }));
    if (subagents.length <= SUBAGENT_PREVIEW_COUNT) return previewed;
    return [
      ...previewed,
      {
        key: "subagents-load-more",
        label: t("common:git.rail.loadMoreSubagents", {
          count: subagents.length - SUBAGENT_PREVIEW_COUNT,
        }),
        icon: MoreHorizontalIcon,
        submenu: true,
        onClick: (event: React.MouseEvent<HTMLButtonElement>) =>
          toggleSubagentsSubmenu(event.currentTarget),
      },
    ];
  }, [openSubagentSession, subagentIcon, subagents, t, toggleSubagentsSubmenu]);

  // A submenu anchored to a row of the compact menu cannot outlive the menu.
  const handleMenuVisibleChange = useCallback(
    (visible: boolean) => {
      setMenuOpen(visible);
      if (!visible) closeSubagentsSubmenu();
    },
    [closeSubagentsSubmenu, setMenuOpen]
  );

  return {
    closeSubagentsSubmenu,
    handleMenuVisibleChange,
    openSubagentSession,
    subagentItems,
    subagentsSubmenuAnchor,
    subagentsSubmenuInsideRefs,
    subagentsSubmenuMaxHeight,
    subagentsSubmenuPanelRef,
    subagentsSubmenuWidth,
  };
}
