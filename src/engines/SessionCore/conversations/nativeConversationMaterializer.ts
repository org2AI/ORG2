/**
 * Provider-native materialization of a canonical conversation.
 *
 * This module owns the Tauri boundary: bounds preflight, target support, and
 * the materialize/synchronize round trips with their verification. Item
 * projection, identity, semantics and reconciliation live in sibling modules
 * and are re-exported here so this path stays the public entry point.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { loadAuthoritativeSessionEvents } from "@src/engines/SessionCore/sync/authoritativeSessionEvents";
import { invokeTauri } from "@src/util/platform/tauri/init";
import { isCliSession } from "@src/util/session/sessionDispatch";

import {
  type LocalConversationTarget,
  NATIVE_CONVERSATION_CLI_TARGETS,
  type NativeConversationCliTarget,
} from "./conversationTypes";
import {
  MAX_NATIVE_CONVERSATION_ITEMS,
  MAX_NATIVE_CONVERSATION_SERIALIZED_BYTES,
  type NativeConversationItem,
  type NativeMaterializationReceipt,
  type NativeMaterializationWireReceipt,
} from "./nativeConversationItemTypes";
import {
  projectNativeConversation,
  projectNativeConversationItems,
} from "./nativeConversationProjection";
import {
  nativeConversationItemsAreProviderPortableEqual,
  nativeConversationItemsEqual,
  nativeConversationMismatch,
} from "./nativeConversationSemantics";
import { retryLineageOf } from "./queuedRetryLineage";

export {
  MAX_NATIVE_CONVERSATION_ITEMS,
  MAX_NATIVE_CONVERSATION_SERIALIZED_BYTES,
  type NativeConversationFidelity,
  type NativeMaterializationReceipt,
} from "./nativeConversationItemTypes";
export {
  projectNativeConversation,
  projectNativeConversationItems,
} from "./nativeConversationProjection";
export {
  mergeInterruptedConversationProjection,
  removeKnownNativeConversationEchoes,
} from "./nativeConversationReconciliation";
export {
  nativeConversationEventSemanticKey,
  nativeConversationItemsArePrefix,
  nativeConversationItemsAreProviderPortablePrefix,
  nativeConversationItemsEqual,
} from "./nativeConversationSemantics";
export {
  MAX_PORTABLE_TOOL_CALL_ID_LENGTH,
  NATIVE_SOURCE_EVENT_ID_ARG,
  nativeSourceEventId,
  scopedNativeSourceEventIdOf,
  sourceEventIdOfNativeItem,
} from "./nativeSourceEventIdentity";

/** Mirror Rust's ingress cap before Tauri deserializes a potentially huge Vec. */
export function assertNativeConversationPayloadWithinBounds(
  items: readonly NativeConversationItem[],
  limits: { maxItems?: number; maxBytes?: number } = {}
): number {
  const maxItems = limits.maxItems ?? MAX_NATIVE_CONVERSATION_ITEMS;
  const maxBytes = limits.maxBytes ?? MAX_NATIVE_CONVERSATION_SERIALIZED_BYTES;
  if (items.length > maxItems) {
    throw new Error(
      `native transcript has ${items.length} items; limit is ${maxItems}`
    );
  }
  let bytes = 2; // JSON array brackets.
  const encoder = new TextEncoder();
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    // Rust reserializes serde-defaulted fields while validating. Measure that
    // canonical shape so the TS preflight cannot pass a near-limit payload
    // that Rust rejects only after allocating/deserializing the full Vec.
    const validatedShape =
      item.kind === "message" ? { ...item, turnId: item.turnId ?? null } : item;
    bytes += encoder.encode(JSON.stringify(validatedShape)).length;
    if (index > 0) bytes += 1; // JSON array comma.
    if (bytes > maxBytes) {
      throw new Error(
        `native transcript is ${bytes} bytes; limit is ${maxBytes}`
      );
    }
  }
  return bytes;
}

export function supportsNativeConversationTarget(
  target: Pick<LocalConversationTarget, "cliAgentType">
): boolean {
  return (
    !target.cliAgentType ||
    NATIVE_CONVERSATION_CLI_TARGETS.includes(
      target.cliAgentType as NativeConversationCliTarget
    )
  );
}

