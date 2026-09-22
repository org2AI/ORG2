import type { ConversationRootLocator } from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  type LocalCanonicalConversationSnapshot,
  type LocalExecutionSegment,
  loadLocalCanonicalConversationSnapshot,
  loadLocalExecutionChildren,
  projectVerifiedLocalExecutionTail,
  suppressLandedQueuedUserRows,
  suppressLandedRowsOfFailedQueuedTurns,
} from "@src/engines/SessionCore/conversations/localConversationExecutionTail";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { derivePlanDisplayEvents } from "@src/engines/SessionCore/derived/planDisplayEvents";
import { isVisibleInChat } from "@src/engines/SessionCore/ingestion/visibilityFilters";
import {
  type CanonicalConversationTimelineInput,
  assembleCanonicalConversationTimeline,
} from "@src/features/Org2Cloud/SessionConversation/canonicalConversationTimeline";
import { mergeConversationEvents } from "@src/features/Org2Cloud/SessionConversation/discussionEvents";
import { createLogger } from "@src/hooks/logger";
import type { Session } from "@src/store/session/sessionAtom/types";

import {
  conversationRootForSession,
  conversationSourceFromImportedHistory,
} from "../hooks/useConversationTargetBinding";

const log = createLogger("ConversationStreamProvider");

interface LatestHydrationRequest<T> {
  generation: number;
  value: T;
}

export interface LocalExecutionHydrationCoordinator<TRequest> {
  request: (request: TRequest) => void;
  invalidate: () => void;
  activate: () => void;
  deactivate: () => void;
}

/**
 * Runs at most one native-history hydration at a time and coalesces bursts to
 * the newest request. Generation checks prevent an old root from committing.
 */
export function createLocalExecutionHydrationCoordinator<TRequest, TResult>(
  hydrate: (request: TRequest) => Promise<TResult>,
  onCurrent: (result: TResult, request: TRequest) => void,
  onError: (error: unknown, request: TRequest) => void
): LocalExecutionHydrationCoordinator<TRequest> {
  let generation = 0;
  let active = true;
  let running = false;
  let pending: LatestHydrationRequest<TRequest> | null = null;

  const drain = async () => {
    while (active && pending) {
      const current = pending;
      pending = null;
      try {
        const result = await hydrate(current.value);
        if (active && current.generation === generation) {
          onCurrent(result, current.value);
        }
      } catch (error) {
        if (active && current.generation === generation) {
          onError(error, current.value);
        }
      }
    }
    running = false;
    // No await occurs between the loop condition and this assignment, but keep
    // the restart guard explicit so future scheduling changes cannot lose work.
    if (active && pending) start();
  };
  const start = () => {
    if (!active || running || !pending) return;
    running = true;
    void drain().catch((error: unknown) => {
      // A projection/error subscriber can throw too. Do not leave the
      // single-flight owner permanently held or lose a newer pending root.
      running = false;
      log.error("local execution hydration callback failed", error);
      if (active && pending) start();
    });
  };

  return {
    request(request) {
      generation += 1;
      pending = { generation, value: request };
      start();
    },
    invalidate() {
      generation += 1;
      pending = null;
    },
    activate() {
      active = true;
      start();
    },
    deactivate() {
      active = false;
      generation += 1;
      pending = null;
    },
  };
}

/** Cloud comments do not replace this device's native execution authority. */
export function localExecutionRootForSession(
  sessionId: string,
  session: Session | undefined,
  hasOverride: boolean
): ConversationRootLocator | null {
  if (hasOverride) return null;
  const imported = conversationSourceFromImportedHistory({
    sessionId,
    session,
  })?.root;
  const root =
    imported ?? (session ? conversationRootForSession(session) : null);
  return root && root.conversationId === sessionId ? root : null;
}

export interface LocalExecutionHydrationRequest {
  root: ConversationRootLocator;
  rootKey: string;
}

export interface LocalExecutionHydrationSnapshot {
  rootKey: string;
  snapshot: LocalCanonicalConversationSnapshot | null;
}

export interface LocalExecutionHydrationTrigger {
  rootKey: string | null;
  activeDeliveryCount: number;
  refreshEpoch?: number;
}

/**
 * Native history is immutable during a queued turn from this projection's
 * perspective: the live runner overlay owns in-flight output. Rehydrate when
 * the root changes or a delivery leaves (its native suffix has settled), not
 * when a delivery starts or the root Session object streams metadata updates.
 */
export function shouldHydrateLocalExecutionSnapshot(
  previous: LocalExecutionHydrationTrigger | null,
  next: LocalExecutionHydrationTrigger
): boolean {
  if (!next.rootKey) return false;
  return (
    previous === null ||
    previous.rootKey !== next.rootKey ||
    next.activeDeliveryCount < previous.activeDeliveryCount ||
    (next.activeDeliveryCount === 0 &&
      next.refreshEpoch !== previous.refreshEpoch)
  );
}

export async function hydrateLocalExecutionSnapshot(
  request: LocalExecutionHydrationRequest
): Promise<LocalExecutionHydrationSnapshot> {
  return {
    rootKey: request.rootKey,
    // The root is already owned by SessionSync. A conversation with no
    // execution children has no suffix to verify or merge; do not retain a
    // second complete native root just to compute an empty tail.
    snapshot:
      (await loadLocalExecutionChildren(request.root)).length > 0
        ? await loadLocalCanonicalConversationSnapshot(request.root)
        : null,
  };
}

/** Verify against raw native history, then run the ordinary chat projection. */
export function projectVisibleLocalExecutionTail(
  authoritativeRootEvents: readonly SessionEvent[],
  segments: readonly LocalExecutionSegment[],
  canonicalSessionId: string
): SessionEvent[] {
  return derivePlanDisplayEvents(
    projectVerifiedLocalExecutionTail(
      authoritativeRootEvents,
      segments,
      canonicalSessionId
    ).filter(isVisibleInChat)
  );
}

/** Native tails enter the canonical merge before cloud plane identity matching. */
export function assembleConversationWithLocalExecution(
  input: CanonicalConversationTimelineInput,
  tails: readonly SessionEvent[]
): SessionEvent[] {
  return assembleCanonicalConversationTimeline({
    ...input,
    anchorEvents: tails.length
      ? mergeConversationEvents(
          suppressLandedQueuedUserRows(input.anchorEvents, tails),
          suppressLandedRowsOfFailedQueuedTurns(input.anchorEvents, tails)
        )
      : input.anchorEvents,
  });
}
