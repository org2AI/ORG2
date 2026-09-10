/**
 * TabPill — one pill in the chat-panel tab strip.
 *
 * Uses the same primitives as the Workstation tab bar
 * (TabPillSurface / TabPillCloseButton / TabLabelRowScrim) and
 * resolves its own icon and title from the tab type plus store data.
 */
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useAtomValue } from "jotai";
import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { TabLabelRowScrim } from "@src/components/TabPill/TabLabelRowScrim";
import { TabPillCloseButton } from "@src/components/TabPill/TabPillCloseButton";
import { TabPillSurface } from "@src/components/TabPill/TabPillSurface";
import { TERMINAL_AGENT_STATUS } from "@src/engines/TerminalCore/types";
import type { ChatPanelTab } from "@src/store/chatPanel/chatPanelTabsModel";
import { terminalSessionsAtom } from "@src/store/chatPanel/chatPanelTerminalAtom";

import { CHAT_PANEL_HEADER_NO_DRAG_STYLE } from "../header";
import { useChatPanelTabDisplayTitle } from "../hooks/useChatPanelTabDisplayTitle";
import { ChatPanelTabIcon } from "./ChatPanelTabIcon";
import { TabPillHoverCard } from "./TabPillHoverCard";

// ─── Constants ────────────────────────────────────────────────────────────────

const TERMINAL_AGENT_STATUS_DOT_CLASS = {
  [TERMINAL_AGENT_STATUS.STARTING]: "bg-warning-6",
  [TERMINAL_AGENT_STATUS.RUNNING]: "bg-success-6",
  [TERMINAL_AGENT_STATUS.WAITING]: "bg-warning-6",
  [TERMINAL_AGENT_STATUS.DONE]: "bg-fill-4",
} as const;

interface TabPillProps {
  tab: ChatPanelTab;
  isActive: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onContextMenu: (event: React.MouseEvent, id: string) => void;
}

export const TabPill = memo(function TabPill({
  tab,
  isActive,
  onActivate,
  onClose,
  onContextMenu,
}: TabPillProps) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const showCloseSlot = hovered;
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id, disabled: tab.type !== "session" });

  // When this tab becomes active (e.g. via a sidebar click), reveal it in the
  // horizontally-scrollable tab strip. `nearest` only scrolls when off-screen.
  const pillRef = useRef<HTMLButtonElement | HTMLDivElement>(null);
  const setPillRef = useCallback(
    (node: HTMLButtonElement | HTMLDivElement | null) => {
      pillRef.current = node;
      setNodeRef(node);
    },
    [setNodeRef]
  );
  useEffect(() => {
    if (isActive) {
      pillRef.current?.scrollIntoView({
        behavior: "smooth",
        inline: "nearest",
        block: "nearest",
      });
    }
  }, [isActive]);

  const terminalSessions = useAtomValue(terminalSessionsAtom);
  const terminalSession =
    tab.type === "terminal"
      ? terminalSessions.find(
          (candidate) => candidate.id === tab.terminalSessionId
        )
      : undefined;
  const agentStatus = terminalSession?.agentStatus;

  const displayTitle = useChatPanelTabDisplayTitle(tab);

  const pill = (
    <TabPillSurface
      ref={setPillRef}
      {...attributes}
      {...listeners}
      isActive={isActive}
      variant="session"
      role="tab"
      data-tab-id={tab.id}
      aria-selected={isActive}
      title={displayTitle}
      onClick={() => onActivate(tab.id)}
      onAuxClick={(evt) => {
        if (evt.button === 1) onClose(tab.id);
      }}
      onContextMenu={(event) => onContextMenu(event, tab.id)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...CHAT_PANEL_HEADER_NO_DRAG_STYLE,
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : 1,
      }}
    >
      <div className="flex shrink-0 items-center justify-center">
        <ChatPanelTabIcon tab={tab} isActive={isActive} />
      </div>
      <div className="relative flex min-w-0 flex-1 items-center overflow-hidden">
        <span
          className={`min-w-0 flex-1 overflow-hidden text-[13px] text-ellipsis whitespace-nowrap ${
            isActive ? "text-text-1" : "text-text-2"
          }`}
        >
          {displayTitle}
        </span>
        {agentStatus && (
          <span
            aria-hidden="true"
            className={`ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${TERMINAL_AGENT_STATUS_DOT_CLASS[agentStatus]}`}
          />
        )}
        <TabLabelRowScrim visible={showCloseSlot} />
      </div>
      <TabPillCloseButton
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onClose(tab.id);
        }}
        title={t("actions.close")}
        showX={hovered}
        visible={showCloseSlot}
        className="absolute top-1/2 right-1 z-10 h-5 w-5 -translate-y-1/2"
      />
    </TabPillSurface>
  );

  return <TabPillHoverCard tab={tab}>{pill}</TabPillHoverCard>;
});
