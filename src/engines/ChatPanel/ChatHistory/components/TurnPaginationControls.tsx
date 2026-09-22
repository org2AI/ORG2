/**
 * TurnPaginationControls
 *
 * Top-of-history toolbar that hosts the Agent Team member label, round
 * selector, current time-range label, and previous / next / last-round
 * buttons.
 */
import React, { memo } from "react";

import type { AgentOrgRunMemberView } from "@src/api/tauri/agent";
import TurnNavigationToolbar from "@src/components/TurnNavigationToolbar/TurnNavigationToolbar";
import { CHAT_PANEL_WIDTH_TOKENS } from "@src/config/detailPanelTokens";

import AgentOrgSurfaceSwitcher from "./AgentOrgSurfaceSwitcher";

interface TurnPaginationControlsProps {
  agentName?: string | null;
  /** memberId of the row currently being viewed, used for active state. */
  currentMemberId?: string | null;
  agentOrgMembers?: AgentOrgRunMemberView[];
  agentOrgOverviewPanel?: React.ReactNode;
  agentOrgOverviewOpen: boolean;
  setAgentOrgOverviewOpen: React.Dispatch<React.SetStateAction<boolean>>;
  onAgentOrgMemberSelect?: (member: AgentOrgRunMemberView) => void;
  onAgentOrgRunViewRefresh?: () => Promise<void>;
  turnPaginationEnabled: boolean;
  turnPaginationReady: boolean;
  turnPageListOpen: boolean;
  setTurnPageListOpen: React.Dispatch<React.SetStateAction<boolean>>;
  turnPageSortAscending: boolean;
  setTurnPageSortAscending: React.Dispatch<React.SetStateAction<boolean>>;
  currentTurnPageLabel: string;
  currentTurnPageTimeLabel: string;
  currentPageIndex: number;
  pageCount: number;
  onPreviousTurnPage: () => void;
  onNextTurnPage: () => void;
  onLastTurnPage: () => void;
  /**
   * Optional slot rendered immediately to the right of the round-select
   * trigger, separated by a vertical bar. Subagent panels use this to
   * inject a "toggle turn prompt" info button so it sits with the round
   * selector rather than the replay footer. Hidden when
   * `turnPaginationEnabled` is false (the entire round selector is gone).
   */
  trailingActions?: React.ReactNode;
  /**
   * When true, the chat surface is rendering the Agent Team group chat
   * view instead of the per-member `ChatHistory`. The agent dropdown
   * shows this as a checked first-row option ("Group chat") and the
   * trigger label is replaced by the group label so the user can see
   * the active surface at a glance.
   */
  groupChatViewActive?: boolean;
  /**
   * Toggles the group chat view. When the user picks a member row,
   * the parent should additionally turn the group view off so the
   * usual single-member ChatHistory takes over.
   */
  onGroupChatViewToggle?: (active: boolean) => void;
  /**
   * When false, the "Group chat" option is hidden (e.g. the active
   * session is not an Agent Team run or has no eligible members).
   */
  groupChatViewAvailable?: boolean;
}

// memo: every parent re-render (e.g. each chat-history snapshot or
// turn-page selection) would otherwise re-mount the whole toolbar,
// causing the round selector to visibly flash on prev/next clicks.
// All props are primitives or stable callbacks (useCallback / state
// setters), so the default shallow compare is enough.
const TurnPaginationControls: React.FC<TurnPaginationControlsProps> = memo(
  ({
    agentName,
    currentMemberId = null,
    agentOrgMembers = [],
    agentOrgOverviewPanel,
    agentOrgOverviewOpen,
    setAgentOrgOverviewOpen,
    onAgentOrgMemberSelect,
    onAgentOrgRunViewRefresh,
    turnPaginationEnabled,
    turnPaginationReady,
    turnPageListOpen,
    setTurnPageListOpen,
    turnPageSortAscending,
    setTurnPageSortAscending,
    currentTurnPageLabel,
    currentTurnPageTimeLabel,
    currentPageIndex,
    pageCount,
    onPreviousTurnPage,
    onNextTurnPage,
    onLastTurnPage,
    trailingActions,
    groupChatViewActive = false,
    onGroupChatViewToggle,
    groupChatViewAvailable = false,
  }) => {
    const hasAgentOrgOverview = Boolean(agentOrgOverviewPanel);
    const hasAgentOrgSurface =
      hasAgentOrgOverview || Boolean(agentName) || groupChatViewActive;

    const agentOrgLeading = (
      <AgentOrgSurfaceSwitcher
        currentMemberId={currentMemberId}
        currentMemberName={agentName}
        members={agentOrgMembers}
        overviewAvailable={hasAgentOrgOverview}
        overviewOpen={agentOrgOverviewOpen}
        setOverviewOpen={setAgentOrgOverviewOpen}
        onMemberSelect={onAgentOrgMemberSelect}
        onRunViewRefresh={onAgentOrgRunViewRefresh}
        groupChatActive={groupChatViewActive}
        groupChatAvailable={groupChatViewAvailable}
        onGroupChatToggle={onGroupChatViewToggle}
        onCloseSiblingMenu={() => setTurnPageListOpen(false)}
        siblingMenuOpen={turnPageListOpen}
        showTrailingSeparator={Boolean(agentName) && turnPaginationEnabled}
      />
    );

    if (!turnPaginationEnabled) {
      if (!hasAgentOrgSurface) return null;
      return (
        <div
          className={`flex h-10 min-h-10 shrink-0 items-center gap-1.5 px-2 text-xs text-text-3 ${CHAT_PANEL_WIDTH_TOKENS.contentWidth}`}
        >
          {agentOrgLeading}
        </div>
      );
    }

    return (
      <TurnNavigationToolbar
        variant="desktop"
        className={CHAT_PANEL_WIDTH_TOKENS.contentWidth}
        enabled
        ready={turnPaginationReady}
        listOpen={turnPageListOpen}
        onToggleList={() => {
          setAgentOrgOverviewOpen(false);
          setTurnPageListOpen((open) => !open);
        }}
        sortAscending={turnPageSortAscending}
        onToggleSort={() => setTurnPageSortAscending((ascending) => !ascending)}
        onCloseList={() => setTurnPageListOpen(false)}
        currentLabel={currentTurnPageLabel}
        currentTimeLabel={currentTurnPageTimeLabel}
        currentIndex={currentPageIndex}
        pageCount={pageCount}
        onPrevious={onPreviousTurnPage}
        onNext={onNextTurnPage}
        onLatest={onLastTurnPage}
        leading={agentOrgLeading}
        trailingAfterSelector={trailingActions}
      />
    );
  }
);

TurnPaginationControls.displayName = "TurnPaginationControls";

export default TurnPaginationControls;
