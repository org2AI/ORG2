/**
 * useOrg2CloudRealtime — identity-owned cache eviction.
 *
 * Cached rosters and derived display names are identity-owned. Evict them
 * on sign-out/account/endpoint changes instead of merely hiding old rows.
 */
import { useSetAtom, useStore } from "jotai";
import { useLayoutEffect } from "react";

import {
  org2CloudChannelMessagesVersionAtom,
  org2CloudChannelsVersionAtom,
} from "./channels/channelsAtom";
import { org2CloudCommentsSignalAtom } from "./org2CloudCommentsBus";
import { org2CloudMemberNamesAtom } from "./org2CloudMemberNamesAtom";
import { clearCloudOrgMembersCache } from "./org2CloudMembersCoordinator";
import {
  org2CloudMemberRuntimeVersionAtom,
  org2CloudRosterRealtimeConnectedAtom,
  org2CloudRosterVersionAtom,
} from "./org2CloudOrgsAtom";
import {
  org2CloudPresenceAtom,
  org2CloudPresenceOutboundAtom,
} from "./org2CloudPresenceAtom";
import {
  org2CloudRemoteSessionsAtom,
  org2CloudRemoteSessionsVersionAtom,
} from "./org2CloudRemoteSessionsAtom";
import { org2CloudSessionCommentsAtom } from "./org2CloudSessionCommentsAtom";

export function useOrg2CloudRealtimeIdentityReset(
  authIdentityKey: string | null
): void {
  const store = useStore();
  const setRosterVersion = useSetAtom(org2CloudRosterVersionAtom);
  const setChannelsVersion = useSetAtom(org2CloudChannelsVersionAtom);
  const setChannelMessagesVersion = useSetAtom(
    org2CloudChannelMessagesVersionAtom
  );
  const setRosterRealtimeConnected = useSetAtom(
    org2CloudRosterRealtimeConnectedAtom
  );
  const setMemberRuntimeVersion = useSetAtom(org2CloudMemberRuntimeVersionAtom);
  const setRemoteSessionsVersion = useSetAtom(
    org2CloudRemoteSessionsVersionAtom
  );
  const setCommentsSignal = useSetAtom(org2CloudCommentsSignalAtom);
  const setSessionComments = useSetAtom(org2CloudSessionCommentsAtom);
  const setPresence = useSetAtom(org2CloudPresenceAtom);
  const setOutboundPresence = useSetAtom(org2CloudPresenceOutboundAtom);
  const setRemoteSessions = useSetAtom(org2CloudRemoteSessionsAtom);
  const setMemberNames = useSetAtom(org2CloudMemberNamesAtom);
  useLayoutEffect(() => {
    // Cached rosters and derived display names are identity-owned. Evict them
    // on sign-out/account/endpoint changes instead of merely hiding old rows.
    clearCloudOrgMembersCache(store);
    setMemberNames({});
    setRosterVersion({});
    setMemberRuntimeVersion({});
    setRosterRealtimeConnected({});
    setRemoteSessions({});
    setRemoteSessionsVersion({});
    setSessionComments({});
    setCommentsSignal({});
    setPresence({});
    setOutboundPresence({});
    setChannelsVersion({});
    setChannelMessagesVersion({});
  }, [
    authIdentityKey,
    setChannelMessagesVersion,
    setChannelsVersion,
    setCommentsSignal,
    setMemberNames,
    setMemberRuntimeVersion,
    setOutboundPresence,
    setPresence,
    setRemoteSessions,
    setRemoteSessionsVersion,
    setRosterVersion,
    setRosterRealtimeConnected,
    setSessionComments,
    store,
  ]);
}
