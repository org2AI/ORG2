/**
 * Stable identities carried across native materialization: globally scoped
 * source event ids, portable tool-call ids and the reverse mapping from a
 * native item back to its canonical source event.
 */
import { v5 as uuidv5 } from "uuid";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";

import type { NativeConversationItem } from "./nativeConversationItemTypes";

/** OpenAI's strictest current tool-call identifier envelope. */
export const MAX_PORTABLE_TOOL_CALL_ID_LENGTH = 64;
const PORTABLE_TOOL_CALL_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const PORTABLE_TOOL_CALL_NAMESPACE = "9e7db8a3-94bf-5c58-9416-a244ba6e30d3";

/**
 * Native providers commonly reuse positional ids (for example `codex-asst-7`)
 * in every session. Scope legacy ids once, then carry that canonical identity
 * through every subsequent native materialization and parse.
 */
const NATIVE_SOURCE_EVENT_ID_NAMESPACE = "45de8858-d25d-51df-a7cf-c7dedcb6d0f1";
const NATIVE_SOURCE_EVENT_ID_PREFIX = "orgii_evt_";

/** Original event identity carried by synthesized/replayed projections. */
export const NATIVE_SOURCE_EVENT_ID_ARG = "__orgiiSourceEventId";

/**
 * Return an identity that has already crossed ORG2's global native boundary.
 * Raw provider-local ids in the same field are deliberately not canonical:
 * they still need session scoping in `nativeSourceEventId`.
 */
export function scopedNativeSourceEventIdOf(
  event: SessionEvent
): string | null {
  const sourceId = event.args?.[NATIVE_SOURCE_EVENT_ID_ARG];
  if (
    typeof sourceId === "string" &&
    sourceId.startsWith(NATIVE_SOURCE_EVENT_ID_PREFIX)
  ) {
    return sourceId;
  }
  return event.id.startsWith(NATIVE_SOURCE_EVENT_ID_PREFIX) ? event.id : null;
}

export function nativeSourceEventId(event: SessionEvent): string {
  // A materialized child created by current writers already carries the
  // globally scoped root identity. Older writers and ordinary provider rows
  // can expose only a provider-local positional id (for example
  // `codex-asst-97`) in this field. That metadata can even point at a later
  // genuine row in the same native Session, so it is not an identity boundary.
  // Ignore every unscoped source hint and scope the row's own provider id;
  // every later materialization carries the resulting `orgii_evt_*` id
  // verbatim.
  const scopedSourceId = scopedNativeSourceEventIdOf(event);
  if (scopedSourceId) return scopedSourceId;
  return `${NATIVE_SOURCE_EVENT_ID_PREFIX}${uuidv5(
    `${event.sessionId}\0${event.id}`,
    NATIVE_SOURCE_EVENT_ID_NAMESPACE
  ).replace(/-/g, "")}`;
}

export function portableToolCallId(event: SessionEvent): string {
  const sourceId = event.callId?.trim();
  if (
    sourceId &&
    sourceId.length <= MAX_PORTABLE_TOOL_CALL_ID_LENGTH &&
    PORTABLE_TOOL_CALL_ID_PATTERN.test(sourceId)
  ) {
    return sourceId;
  }

  // Provider-native call IDs are pairing keys, not user-visible content. A
  // stable UUID keeps the call/result relation exact while fitting the
  // strictest supported provider instead of leaking namespaced event IDs.
  const identity = sourceId || event.id;
  return `call_${uuidv5(identity, PORTABLE_TOOL_CALL_NAMESPACE).replace(
    /-/g,
    ""
  )}`;
}

export function sourceEventIdOfNativeItem(
  item: NativeConversationItem
): string {
  return item.kind === "message"
    ? item.id
    : item.id.replace(/:(?:call|result)$/, "");
}
