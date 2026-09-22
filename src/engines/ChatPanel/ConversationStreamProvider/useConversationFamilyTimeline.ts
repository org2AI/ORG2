import { useAtomValue } from "jotai";
import { useMemo } from "react";

import type { SessionEvent } from "@src/engines/SessionCore/core/types";
import type { SessionCommentsContextValue } from "@src/features/Org2Cloud/SessionComments/SessionCommentsContext";
import { legacyConversationFamilyForTimeline } from "@src/features/Org2Cloud/SessionConversation/canonicalConversationTimeline";
import {
  type ConversationFamilyMember,
  resolveConversationFamily,
} from "@src/features/Org2Cloud/SessionConversation/continuationEvents";
import { useConversationPlaneEvents } from "@src/features/Org2Cloud/SessionConversation/conversationPlaneAtom";
import { useEnsureFamilyLoaded } from "@src/features/Org2Cloud/SessionConversation/useEnsureFamilyLoaded";
import { useMarkDiscussionSeen } from "@src/features/Org2Cloud/SessionConversation/useMarkDiscussionSeen";
import type { Org2CloudAuthState } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import {
  org2CloudRemoteSessionsAtom,
  remoteSessionsEntryForIdentity,
} from "@src/features/Org2Cloud/org2CloudRemoteSessionsAtom";
import { findImportedSession } from "@src/features/TeamCollaboration/engine/collabImportIdentity";
import { getSessionForkedFrom } from "@src/features/TeamCollaboration/forkSession";
import type { RemoteTeammateSessionMetadata } from "@src/store/collaboration/types";
import { sessionsAtom } from "@src/store/session";
import type { Session } from "@src/store/session/sessionAtom/types";

interface UseConversationFamilyTimelineArgs {
  sessionId: string;
  overrideEvents: SessionEvent[] | undefined;
  comments: SessionCommentsContextValue | null;
  currentSession: Session | undefined;
  auth: Org2CloudAuthState | null;
  authIdentityKey: string | null;
  anchorBareSessionId: string;
}

export interface ConversationMemberTap {
  bareSessionId: string;
  localSessionId: string;
}

/**
 * Resolves the cloud conversation family for the anchor session (synthesizing
 * a just-forked member from local lineage), the timeline family that the
 * plane history allows, and the local sessions to tap for member events.
 */
export function useConversationFamilyTimeline({
  sessionId,
  overrideEvents,
  comments,
  currentSession,
  auth,
  authIdentityKey,
  anchorBareSessionId,
}: UseConversationFamilyTimelineArgs) {
  const remoteEntries = useAtomValue(org2CloudRemoteSessionsAtom);
  const sessions = useAtomValue(sessionsAtom);
  const target = comments?.target ?? null;

  const family = useMemo(() => {
    if (!target || overrideEvents) return null;
    const rows = remoteSessionsEntryForIdentity(
      remoteEntries[target.orgId],
      authIdentityKey
    )?.rows;
    if (!rows?.length) return null;
    const resolved = resolveConversationFamily(rows, anchorBareSessionId);
    if (resolved) return resolved;
    // A just-created fork has no cloud row until its first push lands, so
    // the listing alone cannot place it in a family — and without a family
    // the inherited rows render unstamped ("Shared user"). Synthesize the
    // membership from the LOCAL lineage: the root's listing row plus a
    // pseudo-row for this session owned by the signed-in viewer.
    const lineage = currentSession
      ? getSessionForkedFrom(currentSession)
      : undefined;
    const rootSessionId = lineage?.rootSessionId ?? lineage?.sourceSessionId;
    if (!lineage || !rootSessionId || rootSessionId === anchorBareSessionId) {
      return null;
    }
    const rootFamily =
      resolveConversationFamily(rows, rootSessionId) ??
      (() => {
        const rootRow = rows.find(
          (row) => row.sourceSessionId === rootSessionId
        );
        return rootRow
          ? [{ bareSessionId: rootSessionId, row: rootRow, isRoot: true }]
          : null;
      })();
    if (!rootFamily) return null;
    if (
      rootFamily.some((member) => member.bareSessionId === anchorBareSessionId)
    ) {
      return rootFamily;
    }
    const selfMember: ConversationFamilyMember = {
      bareSessionId: anchorBareSessionId,
      isRoot: false,
      row: {
        id: `local-${anchorBareSessionId}`,
        orgId: target.orgId,
        sourceSessionId: anchorBareSessionId,
        ownerUserId: auth?.userId ?? "",
        ownerDisplayName: auth?.profile?.displayName ?? "",
        forkedFrom: {
          sourceSessionId: lineage.sourceSessionId,
          rootSessionId,
          forkedAt: lineage.forkedAt,
        },
      } as unknown as RemoteTeammateSessionMetadata,
    };
    return [...rootFamily, selfMember];
  }, [
    target,
    overrideEvents,
    remoteEntries,
    authIdentityKey,
    anchorBareSessionId,
    currentSession,
    auth?.userId,
    auth?.profile?.displayName,
  ]);
  const plane = useConversationPlaneEvents(target);
  const timelineFamily = useMemo(
    () =>
      legacyConversationFamilyForTimeline(
        family,
        anchorBareSessionId,
        plane.events,
        plane.historyStartedAt
      ),
    [anchorBareSessionId, family, plane.events, plane.historyStartedAt]
  );

  useMarkDiscussionSeen(sessionId, comments, family);

  const memberTaps = useMemo(() => {
    if (!timelineFamily || !target) return [];
    const taps: ConversationMemberTap[] = [];
    for (const member of timelineFamily) {
      if (member.bareSessionId === anchorBareSessionId) continue;
      const local =
        sessions.find(
          (session) => session.session_id === member.bareSessionId
        ) ??
        findImportedSession(
          sessions,
          target.orgId,
          member.bareSessionId,
          auth?.supabaseUrl
        );
      if (local) {
        taps.push({
          bareSessionId: member.bareSessionId,
          localSessionId: local.session_id,
        });
      }
    }
    return taps;
  }, [
    timelineFamily,
    target,
    sessions,
    auth?.supabaseUrl,
    anchorBareSessionId,
  ]);

  const loadedBareSessionIds = useMemo(
    () => new Set(memberTaps.map((tap) => tap.bareSessionId)),
    [memberTaps]
  );
  useEnsureFamilyLoaded(
    timelineFamily,
    loadedBareSessionIds,
    anchorBareSessionId
  );

  return { target, plane, timelineFamily, memberTaps };
}
