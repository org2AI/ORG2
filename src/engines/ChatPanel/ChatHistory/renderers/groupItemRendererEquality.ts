import {
  LLM_USAGE_ARGS_KEY,
  TOOL_USAGE_ARGS_KEY,
} from "@src/engines/SessionCore/core/types";

import type { OptimizedChatItem } from "../chatItemPipeline/types";
import type { GroupItemRendererProps } from "./groupItemRendererTypes";

// ============================================
// Custom props equality for memo()
// ============================================

type EventSummary = NonNullable<OptimizedChatItem["event"]>;

const RESULT_RENDER_KEYS = [
  "type",
  "message",
  "content",
  "observation",
  "success",
  "failure",
  "error",
  "images",
  "call_id",
  "output",
  "stdout",
  "stderr",
  "interleaved_output",
  "interleavedOutput",
  "diff",
  "diffString",
  "segments",
  "filePaths",
  "linesAdded",
  "linesRemoved",
  "status",
  // Keep retry actions current even when the visible message body is unchanged.
  "queueMessageId",
  "deliveryOwnerRetired",
  "deliveryStatus",
  "deliveryError",
  "turnIntentId",
  "syntheticUserInput",
] as const;

const ARG_RENDER_KEYS = [
  "command",
  "streamOutput",
  "streamContent",
  "title",
  "action",
  "content",
  "path",
  "file_path",
  "target_file",
  "patch_text",
  "old_str",
  "old_string",
  "old_content",
  "new_str",
  "new_string",
  "new_content",
  "subagentSessionId",
  TOOL_USAGE_ARGS_KEY,
  LLM_USAGE_ARGS_KEY,
] as const;

function sameRecordKeys(
  left: Record<string, unknown> | undefined,
  right: Record<string, unknown> | undefined,
  keys: readonly string[]
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return keys.every((key) => left[key] === right[key]);
}

function sameEventSummary(
  left: EventSummary | undefined,
  right: EventSummary | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.id === right.id &&
    left.actionType === right.actionType &&
    left.functionName === right.functionName &&
    left.uiCanonical === right.uiCanonical &&
    left.displayText === right.displayText &&
    left.displayStatus === right.displayStatus &&
    left.displayVariant === right.displayVariant &&
    left.activityStatus === right.activityStatus &&
    left.shellPid === right.shellPid &&
    left.shellProcessStatus === right.shellProcessStatus &&
    left.shellExitCode === right.shellExitCode &&
    left.shellLogPath === right.shellLogPath &&
    left.extracted === right.extracted &&
    left.payloadRefs === right.payloadRefs &&
    sameRecordKeys(left.result, right.result, RESULT_RENDER_KEYS) &&
    sameRecordKeys(left.args, right.args, ARG_RENDER_KEYS)
  );
}

function sameEventList(
  left: readonly EventSummary[] | undefined,
  right: readonly EventSummary[] | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  if (left.length !== right.length) return false;
  return left.every((leftEvent, i) => sameEventSummary(leftEvent, right[i]));
}

function sameChatItem(
  left: OptimizedChatItem | undefined,
  right: OptimizedChatItem | undefined
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.chunk_id === right.chunk_id &&
    left.type === right.type &&
    left.structuralOnly === right.structuralOnly &&
    (left.outputImages === right.outputImages ||
      (left.outputImages?.length === right.outputImages?.length &&
        (left.outputImages ?? []).every(
          (image, index) => image === right.outputImages?.[index]
        ))) &&
    left.consolidatedParts === right.consolidatedParts &&
    left.actionSummaryClosedByBoundary ===
      right.actionSummaryClosedByBoundary &&
    left.activityStackGroup?.category === right.activityStackGroup?.category &&
    left.activityStackGroup?.closedByBoundary ===
      right.activityStackGroup?.closedByBoundary &&
    sameEventSummary(left.event, right.event) &&
    sameEventList(left.readFileEvents, right.readFileEvents) &&
    sameEventList(
      left.activityStackGroup?.events,
      right.activityStackGroup?.events
    ) &&
    sameEventList(
      left.actionSummaryItems?.map((item) => item.event),
      right.actionSummaryItems?.map((item) => item.event)
    )
  );
}

export function areGroupItemRendererPropsEqual(
  previous: GroupItemRendererProps,
  next: GroupItemRendererProps
): boolean {
  return (
    previous.flatIndex === next.flatIndex &&
    previous.groupIndex === next.groupIndex &&
    previous.turnId === next.turnId &&
    sameChatItem(previous.chatItem, next.chatItem) &&
    // previousChatItem affects group-chat continuation window only (createdAt
    // comparison). Shallow-compare the event rather than the full item — the
    // continuation check only reads event.createdAt, source, and senderName.
    previous.previousChatItem?.event === next.previousChatItem?.event &&
    previous.isLastItemInGroup === next.isLastItemInGroup &&
    previous.isLastGroup === next.isLastGroup &&
    previous.isWpGeneWorking === next.isWpGeneWorking &&
    previous.onRegenerate === next.onRegenerate &&
    previous.onEditUserMessage === next.onEditUserMessage &&
    previous.newEventDividerLabel === next.newEventDividerLabel
  );
}
