import React, {
  memo,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";

import Button from "@src/components/Button";
import { DROPDOWN_CLASSES } from "@src/components/Dropdown/tokens";
import { normalizeUserMessageText } from "@src/engines/ChatPanel/ChatItems/normalizeUserMessageText";
import { stripExpandedPillContent } from "@src/engines/ChatPanel/InputArea/utils/pillContentParser";
import type { PinnedMinimapMark } from "@src/engines/ChatPanel/chatSelections/pinnedMinimapMarks";
import { FocusedChatWorkstationMinimapPortalContext } from "@src/engines/ChatPanel/focusedChatWorkstationMinimapPortal";
import { Cancel01Icon, HugeiconsIcon } from "@src/icons";

import { isAssistantMessageEvent } from "../chatItemPipeline/dedup";
import type { OptimizedChatItem } from "../chatItemPipeline/types";
import type { ChatGroupMeta } from "../hooks/useChatGroups";
import { getRoundPreviewText } from "../utils/turnPageFormatting";
import { getTurnTimingLabels } from "../utils/turnTimingFormatting";

export const MAX_CONVERSATION_MINIMAP_MARKERS = 20;

// The minimap is always pinned to the chat body's right edge, so the hover
// preview must open left (into the chat) to stay inside the chat's
// `overflow-hidden` bounds. Opening outward — toward the pane edge or a
// neighboring panel — gets the preview clipped, regardless of dock side.
export const CONVERSATION_PREVIEW_POSITION_CLASS =
  "right-full mr-3 @[640px]/chatbody:mr-1";

export function sampleConversationGroupIndices(
  groupIndices: readonly number[],
  maxMarkers = MAX_CONVERSATION_MINIMAP_MARKERS
): number[] {
  if (maxMarkers <= 0 || groupIndices.length === 0) return [];
  if (groupIndices.length <= maxMarkers) return [...groupIndices];
  if (maxMarkers === 1) return [groupIndices[groupIndices.length - 1]];

  const lastIndex = groupIndices.length - 1;
  return Array.from({ length: maxMarkers }, (_, markerIndex) => {
    const percentage = markerIndex / (maxMarkers - 1);
    return groupIndices[Math.round(percentage * lastIndex)];
  });
}

export function findNearestConversationMarker(
  markerGroupIndices: readonly number[],
  activeGroupIndex: number
): number | null {
  if (markerGroupIndices.length === 0) return null;
  return markerGroupIndices.reduce((nearest, candidate) =>
    Math.abs(candidate - activeGroupIndex) <
    Math.abs(nearest - activeGroupIndex)
      ? candidate
      : nearest
  );
}

export function resolveActiveConversationMarker(
  markerGroupIndices: readonly number[],
  activeGroupIndex: number,
  isAtBottom: boolean
): number | null {
  if (isAtBottom) return markerGroupIndices.at(-1) ?? null;
  return findNearestConversationMarker(markerGroupIndices, activeGroupIndex);
}

export function resolveHighlightedConversationMarkers(
  markerGroupIndices: readonly number[],
  visibleGroupIndices: readonly number[],
  activeGroupIndex: number,
  isAtBottom: boolean
): number[] {
  const highlightedMarkers = new Set<number>();
  const sourceGroupIndices =
    visibleGroupIndices.length > 0 ? visibleGroupIndices : [activeGroupIndex];
  for (const groupIndex of sourceGroupIndices) {
    const nearestMarker = findNearestConversationMarker(
      markerGroupIndices,
      groupIndex
    );
    if (nearestMarker !== null) highlightedMarkers.add(nearestMarker);
  }
  if (isAtBottom) {
    const finalMarker = markerGroupIndices.at(-1);
    if (finalMarker !== undefined) highlightedMarkers.add(finalMarker);
  }
  return [...highlightedMarkers];
}

export function getNavigableConversationGroupIndices(
  groupHeaders: readonly unknown[],
  groupCounts: readonly number[],
  groupMeta: readonly Pick<ChatGroupMeta, "retryAudit">[] = []
): number[] {
  const groupLength = Math.max(groupHeaders.length, groupCounts.length);
  return Array.from(
    { length: groupLength },
    (_, groupIndex) => groupIndex
  ).filter(
    (groupIndex) =>
      !groupMeta[groupIndex]?.retryAudit &&
      (groupHeaders[groupIndex] != null || (groupCounts[groupIndex] ?? 0) > 0)
  );
}

/**
 * Width at which the chat body's centered `max-w-[800px]` content clears the
 * rail on its own, so the rail can sit flush in the outer gutter without
 * touching a message. The tight crossover is 856px ((856 − 800) / 2 + 8px of
 * row padding ≥ 36px); this stays at the roomier 960px the 900px column
 * needed, so a flush rail never sits shoulder-to-shoulder with the text.
 *
 * Below it the rail has nowhere of its own to stand, and the scrollport
 * deliberately does NOT reserve space for it — it floats as an inset pill
 * over the transcript instead. Same rule in the trail-hosted variant, where
 * the crossover is the 1100px at which the trail column becomes real.
 */
export const CONVERSATION_MINIMAP_FLUSH_CONTAINER_PX = 960;

/** Whether the conversation has enough navigable rounds to show the rail. */
export function hasConversationMinimapRail(
  groupHeaders: readonly unknown[],
  groupCounts: readonly number[],
  groupMeta: readonly Pick<ChatGroupMeta, "retryAudit">[] = []
): boolean {
  return (
    getNavigableConversationGroupIndices(groupHeaders, groupCounts, groupMeta)
      .length >= 2
  );
}

export function getConversationMarkerWidthClass(
  markerIndex: number,
  previewMarkerIndex: number
): string {
  if (previewMarkerIndex < 0) return "w-2";
  const distance = Math.abs(markerIndex - previewMarkerIndex);
  if (distance === 0) return "w-5";
  if (distance === 1) return "w-4";
  if (distance === 2) return "w-3";
  return "w-2";
}

/**
 * The floating pill — one literal, shared by both panes so they cannot drift
 * apart. Compact markers hugging the right edge, on a bordered blurred
 * surface inset from the edge, because nothing reserves space for it here.
 */
const MINIMAP_FLOATING_NAV_CLASS =
  "pointer-events-auto absolute right-3 top-1/2 z-40 -translate-y-1/2 flex-col overflow-visible rounded-xl border border-border-2/60 bg-bg-1/90 px-1 py-2 shadow-lg backdrop-blur-xs transition-opacity motion-reduce:transition-none";
const MINIMAP_FLOATING_MARKER_CLASS =
  "relative flex h-3 w-2 shrink-0 items-center justify-end";
/**
 * Pinned marks sit above the turn ticks, separated by a hairline. They are
 * solid where a turn tick is faint: a turn is sampled scenery, a pin is
 * something the reader put there by hand.
 */
const MINIMAP_PIN_MARKER_CLASS =
  "h-[3px] w-3 shrink-0 rounded-full transition-colors duration-150 motion-reduce:transition-none";
const MINIMAP_PIN_DIVIDER_CLASS = "my-1 h-px w-3 shrink-0 bg-border-2/80";

/**
 * The pin card is interactive — it carries the unpin control — so the
 * pointer has to be able to reach it. The wrapper owns the gap between the
 * rail and the card as padding, turning what would be a dead strip into a
 * hover bridge, and a short grace period covers a pointer that leaves the
 * rail on its way across.
 */
const MINIMAP_PIN_PREVIEW_BRIDGE_CLASS =
  "absolute top-1/2 right-full -translate-y-1/2 pr-3 pl-2 @[640px]/chatbody:pr-1";
const PIN_PREVIEW_CLOSE_DELAY_MS = 180;

const MINIMAP_FLOATING_MARKER_BUTTON_CLASS =
  "group flex h-3 w-2 cursor-pointer items-center justify-end border-0 bg-transparent p-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-6/30";

/**
 * Overrides that turn the pill into a bare flush rail once the pane gives it
 * a column of its own. Same set in both panes; only the container query
 * differs, and each has to be written out in full because Tailwind reads
 * class names literally out of the source.
 *
 * Maximized chat crosses over at 850px, where the trail track starts
 * reserving the rail's 36px. The side pane crosses over at 960px, where the
 * centered content clears the outer gutter by itself.
 */
const MINIMAP_FLUSH_OVERRIDES = {
  maximized: {
    nav: "@[850px]/focusedchat:right-0 @[850px]/focusedchat:w-9 @[850px]/focusedchat:items-center @[850px]/focusedchat:rounded-none @[850px]/focusedchat:border-0 @[850px]/focusedchat:bg-transparent @[850px]/focusedchat:p-0 @[850px]/focusedchat:shadow-none @[850px]/focusedchat:backdrop-blur-none @[1100px]/focusedchat:top-2 @[1100px]/focusedchat:translate-y-0",
    marker: "@[850px]/focusedchat:w-9 @[850px]/focusedchat:justify-center",
    markerButton:
      "@[850px]/focusedchat:w-9 @[850px]/focusedchat:justify-center",
  },
  side: {
    nav: "@[960px]/chatbody:right-0 @[960px]/chatbody:w-9 @[960px]/chatbody:items-center @[960px]/chatbody:rounded-none @[960px]/chatbody:border-0 @[960px]/chatbody:bg-transparent @[960px]/chatbody:p-0 @[960px]/chatbody:shadow-none @[960px]/chatbody:backdrop-blur-none",
    marker: "@[960px]/chatbody:w-9 @[960px]/chatbody:justify-center",
    markerButton: "@[960px]/chatbody:w-9 @[960px]/chatbody:justify-center",
  },
} as const;

/**
 * When the rail is on screen.
 *
 * While it floats it follows the side pane's rule in both panes: it appears
 * on scroll or hover, and otherwise only once the body is wide enough to
 * carry it. Once a maximized pane gives it a column of its own it is always
 * up — worth stating separately, because a wide trail can leave the body
 * under 640px while the pane itself is well past 850px.
 *
 * The two container queries set the same declaration, so whichever Tailwind
 * emits last is irrelevant: the rail shows if either matches.
 */
export function resolveConversationMinimapVisibilityClass({
  showFloatingMinimap,
  inWorkstationRail,
}: {
  showFloatingMinimap: boolean;
  inWorkstationRail: boolean;
}): string {
  if (showFloatingMinimap) return "flex";
  return inWorkstationRail
    ? "hidden @[640px]/chatbody:flex @[850px]/focusedchat:flex"
    : "hidden @[640px]/chatbody:flex";
}

/**
 * One rail in two arrangements: a floating pill while it would cover the
 * transcript, a bare flush rail once it has space of its own. The floating
 * half is identical in both panes — they differ only in the width at which
 * they cross over.
 */
export function getConversationMinimapPlacementClasses(
  inWorkstationRail: boolean
) {
  const flush = inWorkstationRail
    ? MINIMAP_FLUSH_OVERRIDES.maximized
    : MINIMAP_FLUSH_OVERRIDES.side;
  return {
    nav: `${MINIMAP_FLOATING_NAV_CLASS} ${flush.nav}`,
    marker: `${MINIMAP_FLOATING_MARKER_CLASS} ${flush.marker}`,
    markerButton: `${MINIMAP_FLOATING_MARKER_BUTTON_CLASS} ${flush.markerButton}`,
  };
}

function getUserPreview(header: OptimizedChatItem | null): string {
  const displayText = header?.event?.displayText;
  if (typeof displayText !== "string") return "";
  return getRoundPreviewText(
    normalizeUserMessageText(stripExpandedPillContent(displayText))
  );
}

function buildAssistantPreviews(
  flatItems: readonly OptimizedChatItem[],
  groupCounts: readonly number[]
): string[] {
  let groupStartIndex = 0;
  return groupCounts.map((groupCount) => {
    const groupEndIndex = groupStartIndex + groupCount;
    let preview = "";
    for (let index = groupEndIndex - 1; index >= groupStartIndex; index--) {
      const event = flatItems[index]?.event;
      if (!event || !isAssistantMessageEvent(event)) continue;
      if (typeof event.displayText !== "string") continue;
      preview = getRoundPreviewText(event.displayText);
      if (preview) break;
    }
    groupStartIndex = groupEndIndex;
    return preview;
  });
}

interface ConversationMinimapProps {
  groupHeaders: readonly (OptimizedChatItem | null)[];
  groupMeta: readonly ChatGroupMeta[];
  groupCounts: readonly number[];
  flatItems: readonly OptimizedChatItem[];
  activeGroupIndex: number;
  visibleGroupIndices: readonly number[];
  isAtBottom: boolean;
  isScrolling: boolean;
  labelVariant?: "agent" | "agents";
  onNavigate: (groupIndex: number) => void;
  /** Passages pinned in this session, in transcript order. */
  pinnedMarks?: readonly PinnedMinimapMark[];
  onPinnedRemove?: (id: string) => void;
}

const EMPTY_PINNED_MARKS: readonly PinnedMinimapMark[] = [];

const ConversationMinimap: React.FC<ConversationMinimapProps> = memo(
  ({
    groupHeaders,
    groupMeta,
    groupCounts,
    flatItems,
    activeGroupIndex,
    visibleGroupIndices,
    isAtBottom,
    isScrolling,
    labelVariant = "agent",
    onNavigate,
    pinnedMarks = EMPTY_PINNED_MARKS,
    onPinnedRemove,
  }) => {
    const { t } = useTranslation();
    const tooltipId = useId();
    const pinTooltipId = useId();
    const workstationRailHost = useContext(
      FocusedChatWorkstationMinimapPortalContext
    );
    const [previewGroupIndex, setPreviewGroupIndex] = useState<number | null>(
      null
    );
    const [isPointerOver, setIsPointerOver] = useState(false);
    const [previewPinId, setPreviewPinId] = useState<string | null>(null);
    const pinPreviewCloseTimerRef = useRef<ReturnType<
      typeof setTimeout
    > | null>(null);
    const cancelPinPreviewClose = useCallback(() => {
      if (pinPreviewCloseTimerRef.current === null) return;
      clearTimeout(pinPreviewCloseTimerRef.current);
      pinPreviewCloseTimerRef.current = null;
    }, []);
    const openPinPreview = useCallback(
      (pinId: string) => {
        cancelPinPreviewClose();
        setPreviewPinId(pinId);
      },
      [cancelPinPreviewClose]
    );
    const schedulePinPreviewClose = useCallback(() => {
      cancelPinPreviewClose();
      pinPreviewCloseTimerRef.current = setTimeout(() => {
        pinPreviewCloseTimerRef.current = null;
        setPreviewPinId(null);
      }, PIN_PREVIEW_CLOSE_DELAY_MS);
    }, [cancelPinPreviewClose]);
    useEffect(() => cancelPinPreviewClose, [cancelPinPreviewClose]);
    const navigableGroupIndices = useMemo(
      () =>
        getNavigableConversationGroupIndices(
          groupHeaders,
          groupCounts,
          groupMeta
        ),
      [groupCounts, groupHeaders, groupMeta]
    );
    const markerGroupIndices = useMemo(
      () => sampleConversationGroupIndices(navigableGroupIndices),
      [navigableGroupIndices]
    );
    const assistantPreviews = useMemo(
      () => buildAssistantPreviews(flatItems, groupCounts),
      [flatItems, groupCounts]
    );
    const activeMarkerGroupIndex = resolveActiveConversationMarker(
      markerGroupIndices,
      activeGroupIndex,
      isAtBottom
    );
    const highlightedMarkerGroupIndices = useMemo(
      () =>
        new Set(
          resolveHighlightedConversationMarkers(
            markerGroupIndices,
            visibleGroupIndices,
            activeGroupIndex,
            isAtBottom
          )
        ),
      [activeGroupIndex, isAtBottom, markerGroupIndices, visibleGroupIndices]
    );
    const previewMarkerPosition =
      previewGroupIndex === null
        ? -1
        : navigableGroupIndices.indexOf(previewGroupIndex);
    const previewSampledMarkerIndex =
      previewGroupIndex === null
        ? -1
        : markerGroupIndices.indexOf(previewGroupIndex);
    const previewHeader =
      previewGroupIndex === null ? null : groupHeaders[previewGroupIndex];
    const previewTitle = getUserPreview(previewHeader);
    const previewResponse =
      previewGroupIndex === null
        ? ""
        : (assistantPreviews[previewGroupIndex] ?? "");
    const previewMeta =
      previewGroupIndex === null ? undefined : groupMeta[previewGroupIndex];
    const previewTiming = getTurnTimingLabels(
      previewMeta?.durationMs ?? 0,
      previewMeta?.startMs ?? null,
      previewMeta?.endMs ?? null
    );
    const showTiming =
      previewMeta !== undefined &&
      (previewMeta.durationMs > 0 || previewTiming.showRange);
    const durationLabel = t(
      labelVariant === "agents"
        ? "sessions:tools.turnCollapse.agentsWorkedFor"
        : "sessions:tools.turnCollapse.agentWorkedFor",
      { value: previewTiming.duration }
    );
    const timeRangeLabel = previewTiming.showRange
      ? t("sessions:tools.turnCollapse.timeRange", {
          start: previewTiming.startClock,
          end: previewTiming.endClock,
        })
      : "";
    const previewFallback =
      previewMarkerPosition >= 0
        ? t("common:pagination.round", {
            current: previewMarkerPosition + 1,
          })
        : "";
    const showFloatingMinimap =
      isScrolling ||
      isPointerOver ||
      previewGroupIndex !== null ||
      previewPinId !== null;
    const inWorkstationRail = workstationRailHost !== null;
    const placementClasses =
      getConversationMinimapPlacementClasses(inWorkstationRail);
    const visibilityClass = resolveConversationMinimapVisibilityClass({
      showFloatingMinimap,
      inWorkstationRail,
    });
    // A pinned passage keeps the rail up even in a conversation too short to
    // be worth navigating; the marks are the reason it is there.
    if (markerGroupIndices.length < 2 && pinnedMarks.length === 0) return null;

    const minimap = (
      <nav
        aria-label={t(
          "sessions:chat.conversationNavigator",
          "Conversation navigator"
        )}
        className={`${visibilityClass} ${placementClasses.nav}`}
        onMouseEnter={() => setIsPointerOver(true)}
        onMouseLeave={() => {
          setIsPointerOver(false);
          setPreviewGroupIndex(null);
          schedulePinPreviewClose();
        }}
        onBlur={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            setPreviewGroupIndex(null);
          }
        }}
      >
        {pinnedMarks.map((mark) => (
          <div key={mark.id} className={placementClasses.marker}>
            <Button
              layout="custom"
              aria-describedby={
                previewPinId === mark.id ? pinTooltipId : undefined
              }
              aria-label={t("sessions:chat.goToPinnedPassage", {
                defaultValue: "Go to pinned passage: {{preview}}",
                preview: mark.label,
              })}
              className={placementClasses.markerButton}
              onClick={() => {
                if (mark.groupIndex === null) return;
                onNavigate(mark.groupIndex);
              }}
              onMouseEnter={() => openPinPreview(mark.id)}
              onFocus={() => openPinPreview(mark.id)}
            >
              {/* A mark whose turn is outside the rendered projection cannot
                  navigate, so it reads as present but inert rather than
                  disappearing from the rail. */}
              <span
                className={`${MINIMAP_PIN_MARKER_CLASS} ${
                  mark.groupIndex === null ? "bg-text-3/60" : "bg-text-1"
                }`}
              />
            </Button>

            {previewPinId === mark.id && (
              <div
                className={MINIMAP_PIN_PREVIEW_BRIDGE_CLASS}
                onMouseEnter={cancelPinPreviewClose}
                onMouseLeave={schedulePinPreviewClose}
              >
                <div
                  id={pinTooltipId}
                  role="tooltip"
                  className={`${DROPDOWN_CLASSES.panel} w-56 p-3 text-left @[640px]/chatbody:w-80`}
                >
                  <div className="flex items-start gap-2">
                    <span
                      aria-hidden
                      className="w-0.5 shrink-0 self-stretch rounded-full bg-border-3"
                    />
                    <div className="line-clamp-4 min-w-0 flex-1 text-sm leading-5 text-text-2">
                      {mark.text}
                    </div>
                    {onPinnedRemove && (
                      <Button
                        hoverTone="danger"
                        size="mini"
                        shape="circle"
                        iconOnly
                        className="-mt-1 -mr-1 shrink-0"
                        aria-label={t("sessions:chat.unpinPassage", {
                          defaultValue: "Unpin",
                        })}
                        onClick={() => {
                          cancelPinPreviewClose();
                          setPreviewPinId(null);
                          onPinnedRemove(mark.id);
                        }}
                        icon={
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            data-icon="x"
                            size={12}
                            strokeWidth={2}
                          />
                        }
                      />
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ))}

        {pinnedMarks.length > 0 && markerGroupIndices.length > 0 && (
          <span aria-hidden className={MINIMAP_PIN_DIVIDER_CLASS} />
        )}

        {markerGroupIndices.map((groupIndex, markerIndex) => {
          const turnPosition = navigableGroupIndices.indexOf(groupIndex) + 1;
          const prompt = getUserPreview(groupHeaders[groupIndex]);
          const isActive = groupIndex === activeMarkerGroupIndex;
          const isHighlighted = highlightedMarkerGroupIndices.has(groupIndex);
          const widthClass = getConversationMarkerWidthClass(
            markerIndex,
            previewSampledMarkerIndex
          );
          return (
            <div key={groupIndex} className={placementClasses.marker}>
              <Button
                layout="custom"
                aria-current={isActive ? "step" : undefined}
                aria-describedby={
                  previewGroupIndex === groupIndex ? tooltipId : undefined
                }
                aria-label={t("sessions:chat.goToConversationTurn", {
                  defaultValue:
                    "Go to turn {{current}} of {{total}}: {{preview}}",
                  current: turnPosition,
                  total: navigableGroupIndices.length,
                  preview:
                    prompt ||
                    t("common:pagination.round", { current: turnPosition }),
                })}
                className={placementClasses.markerButton}
                onClick={() => onNavigate(groupIndex)}
                onMouseEnter={() => setPreviewGroupIndex(groupIndex)}
                onFocus={() => setPreviewGroupIndex(groupIndex)}
              >
                {/* Hover/focus is a pointing affordance, not a state the
                    rail is in, so it darkens to text-2 rather than borrowing
                    the accent that marks the turns actually on screen. */}
                <span
                  className={`h-[3px] shrink-0 ${widthClass} transition-[width,background-color] duration-150 motion-reduce:transition-none ${
                    isHighlighted
                      ? "bg-primary-6"
                      : "bg-text-3/40 group-hover:bg-text-2 group-focus-visible:bg-text-2"
                  }`}
                />
              </Button>

              {previewGroupIndex === groupIndex && (
                <div
                  id={tooltipId}
                  role="tooltip"
                  className={`${DROPDOWN_CLASSES.panel} ${CONVERSATION_PREVIEW_POSITION_CLASS} pointer-events-none absolute top-1/2 w-56 -translate-y-1/2 p-3 text-left @[640px]/chatbody:w-80`}
                >
                  <div className="truncate text-sm font-medium text-text-1">
                    {previewTitle || previewFallback}
                  </div>
                  {previewResponse && (
                    <div className="mt-1 line-clamp-3 text-sm leading-5 text-text-3">
                      {previewResponse}
                    </div>
                  )}
                  {showTiming && (
                    <div className="mt-2 grid gap-1 border-t border-border-2/60 pt-2 text-xs text-text-3">
                      <span className="font-medium text-text-2">
                        {durationLabel}
                      </span>
                      {timeRangeLabel && <span>{timeRangeLabel}</span>}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </nav>
    );

    return workstationRailHost
      ? createPortal(minimap, workstationRailHost)
      : minimap;
  }
);

ConversationMinimap.displayName = "ConversationMinimap";

export default ConversationMinimap;