export async function materializeNativeConversation(params: {
  sessionId: string;
  timeline: readonly SessionEvent[];
}): Promise<{ events: SessionEvent[]; receipt: NativeMaterializationReceipt }> {
  const { items, fidelity } = projectNativeConversation(params.timeline);
  if (params.timeline.length > 0 && items.length === 0) {
    // The first turn can fail empty and then be explicitly retried. Its
    // proved superseded prompt remains in audit history, but there is no
    // effective prefix to materialize. A lineage marker alone, or genuinely
    // unportable history, is not evidence for bypassing this integrity gate.
    const withoutRetryLineage = params.timeline.filter(
      (event) => retryLineageOf(event) === null
    );
    const supersededAllPortableHistory =
      withoutRetryLineage.length < params.timeline.length &&
      projectNativeConversationItems(withoutRetryLineage).length > 0;
    if (!supersededAllPortableHistory) {
      throw new Error(
        "conversation has no portable native role/tool transcript to materialize"
      );
    }
  }
  // With no history there is nothing to migrate. Leave the fresh target
  // unbound so its normal first send creates the provider-native session.
  if (items.length === 0) {
    return {
      events: [],
      receipt: { nativeSessionId: "", itemCount: 0, fidelity },
    };
  }
  assertNativeConversationPayloadWithinBounds(items);
  const wireReceipt = await invokeTauri<NativeMaterializationWireReceipt>(
    "materialize_native_conversation",
    { sessionId: params.sessionId, items }
  );
  const receipt: NativeMaterializationReceipt = { ...wireReceipt, fidelity };
  try {
    if (receipt.itemCount !== items.length) {
      throw new Error(
        `native materializer wrote ${receipt.itemCount} of ${items.length} items`
      );
    }
    const { events } = await loadAuthoritativeSessionEvents(params.sessionId);
    const roundTripped = projectNativeConversationItems(events);
    if (!nativeConversationItemsEqual(items, roundTripped)) {
      throw new Error(
        `native transcript round-trip verification failed; the target session was not started (${nativeConversationMismatch(items, roundTripped)})`
      );
    }
    return { events, receipt };
  } catch (error) {
    if (isCliSession(params.sessionId)) {
      await invokeTauri("discard_native_conversation_materialization", {
        sessionId: params.sessionId,
        nativeSessionId: receipt.nativeSessionId,
      }).catch(() => undefined);
    }
    throw error;
  }
}

/**
 * Bring an existing execution episode up to the canonical transcript before
 * native resume. The complete structured role/tool history is written into
 * the target provider's own transcript format; no delta is rendered as a
 * user prompt. Only strict semantic-prefix growth is allowed; a branch or
 * rewrite fails visibly rather than mutating or silently omitting native history.
 */
export async function synchronizeNativeConversation(params: {
  sessionId: string;
  timeline: readonly SessionEvent[];
}): Promise<{ events: SessionEvent[]; receipt: NativeMaterializationReceipt }> {
  const { items: complete, fidelity } = projectNativeConversation(
    params.timeline
  );
  assertNativeConversationPayloadWithinBounds(complete);
  const wireReceipt = await invokeTauri<NativeMaterializationWireReceipt>(
    "synchronize_native_conversation",
    {
      sessionId: params.sessionId,
      completeItems: complete,
    }
  );
  const receipt: NativeMaterializationReceipt = { ...wireReceipt, fidelity };
  if (receipt.itemCount !== complete.length) {
    throw new Error(
      `native synchronizer wrote ${receipt.itemCount} of ${complete.length} items`
    );
  }
  const { events } = await loadAuthoritativeSessionEvents(params.sessionId);
  if (
    !nativeConversationItemsAreProviderPortableEqual(
      complete,
      projectNativeConversationItems(events)
    )
  ) {
    throw new Error(
      `native transcript synchronization round-trip verification failed (${nativeConversationMismatch(complete, projectNativeConversationItems(events))})`
    );
  }
  return { events, receipt };
}
