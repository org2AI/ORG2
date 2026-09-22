/**
 * AgentMessageBlock - Wraps agent messages in a collapsible block
 *
 * Header removed -- agent message content renders flush, with no row above
 * it. Agent messages still do NOT participate in "collapse all" so the user
 * can always read the conversation.
 *
 * **Clamping policy**: completed agent messages clamp long content to a
 * 20-line preview with the same expand-overlay pill that TerminalBlock uses.
 * This applies to every round, the latest included; only the live streaming
 * message stays fully open so active generation remains readable.
 *
 * The clamp no-ops silently when content already fits inside the preview
 * height — only messages that genuinely overflow surface the fade + Show
 * more pill. Renderers outside a turn context retain the host-provided clamp
 * eligibility for synthetic previews.
 *
 * **Locate arrow**: while clamped, a footer-hover `EventNavigateIcon` sits
 * below the preview at the right edge so the user can jump to the matching
 * simulator surface in one click. The message wrapper owns the named hover
 * group that reveals it.
 */
import React, {
  createContext,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";

import ExpandOverlay from "@src/components/ExpandOverlay";
import { useAgentTurnContext } from "@src/engines/ChatPanel/ChatHistory/AgentTurnContext";
import { createLogger } from "@src/hooks/logger";

import { EventNavigateIcon } from "../primitives";
import { useBlockHeader } from "../useBlockLocate";
import {
  type MessageTurnIdentity,
  useAgentMessageExpansion,
} from "./useAgentMessageExpansion";

// AgentMessageBlock renders flush in the chat panel — it has no container of
// its own — so the expand-overlay fade must dissolve into the chat-pane
// background (`bg-chat-pane`), not the inside-a-block `event-block-fade`
// color that other blocks use. Without this, the fade looks like a colored
// bar floating over the message.
const CHAT_PANE_FADE_FROM = "from-chat-pane";
const log = createLogger("AgentMessageBlock");

// Twenty lines at ~24px line-height, matching the earlier long-message
// preview depth used by the chat pane.
export const AGENT_MESSAGE_PREVIEW_MAX_HEIGHT = 480;

export function resolveAgentMessageClampEligibility(
  hasTurnContext: boolean,
  fallbackEligible: boolean
): boolean {
  return hasTurnContext || fallbackEligible;
}

const AgentMessageClampContext = createContext(false);

export const AgentMessageClampProvider = AgentMessageClampContext.Provider;

interface AgentMessageBlockProps {
  children: React.ReactNode;
  /**
   * Event id used by the locate arrow to jump to the matching simulator
   * event. Omitted for synthetic preview rendering where no event exists.
   */
  eventId?: string;
  rightContent?: React.ReactNode;
  /** Leave live output unclamped and hide settled-only locate chrome. */
  isStreaming?: boolean;
  /** Truncated response text needs hydration through the existing expand overlay. */
  truncatedResponseTurn?: MessageTurnIdentity;
}

const AgentMessageBlock: React.FC<AgentMessageBlockProps> = ({
  children,
  eventId,
  rightContent,
  isStreaming = false,
  truncatedResponseTurn,
}) => {
  const { t } = useTranslation("common");
  const fallbackClampEligible = useContext(AgentMessageClampContext);
  const turnContext = useAgentTurnContext();
  // The live streaming message is never clamped — it grows as tokens arrive
  // and hiding the tail behind a preview would bury the newest output. Once
  // it settles (isStreaming false) it clamps like any other completed message,
  // including in the latest round.
  const clampEligible =
    !isStreaming &&
    resolveAgentMessageClampEligibility(
      turnContext !== null || truncatedResponseTurn !== undefined,
      fallbackClampEligible
    );

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [overflows, setOverflows] = useState(false);
  const replyIdentity =
    truncatedResponseTurn ??
    (turnContext?.isLastItemInGroup &&
    turnContext.sessionId &&
    turnContext.turnId
      ? { sessionId: turnContext.sessionId, turnId: turnContext.turnId }
      : undefined);
  const {
    isExpanded,
    setExpanded: setIsExpanded,
    toggle,
  } = useAgentMessageExpansion(replyIdentity, truncatedResponseTurn);

  // Reset local measurements when clamp eligibility changes. Expansion intent
  // can also be observed by a hydrated replacement, so reset that after commit.
  const [prevClampEligible, setPrevClampEligible] = useState(clampEligible);
  if (prevClampEligible !== clampEligible) {
    setPrevClampEligible(clampEligible);
    if (overflows) setOverflows(false);
  }
  useLayoutEffect(() => {
    if (!clampEligible) setIsExpanded(false);
  }, [clampEligible, setIsExpanded]);

  // Reuse the shared header hook purely for its replay-locate wiring. We
  // don't render a header row here — `handleLocate` is the only piece we need.
  const { handleLocate } = useBlockHeader({
    eventId,
    defaultCollapsed: false,
    collapseAllValue: false,
  });

  // Measure overflow whenever clampability or expansion state changes.
  // Also observe the viewport for content reflow (markdown re-renders while
  // streaming, image loads, etc.) so the pill appears as soon as content
  // pushes past the preview height. Skip entirely when clamping is not
  // eligible — there's no measurement we'd act on.
  useLayoutEffect(() => {
    if (!clampEligible) return;
    const element = viewportRef.current;
    if (!element) return;
    const measure = () => {
      // Compare content height against the fixed preview height, NOT against
      // clientHeight. clientHeight is subject to sub-pixel line-height
      // rounding that reads 1–2px larger than scrollHeight for single-line
      // content — and once the overlay mounts inside this measured element it
      // latches — which false-positived the clamp on one-line messages
      // (wrapping the same text to two lines made the discrepancy vanish).
      // The clamp only needs to fire when content genuinely exceeds the
      // 20-line preview, so measure that directly.
      setOverflows(element.scrollHeight > AGENT_MESSAGE_PREVIEW_MAX_HEIGHT + 1);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [clampEligible, isExpanded]);

  if (!clampEligible) {
    return (
      <div className="group/agent-message w-full min-w-0 overflow-hidden px-2 py-0.5">
        {children}
        {rightContent && (
          <div className="mt-1 flex justify-end">{rightContent}</div>
        )}
      </div>
    );
  }

  const showOverlay =
    overflows || isExpanded || truncatedResponseTurn !== undefined;
  return (
    <div
      className={`group/agent-message w-full min-w-0 px-2 py-0.5 ${isExpanded ? "overflow-visible" : "overflow-hidden"}`}
    >
      <div
        ref={viewportRef}
        className="group/expand relative scrollbar-hide"
        style={
          isExpanded
            ? { maxHeight: "none", overflow: "visible" }
            : {
                maxHeight: AGENT_MESSAGE_PREVIEW_MAX_HEIGHT,
                overflow: "hidden",
              }
        }
      >
        {children}
        {showOverlay && (
          <ExpandOverlay
            isExpanded={isExpanded}
            onToggle={(event) => {
              event.stopPropagation();
              toggle().catch((error: unknown) => {
                log.warn("Could not toggle message expansion", error);
              });
            }}
            collapsedLabel={t("actions.expand")}
            expandedLabel={t("actions.collapse")}
            fadeFrom={CHAT_PANE_FADE_FROM}
            showLabel
            alwaysShowControl
          />
        )}
      </div>
      {rightContent && (
        <div className="mt-1 flex justify-end">{rightContent}</div>
      )}
      {eventId && handleLocate && (
        <div className="mt-1 flex justify-end">
          <EventNavigateIcon onClick={handleLocate} variant="footer-hover" />
        </div>
      )}
    </div>
  );
};

AgentMessageBlock.displayName = "AgentMessageBlock";

export default AgentMessageBlock;
