/**
 * useOrg2CloudRealtime — per-plane invalidation bumps.
 *
 * One stable callback per inbound plane. Every Realtime path (postgres
 * changes, org broadcasts, edge recovery, foreground recovery) funnels its
 * refresh through these so a signal can only ever move its own plane.
 */
import { useSetAtom } from "jotai";
import { type RefObject, useCallback } from "react";

import {
  bumpConversationPlaneSignal,
  conversationPlaneSignalAtom,
} from "./SessionConversation/conversationPlaneAtom";
import {
  bumpOrg2CloudChannelMessagesVersionAtom,
  bumpOrg2CloudChannelsVersionAtom,
} from "./channels/channelsAtom";
import {
  bumpCommentsSignalKey,
  org2CloudCommentsSignalAtom,
  orgCommentsKey,
  sessionCommentsKey,
} from "./org2CloudCommentsBus";
import {
  org2CloudMemberRuntimeVersionAtom,
  org2CloudRosterVersionAtom,
} from "./org2CloudOrgsAtom";
import {
  bumpRemoteSessionsInvalidation,
  org2CloudRemoteSessionsVersionAtom,
} from "./org2CloudRemoteSessionsAtom";
import type { SessionCommentTarget } from "./sessionCommentTarget";

export interface Org2CloudRealtimePlaneBumps {
  bumpChannelsVersion: (orgId: string) => void;
  bumpChannelMessagesVersion: (orgId: string) => void;
  bumpConversationPlaneVersion: (orgId: string) => void;
  bumpRosterVersion: (orgId: string) => void;
  bumpMemberRuntimeVersion: (orgId: string) => void;
  bumpOrgCommentsSignal: (orgId: string) => void;
  bumpActiveSessionCommentsSignal: (orgId: string) => void;
  bumpRemoteSessionsVersion: (
    orgId: string,
    options?: { full?: boolean }
  ) => void;
}

export function useOrg2CloudRealtimePlaneBumps(
  activeCommentTargetRef: RefObject<SessionCommentTarget | null>
): Org2CloudRealtimePlaneBumps {
  const setRosterVersion = useSetAtom(org2CloudRosterVersionAtom);
  const bumpChannelsVersion = useSetAtom(bumpOrg2CloudChannelsVersionAtom);
  const bumpChannelMessagesForOrg = useSetAtom(
    bumpOrg2CloudChannelMessagesVersionAtom
  );
  // The signal carries the org, not the channel, so every open channel of
  // that org re-runs its bounded delta pull (`p_since`), not a full re-list.
  const bumpChannelMessagesVersion = useCallback(
    (orgId: string) => {
      bumpChannelMessagesForOrg({ orgId });
    },
    [bumpChannelMessagesForOrg]
  );
  const setConversationPlaneSignal = useSetAtom(conversationPlaneSignalAtom);
  const bumpConversationPlaneVersion = useCallback(
    (orgId: string) => {
      bumpConversationPlaneSignal(setConversationPlaneSignal, orgId);
    },
    [setConversationPlaneSignal]
  );
  const bumpRosterVersion = useCallback(
    (orgId: string) => {
      setRosterVersion((current) => ({
        ...current,
        [orgId]: (current[orgId] ?? 0) + 1,
      }));
    },
    [setRosterVersion]
  );
  const setMemberRuntimeVersion = useSetAtom(org2CloudMemberRuntimeVersionAtom);
  const bumpMemberRuntimeVersion = useCallback(
    (orgId: string) => {
      setMemberRuntimeVersion((current) => ({
        ...current,
        [orgId]: (current[orgId] ?? 0) + 1,
      }));
    },
    [setMemberRuntimeVersion]
  );
  const setRemoteSessionsVersion = useSetAtom(
    org2CloudRemoteSessionsVersionAtom
  );
  const setCommentsSignal = useSetAtom(org2CloudCommentsSignalAtom);
  const bumpOrgCommentsSignal = useCallback(
    (orgId: string) => {
      setCommentsSignal((current) =>
        bumpCommentsSignalKey(current, orgCommentsKey(orgId))
      );
    },
    [setCommentsSignal]
  );
  const bumpActiveSessionCommentsSignal = useCallback(
    (orgId: string) => {
      const target = activeCommentTargetRef.current;
      if (!target || target.orgId !== orgId) return;
      setCommentsSignal((current) =>
        bumpCommentsSignalKey(
          current,
          sessionCommentsKey(orgId, target.sessionId)
        )
      );
    },
    [activeCommentTargetRef, setCommentsSignal]
  );
  const bumpRemoteSessionsVersion = useCallback(
    (orgId: string, options: { full?: boolean } = {}) => {
      setRemoteSessionsVersion((current) =>
        bumpRemoteSessionsInvalidation(current, orgId, options)
      );
    },
    [setRemoteSessionsVersion]
  );

  return {
    bumpChannelsVersion,
    bumpChannelMessagesVersion,
    bumpConversationPlaneVersion,
    bumpRosterVersion,
    bumpMemberRuntimeVersion,
    bumpOrgCommentsSignal,
    bumpActiveSessionCommentsSignal,
    bumpRemoteSessionsVersion,
  };
}
