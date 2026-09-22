import { useAtomValue } from "jotai";
import React, { useMemo } from "react";

import { resolveConversationViewerState } from "@src/engines/SessionCore/conversations/conversationSenderMetadata";
import { conversationRootKey } from "@src/engines/SessionCore/conversations/conversationTypes";
import { sessionIdAtom } from "@src/engines/SessionCore/core/atoms/metadata";
import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import { chatEventsForSessionAtomFamily } from "@src/engines/SessionCore/derived/sessionScopedChatEvents";
import { useSessionCommentsContext } from "@src/features/Org2Cloud/SessionComments/SessionCommentsContext";
import { mergeConversationEvents } from "@src/features/Org2Cloud/SessionConversation/discussionEvents";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { sessionByIdAtom } from "@src/store/session";

import { ChatHistoryOverrideContext } from "./ChatHistoryOverrideContext";
import { MemberEventsTap } from "./ConversationStreamProvider/MemberEventsTap";
import {
  assembleConversationWithLocalExecution,
  localExecutionRootForSession,
} from "./ConversationStreamProvider/localExecutionHydration";
import { useConversationActiveRunners } from "./ConversationStreamProvider/useConversationActiveRunners";
import {
  useMemberEventsByBareId,
  useRunnerOverlayById,
} from "./ConversationStreamProvider/useConversationEventTaps";
import { useConversationFamilyTimeline } from "./ConversationStreamProvider/useConversationFamilyTimeline";
import { useLocalExecutionTails } from "./ConversationStreamProvider/useLocalExecutionTails";

export {
  conversationActiveDeliveriesAtom,
  selectConversationActiveDeliveries,
  selectConversationActiveRunners,
} from "./ConversationStreamProvider/conversationActiveDeliveries";
export {
  assembleConversationWithLocalExecution,
  createLocalExecutionHydrationCoordinator,
  hydrateLocalExecutionSnapshot,
  localExecutionRootForSession,
  projectVisibleLocalExecutionTail,
  shouldHydrateLocalExecutionSnapshot,
} from "./ConversationStreamProvider/localExecutionHydration";

const EMPTY_DISCUSSION_COMMENTS = [] as const;

interface ConversationStreamProviderProps {
  sessionId: string;
  /** Pre-merged group-chat stream; takes precedence over conversation merging. */
  overrideEvents: SessionEvent[] | undefined;
  children: (activeRunnerSessionId: string | null) => React.ReactNode;
}

export function resolveConversationRunnerBindings(
  sourceSessionId: string,
  activeRunnerSessionId: string | null
): {
  sourceSessionId: string;
  controlSessionId: string | null;
  planningIndicatorScope: { sessionId: string; isLive: true } | null;
} {
  return {
    sourceSessionId,
    controlSessionId: activeRunnerSessionId,
    planningIndicatorScope: activeRunnerSessionId
      ? { sessionId: activeRunnerSessionId, isLive: true }
      : null,
  };
}

/** The primary SessionSync surface already ingests its own live channel. */
export function shouldIngestConversationRunnerLiveEvents(
  runnerSessionId: string,
  pipelineSessionId: string | null
): boolean {
  return runnerSessionId !== pipelineSessionId;
}

/**
 * Feeds ChatHistory the conversation stream: pre-plane compatibility
 * segments plus the canonical Cloud plane and discussion rows. Post-plane
 * execution episodes are not subscribed as additional transcript owners.
 * Must render inside `SessionCommentsProvider`.
 */
