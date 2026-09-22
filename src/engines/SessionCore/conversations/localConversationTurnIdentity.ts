/**
 * Identity of one user turn inside a canonical conversation: the private
 * turn-intent id carried on lifecycle events, and the provider-visible request
 * payload used to re-anchor a turn when a native transcript cannot carry it.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { turnIntentIdOf } from "@src/engines/SessionCore/sync/utils/activityIds";

export const CONVERSATION_TURN_ID_ARG = "conversationTurnId";

export function conversationTurnIdOf(event: SessionEvent): string | null {
  const turnIntentId = turnIntentIdOf(event);
  if (turnIntentId) return turnIntentId;
  const value = event.args?.[CONVERSATION_TURN_ID_ARG];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export interface ProviderRequestIdentity {
  text: string;
  images: readonly string[];
}

function normalizeProviderRequestText(value: string): string {
  // Native stores can normalize platform line endings while preserving the
  // message byte-for-byte otherwise. Do not trim or use suffix matching:
  // whitespace and provider context wrappers are part of the real payload.
  return value.replace(/\r\n?/g, "\n");
}

function sameProviderImages(
  left: readonly string[],
  right: readonly string[]
): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

export function nativeUserMessageMatchesRequest(
  item: {
    text: string;
    images: readonly string[];
  },
  expected: ProviderRequestIdentity
): boolean {
  return (
    normalizeProviderRequestText(item.text) ===
      normalizeProviderRequestText(expected.text) &&
    sameProviderImages(item.images, expected.images)
  );
}
