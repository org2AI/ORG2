/**
 * Chat Item Pipeline — Main Processing Function
 *
 * Transforms SessionEvent[] into display-ready OptimizedChatItem[]:
 * - Pre-filters events that won't render content
 * - Deduplicates running/completed tool_call pairs
 * - Groups consecutive read file events
 * - Groups consecutive exploration tool calls
 * - Groups consecutive shell commands, MCP calls, and terminal follow-ups
 * - Collapses runs of background-job waits that no terminal stack absorbed
 * - Groups file edits/deletions with reads performed between them
 * - Stacks consecutive browser actions
 * - Consolidates partial observations
 *
 * @module chatItemPipeline/pipeline
 */
import {
  createActionSummaryGroupId,
  createActivityStackGroupId,
  createReadFileGroupId,
} from "@/src/engines/SessionCore/sync/utils/activityIds";

import { isRetryAuditBoundary } from "@src/engines/SessionCore/conversations/retryAuditBoundary";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import {
  ensureUniqueChunkIds,
  getStableActivityItemId,
} from "./activityIdentity";
import {
  type ActionSummaryCategory,
  getActionSummaryCategory,
  isAwaitOutputEvent,
  isBrowserEvent,
  isCommandGroupActivityEvent,
  isFileModificationEvent,
  isManageTodoEvent,
  isMcpToolEvent,
  isReadFileEvent,
  isTerminalActivityEvent,
  isTerminalCommandEvent,
} from "./classifiers";
import { buildDedupMaps } from "./dedup";
import { willEventRenderContent } from "./filters";
import {
  type ActionSummaryEntry,
  type ChatHistoryStats,
  type ChatItemPipelineOptions,
  DEFAULT_PIPELINE_OPTIONS,
  type OptimizedChatItem,
} from "./types";
import { canConsolidate, mergeObservations } from "./utils";

export { getStableActivityItemId } from "./activityIdentity";

// ============================================
// Error detection helpers (pipeline-local, no blocks dependency)
// ============================================

function getErrorText(result: Record<string, unknown>): string | null {
  if (result.error && typeof result.error === "string") return result.error;
  if (result.error_message && typeof result.error_message === "string")
    return result.error_message;
  const text =
    typeof result.content === "string"
      ? result.content
      : typeof result.observation === "string"
        ? result.observation
        : null;
  // Only match explicit "error:" prefix (with colon), not bare "error " which
  // appears in success messages like "error: 0 issues found".
  if (text && /^error:/i.test(text)) return text;
  return null;
}

function isFailedToolCall(event: SessionEvent): boolean {
  if (event.actionType !== "tool_call") return false;
  const result = event.result;
  if (!result) return false;
  if (result.success === false || result.is_error === true) return true;
  if (result.error || result.error_message) return true;
  return getErrorText(result) !== null;
}

// ============================================
// Main Pipeline Function
// ============================================

function isDiffProjectionEvent(event: SessionEvent): boolean {
  const canonical = event.uiCanonical || event.functionName;
  if (
    canonical === "edit_file" ||
    canonical === "edit_file_by_replace" ||
    canonical === "delete_file" ||
    canonical === "apply_patch"
  ) {
    return true;
  }

  const action = event.args?.action;
  return (
    (canonical === "git" || canonical === "git_diff") &&
    typeof action === "string" &&
    action.toLowerCase().includes("diff")
  );
}

function shouldSkipEvent(
  event: SessionEvent,
  policy: ChatItemPipelineOptions["skipPolicy"]
): boolean {
  if (policy === "none" || policy === undefined) return false;
  if (policy === "diff") return isDiffProjectionEvent(event);
  return false;
}

/**
 * Process SessionEvent[] into display-ready OptimizedChatItem[].
 */