export function ConversationStreamProvider({
  sessionId,
  overrideEvents,
  children,
}: ConversationStreamProviderProps): React.ReactElement {
  const pipelineSessionId = useAtomValue(sessionIdAtom);
  const chatEvents = useAtomValue(
    chatEventsForSessionAtomFamily(pipelineSessionId ?? sessionId)
  );
  const comments = useSessionCommentsContext();
  const currentSession = useAtomValue(sessionByIdAtom(sessionId));
  const auth = useAtomValue(org2CloudAuthAtom);
  const authIdentityKey = auth ? org2CloudAuthIdentityKey(auth) : null;

  const discussionComments = comments?.comments ?? EMPTY_DISCUSSION_COMMENTS;
  const toSourceEventId = comments?.toSourceEventId ?? null;
  const anchorBareSessionId =
    currentSession?.importedFrom?.sourceSessionId ?? sessionId;

  const { target, plane, timelineFamily, memberTaps } =
    useConversationFamilyTimeline({
      sessionId,
      overrideEvents,
      comments,
      currentSession,
      auth,
      authIdentityKey,
      anchorBareSessionId,
    });

  const { eventsByBareId, handleMemberEvents, handleMemberUnmount } =
    useMemberEventsByBareId();
  const viewer = resolveConversationViewerState(
    auth?.userId ?? comments?.viewerUserId ?? null,
    true
  );

  const localRoot = useMemo(
    () =>
      localExecutionRootForSession(
        sessionId,
        currentSession,
        Boolean(overrideEvents)
      ),
    [currentSession, overrideEvents, sessionId]
  );
  const localRootKey = localRoot ? conversationRootKey(localRoot) : null;
  const {
    activeDeliveries,
    activeRunners,
    activeRunnerIds,
    activeRunnerSessionId,
  } = useConversationActiveRunners({
    auth,
    authIdentityKey,
    target,
    localRootKey,
    planeEvents: plane.events,
  });
  const localTails = useLocalExecutionTails({
    sessionId,
    localRoot,
    localRootKey,
    activeDeliveries,
  });
  const { runnerOverlayById, handleRunnerEvents, handleRunnerUnmount } =
    useRunnerOverlayById({ sessionId, activeRunners, activeRunnerIds });

  const value = useMemo((): SessionEvent[] | undefined => {
    if (overrideEvents) return overrideEvents;
    const timeline = assembleConversationWithLocalExecution(
      {
        family: timelineFamily,
        anchorBareSessionId,
        anchorEvents: chatEvents,
        eventsByBareSessionId: eventsByBareId,
        planeEvents: plane.events,
        planeHistoryStartedAt: plane.historyStartedAt,
        comments: discussionComments,
        streamSessionId: sessionId,
        viewer,
        ...(toSourceEventId ? { toSourceEventId } : {}),
      },
      localTails
    );
    // The only UI-only addition is the sender's live runner overlay.
    const synthetic: SessionEvent[] = [];
    // Live runner overlay (sender-local, pre-tail): show the agent working.
    // The canonical optimistic row already owns the visible user message, so
    // the overlay contributes only provider output. Its ids are namespaced and
    // the whole overlay vanishes once the turnId lands on the plane above.
    for (const runner of activeRunners) {
      const overlay = runnerOverlayById.get(runner.runnerSessionId);
      if (overlay?.length) synthetic.push(...overlay);
    }
    if (synthetic.length === 0) {
      return localTails.length > 0 ||
        timelineFamily ||
        plane.events.length > 0 ||
        discussionComments.length > 0
        ? timeline
        : undefined;
    }
    return mergeConversationEvents(timeline, synthetic);
  }, [
    localTails,
    overrideEvents,
    timelineFamily,
    anchorBareSessionId,
    chatEvents,
    eventsByBareId,
    sessionId,
    viewer,
    discussionComments,
    toSourceEventId,
    plane.events,
    plane.historyStartedAt,
    activeRunners,
    runnerOverlayById,
  ]);
  return (
    <>
      {memberTaps.map((tap) => (
        <MemberEventsTap
          key={tap.localSessionId}
          bareSessionId={tap.bareSessionId}
          localSessionId={tap.localSessionId}
          onEvents={handleMemberEvents}
          onUnmount={handleMemberUnmount}
        />
      ))}
      {activeRunners.map((runner) => (
        <MemberEventsTap
          key={`runner-${runner.runnerSessionId}`}
          bareSessionId={runner.runnerSessionId}
          localSessionId={runner.runnerSessionId}
          ingestLive={shouldIngestConversationRunnerLiveEvents(
            runner.runnerSessionId,
            pipelineSessionId
          )}
          onEvents={handleRunnerEvents}
          onUnmount={handleRunnerUnmount}
        />
      ))}
      <ChatHistoryOverrideContext.Provider value={value}>
        {children(activeRunnerSessionId)}
      </ChatHistoryOverrideContext.Provider>
    </>
  );
}
