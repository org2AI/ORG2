import { getTurnGeneration, isTurnActive } from "../control/turnLifecycle";
import { loadNativeConversationRevision } from "./nativeConversationRevision";

export interface NativeHistoryLoadRevision {
  revision: string;
  generation: number;
}

/** Bracket an authoritative load; a later probe cannot certify earlier data. */
export async function loadWithNativeHistoryRevision<T>(
  sessionId: string,
  signal: AbortSignal,
  load: () => Promise<T>
): Promise<{ value: T; nativeHistoryRevision?: NativeHistoryLoadRevision }> {
  const generation = getTurnGeneration(sessionId);
  // Revision probing is an optimization. An unavailable probe must not break
  // the initial history load; the normal safety refresh will retry instead.
  const probe = () =>
    loadNativeConversationRevision(sessionId).catch(() => undefined);
  const before = !isTurnActive(sessionId) ? await probe() : undefined;
  const value = await load();
  const after = before && !signal.aborted ? await probe() : undefined;
  const nativeHistoryRevision =
    before &&
    before === after &&
    !signal.aborted &&
    generation === getTurnGeneration(sessionId) &&
    !isTurnActive(sessionId)
      ? { revision: before, generation }
      : undefined;
  return { value, nativeHistoryRevision };
}
