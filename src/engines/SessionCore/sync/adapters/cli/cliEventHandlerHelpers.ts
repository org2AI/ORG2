/**
 * Stateless helpers shared by the CLI event handler and its per-concern
 * handler modules: raw wire-field readers, turn-intent attribution and the
 * lazily initialized Jotai store lookup.
 */
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import {
  getInstrumentedStore,
  isStoreInitialized,
} from "@src/util/core/state/instrumentedStore";

import type { RawSessionEvent } from "../../types";

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Preserve an exact runner identity without reshaping opaque provider data. */
export function withTurnIntentId(
  event: SessionEvent,
  turnIntentId: string | undefined
): SessionEvent {
  if (
    !turnIntentId ||
    !event.result ||
    typeof event.result !== "object" ||
    Array.isArray(event.result)
  ) {
    return event;
  }
  return {
    ...event,
    result: { ...event.result, turnIntentId },
  };
}

export function getStore() {
  return isStoreInitialized() ? getInstrumentedStore() : null;
}

export function rawString(
  raw: RawSessionEvent,
  key: string
): string | undefined {
  const value = raw[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function rawNumber(raw: RawSessionEvent, key: string): number | null {
  const value = raw[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