export function processChatItems(
  events: SessionEvent[],
  options: ChatItemPipelineOptions = {}
): { items: OptimizedChatItem[]; stats: ChatHistoryStats } {
  const opts = { ...DEFAULT_PIPELINE_OPTIONS, ...options };
  const result: OptimizedChatItem[] = [];

  const stats: ChatHistoryStats = {
    totalActivities: 0,
    successCount: 0,
    failedCount: 0,
    pendingCount: 0,
  };

  const updateVisibleStatusCount = (event: SessionEvent, delta: 1 | -1) => {
    if (event.id === "loading") return;
    if (event.result?.success === true) {
      stats.successCount += delta;
    } else if (event.result?.success === false) {
      stats.failedCount += delta;
    } else {
      stats.pendingCount += delta;
    }
  };

  let readFileBuffer: SessionEvent[] = [];
  let actionSummaryBuffer: {
    category: ActionSummaryCategory;
    event: SessionEvent;
  }[] = [];
  let browserBuffer: SessionEvent[] = [];
  let terminalBuffer: SessionEvent[] = [];
  let editBuffer: SessionEvent[] = [];
  let partialBuffer: { event: SessionEvent; item: OptimizedChatItem }[] = [];

  // ------------------------------------------
  // Helper: create a simple activity OptimizedChatItem from an event
  // ------------------------------------------
  const eventToItem = (event: SessionEvent): OptimizedChatItem => ({
    chunk_id: getStableActivityItemId(event),
    type: "activity",
    event,
  });

  // ------------------------------------------
  // Buffer flush functions
  // ------------------------------------------

  const flushReadFileBuffer = () => {
    if (readFileBuffer.length === 0) return;

    if (
      opts.groupReadFileActivities &&
      readFileBuffer.length >= (opts.minReadFilesToGroup || 2)
    ) {
      const firstRead = readFileBuffer[0];
      result.push({
        chunk_id: createReadFileGroupId(getStableActivityItemId(firstRead)),
        type: "readFileGroup",
        readFileEvents: [...readFileBuffer],
      });
    } else {
      readFileBuffer.forEach((event) => {
        result.push(eventToItem(event));
      });
    }
    readFileBuffer = [];
  };

  const flushActionSummaryBuffer = (closedByBoundary = true) => {
    if (actionSummaryBuffer.length === 0) return;

    const minToGroup = opts.minActionSummaryToGroup || 2;
    if (opts.groupActionSummaries && actionSummaryBuffer.length >= minToGroup) {
      const entriesByCategory = new Map<
        ActionSummaryCategory,
        SessionEvent[]
      >();
      for (const { category, event } of actionSummaryBuffer) {
        const existing = entriesByCategory.get(category);
        if (existing) {
          existing.push(event);
        } else {
          entriesByCategory.set(category, [event]);
        }
      }

      const entries: ActionSummaryEntry[] = [];
      for (const [category, evts] of entriesByCategory) {
        entries.push({ category, events: evts });
      }

      const firstEvent = actionSummaryBuffer[0].event;
      result.push({
        chunk_id: createActionSummaryGroupId(
          getStableActivityItemId(firstEvent)
        ),
        type: "actionSummaryGroup",
        actionSummaryEntries: entries,
        actionSummaryItems: [...actionSummaryBuffer],
        actionSummaryClosedByBoundary: closedByBoundary,
      });
    } else {
      for (const { event } of actionSummaryBuffer) {
        result.push(eventToItem(event));
      }
    }
    actionSummaryBuffer = [];
  };

  const flushBrowserBuffer = () => {
    if (browserBuffer.length === 0) return;

    if (opts.stackBrowserActions) {
      const firstBrowser = browserBuffer[0];
      result.push({
        chunk_id: createActivityStackGroupId("browser", firstBrowser.id),
        type: "activityStackGroup",
        activityStackGroup: {
          category: "browser",
          events: [...browserBuffer],
        },
      });
    } else {
      browserBuffer.forEach((event) => {
        result.push(eventToItem(event));
      });
    }
    browserBuffer = [];
  };

  const flushTerminalBuffer = (closedByBoundary = true) => {
    if (terminalBuffer.length === 0) return;

    const minToGroup = opts.minTerminalActivitiesToGroup ?? 1;
    const hasGroupAnchor = terminalBuffer.some(
      (event) => isTerminalCommandEvent(event) || isMcpToolEvent(event)
    );
    if (
      opts.groupTerminalActivities &&
      terminalBuffer.length >= minToGroup &&
      hasGroupAnchor
    ) {
      const firstTerminal = terminalBuffer[0];
      result.push({
        chunk_id: createActivityStackGroupId(
          "terminal",
          getStableActivityItemId(firstTerminal)
        ),
        type: "activityStackGroup",
        activityStackGroup: {
          category: "terminal",
          events: [...terminalBuffer],
          closedByBoundary,
        },
      });
    } else {
      terminalBuffer.forEach((event) => {
        if (event.id !== "loading") {
          if (event.result?.success === true) {
            stats.successCount++;
          } else if (event.result?.success === false) {
            stats.failedCount++;
          } else {
            stats.pendingCount++;
          }
        }
        result.push(eventToItem(event));
      });
    }
    terminalBuffer = [];
  };

  const flushEditBuffer = (closedByBoundary = true) => {
    if (editBuffer.length === 0) return;

    const minToGroup = opts.minEditActivitiesToGroup ?? 1;
    const hasModification = editBuffer.some(isFileModificationEvent);
    if (
      opts.groupEditActivities &&
      editBuffer.length >= minToGroup &&
      hasModification
    ) {
      const firstEditActivity = editBuffer[0];
      result.push({
        chunk_id: createActivityStackGroupId(
          "edit",
          getStableActivityItemId(firstEditActivity)
        ),
        type: "activityStackGroup",
        activityStackGroup: {
          category: "edit",
          events: [...editBuffer],
          closedByBoundary,
        },
      });
    } else {
      editBuffer.forEach((event) => result.push(eventToItem(event)));
    }
    editBuffer = [];
  };

  const flushPartialBuffer = () => {
    if (partialBuffer.length === 0) return;

    if (opts.consolidatePartialObservations && partialBuffer.length > 1) {
      const bufferEvents = partialBuffer.map((entry) => entry.event);
      const mergedObservation = mergeObservations(bufferEvents);
      const firstEvent = bufferEvents[0];

      result.push({
        ...partialBuffer[0].item,
        event: {
          ...firstEvent,
          result: {
            ...firstEvent.result,
            observation: mergedObservation,
          },
        },
        consolidatedParts: partialBuffer.length,
      });
    } else {
      result.push(...partialBuffer.map((entry) => entry.item));
    }
    partialBuffer = [];
  };

  const flushAllBuffers = () => {
    flushActionSummaryBuffer();
    flushReadFileBuffer();
    flushBrowserBuffer();
    flushTerminalBuffer();
    flushEditBuffer();
    flushPartialBuffer();
  };

  // A wait lands as its own row when no terminal stack absorbs it: a provider
  // poll with no command row beside it, or a subagent wait. Adjacent rows of
  // that kind collapse into one wait stack. A run that ends the list is still
  // live, so it stays open like a trailing terminal stack.
  const groupStandaloneWaits = (
    items: OptimizedChatItem[]
  ): OptimizedChatItem[] => {
    if (!opts.groupWaitActivities) return items;

    const minToGroup = opts.minWaitActivitiesToGroup ?? 2;
    const grouped: OptimizedChatItem[] = [];
    let run: { item: OptimizedChatItem; event: SessionEvent }[] = [];
    const flushRun = (closedByBoundary: boolean) => {
      if (run.length > 0 && run.length >= minToGroup) {
        const waitEvents = run.map(({ event }) => event);
        waitEvents.forEach((event) => updateVisibleStatusCount(event, -1));
        grouped.push({
          chunk_id: createActivityStackGroupId(
            "wait",
            getStableActivityItemId(waitEvents[0])
          ),
          type: "activityStackGroup",
          activityStackGroup: {
            category: "wait",
            events: waitEvents,
            closedByBoundary,
          },
        });
      } else {
        grouped.push(...run.map(({ item }) => item));
      }
      run = [];
    };

    for (const item of items) {
      if (
        item.type === "activity" &&
        item.event &&
        isAwaitOutputEvent(item.event)
      ) {
        run.push({ item, event: item.event });
        continue;
      }
      flushRun(true);
      grouped.push(item);
    }
    flushRun(false);
    return grouped;
  };

  // ------------------------------------------
  // Pre-pass: dedup running tool_call chunks + assistant messages
  // ------------------------------------------
  const {
    runningChunksToSkip,
    runningArgsMap,
    duplicateAssistantIds,
    duplicateUserIds,
    duplicateDeliveryFailureIds,
  } = buildDedupMaps(events);

  // ------------------------------------------
  // Main processing loop
  // ------------------------------------------
  let sawManageTodo = false;

  for (let index = 0; index < events.length; index++) {
    let event = events[index];

    if (
      runningChunksToSkip.has(event.id) ||
      duplicateAssistantIds.has(event.id) ||
      duplicateUserIds.has(event.id) ||
      duplicateDeliveryFailureIds.has(event.id)
    ) {
      continue;
    }

    if (isRetryAuditBoundary(event)) {
      flushAllBuffers();
      result.push(eventToItem(event));
      continue;
    }

    // Initial hydration may inject one synthetic placeholder event. Keep it
    // standalone so ActivityRouter can render the shared loading block instead
    // of letting tool classification fold it into an activity group.
    if (event.id === "loading") {
      flushAllBuffers();
      result.push(eventToItem(event));
      continue;
    }

    // Merge args from running event into result events with empty args
    if (
      event.actionType === "tool_call" &&
      (!event.args || Object.keys(event.args).length === 0)
    ) {
      const resultCallId =
        event.callId ||
        (event as { call_id?: string }).call_id ||
        (event.result?.call_id as string | undefined);
      if (resultCallId) {
        const runningArgs = runningArgsMap.get(resultCallId);
        if (runningArgs) {
          event = {
            ...event,
            args: { ...runningArgs },
          };
        }
      }
    }

    // Pre-filter: Skip events that won't render any content
    if (opts.preFilterEmptyActivities) {
      if (!willEventRenderContent(event)) {
        continue;
      }
    }

    // Serializable caller-selected exclusion policy (for example, Diff owns
    // file-mutation cards on surfaces where inline diff rows are hidden).
    if (shouldSkipEvent(event, opts.skipPolicy)) {
      continue;
    }

    // Filter out manage_todo events and the plan-detail assistant_message that follows
    if (opts.filterManageTodo) {
      if (isManageTodoEvent(event)) {
        sawManageTodo = true;
        continue;
      }
      if (
        sawManageTodo &&
        event.actionType === "assistant" &&
        event.functionName === "assistant_message"
      ) {
        sawManageTodo = false;
        continue;
      }
      sawManageTodo = false;
    }

    // Count total activities once per surviving raw event — independent of
    // whether the event later lands in the result as its own item, gets
    // folded into a buffer (action-summary / read-file / browser-stack /
    // partial-observation), or gets folded into a repeated-error sibling.
    // success/failed/pending counts stay tied to result-array entries
    // below so they remain consistent with what users actually see.
    if (event.id !== "loading") {
      stats.totalActivities++;
    }

    // Buffer: file edits/deletions plus reads that occur after the first
    // modification. Earlier reads remain part of Explore; a file modification
    // anchors every group regardless of whether it succeeded or failed.
    const isFileModification = isFileModificationEvent(event);
    const isSuccessfulReadWithinEditGroup =
      editBuffer.length > 0 &&
      isReadFileEvent(event) &&
      !isFailedToolCall(event);
    if (
      opts.groupEditActivities &&
      (isFileModification || isSuccessfulReadWithinEditGroup)
    ) {
      flushActionSummaryBuffer();
      flushReadFileBuffer();
      flushBrowserBuffer();
      flushTerminalBuffer();
      flushPartialBuffer();
      editBuffer.push(event);
      continue;
    } else {
      flushEditBuffer();
    }

    // Buffer: action summary (exploration tool calls: read, search, glob, list)
    if (opts.groupActionSummaries) {
      const summaryCategory = getActionSummaryCategory(event);
      if (summaryCategory) {
        flushBrowserBuffer();
        flushTerminalBuffer();
        flushPartialBuffer();
        flushReadFileBuffer();
        actionSummaryBuffer.push({ category: summaryCategory, event });
        continue;
      } else {
        flushActionSummaryBuffer();
      }
    }

    // Buffer: read file events (only when action summaries are disabled)
    if (!opts.groupActionSummaries && isReadFileEvent(event)) {
      flushBrowserBuffer();
      flushTerminalBuffer();
      flushPartialBuffer();
      readFileBuffer.push(event);
      continue;
    } else if (!opts.groupActionSummaries) {
      flushReadFileBuffer();
    }

    // Buffer: consecutive shell commands, MCP calls, and terminal
    // wait/monitor/inspect follow-ups, including failures. Keep terminal error
    // details inside the stack; non-terminal MCP failures remain standalone.
    if (
      opts.groupTerminalActivities &&
      isCommandGroupActivityEvent(event) &&
      (isTerminalActivityEvent(event) || !isFailedToolCall(event))
    ) {
      flushBrowserBuffer();
      flushPartialBuffer();
      terminalBuffer.push(event);
      continue;
    } else {
      flushTerminalBuffer();
    }

    // Buffer: browser actions
    if (isBrowserEvent(event)) {
      flushPartialBuffer();
      browserBuffer.push(event);
      continue;
    } else {
      flushBrowserBuffer();
    }

    // Buffer: partial observations
    const obsPart = event.args?.observation_part as string;
    if (obsPart && opts.consolidatePartialObservations) {
      const lastPartial = partialBuffer[partialBuffer.length - 1];
      const lastEvent = lastPartial?.event;

      const item = eventToItem(event);
      if (lastEvent && canConsolidate(lastEvent, event)) {
        partialBuffer.push({ event, item });
        continue;
      } else {
        flushPartialBuffer();
        partialBuffer.push({ event, item });
        continue;
      }
    } else {
      flushPartialBuffer();
    }

    // Regular event — flush all buffers and add as activity
    flushAllBuffers();

    // A todo event contains the complete checklist snapshot. Consecutive
    // updates therefore supersede each other; rendering every intermediate
    // snapshot produces near-identical cards (for example pending `content`
    // immediately followed by in-progress `activeForm`). Keep only the last
    // snapshot in a contiguous run. Any real activity between updates remains
    // a boundary, so progress history around edits/commands is preserved.
    if (isManageTodoEvent(event)) {
      const last = result[result.length - 1];
      if (
        last?.type === "activity" &&
        last.event &&
        isManageTodoEvent(last.event)
      ) {
        updateVisibleStatusCount(last.event, -1);
        updateVisibleStatusCount(event, 1);
        result[result.length - 1] = eventToItem(event);
        continue;
      }
    }

    // Count success / failed / pending only for events that actually land
    // in the result array as their own item. Folded error duplicates
    // (handled above via continue) are excluded so these counts stay
    // consistent with result.length-of-this-kind. (totalActivities was
    // bumped earlier — it tracks raw events including buffered ones.)
    updateVisibleStatusCount(event, 1);

    result.push(eventToItem(event));
  }

  // Flush remaining buffers. Trailing exploration, terminal, and edit buffers
  // are still active, so keep their stacks expanded until a later event closes them.
  flushActionSummaryBuffer(false);
  flushReadFileBuffer();
  flushBrowserBuffer();
  flushTerminalBuffer(false);
  flushEditBuffer(false);
  flushPartialBuffer();

  return { items: ensureUniqueChunkIds(groupStandaloneWaits(result)), stats };
}
