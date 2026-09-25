import { useAtomValue } from "jotai";
import { useEffect, useState } from "react";

import type { TeamChatMentionMember } from "@src/features/Org2Cloud/SessionConversation/teamChatMentions";
import { org2CloudChannelsVersionAtom } from "@src/features/Org2Cloud/channels/channelsAtom";
import { listCloudChannelMembers } from "@src/features/Org2Cloud/channels/channelsClient";
import {
  useActiveOrgMembers,
  useFreshChannelAccessToken,
} from "@src/features/Org2Cloud/channels/components/useChannelDialogAccess";
import type { CloudChannel } from "@src/features/Org2Cloud/channels/types";
import {
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { createLogger } from "@src/hooks/logger";

const log = createLogger("ChannelMentionMembers");

/** Public channels address the org; private channels address their own members. */
export function useChannelMentionMembers(
  orgId: string,
  channel: CloudChannel | null,
  enabled: boolean
): readonly TeamChatMentionMember[] | null {
  const auth = useAtomValue(org2CloudAuthAtom);
  const versions = useAtomValue(org2CloudChannelsVersionAtom);
  const identity = auth ? org2CloudAuthIdentityKey(auth) : null;
  const orgRoster = useActiveOrgMembers(
    orgId,
    enabled && channel?.visibility === "org"
  );
  const getToken = useFreshChannelAccessToken();
  const channelId =
    enabled && channel?.visibility === "private" ? channel.id : null;
  const version = versions[orgId] ?? 0;
  const key =
    identity && channelId
      ? `${identity}|${orgId}|${channelId}|${version}`
      : null;
  const [resolved, setResolved] = useState<{
    key: string;
    members: readonly TeamChatMentionMember[];
  } | null>(null);

  useEffect(() => {
    if (!key || !channelId) return;
    const controller = new AbortController();
    void (async () => {
      try {
        const token = await getToken();
        if (controller.signal.aborted) return;
        const members = await listCloudChannelMembers(
          token,
          orgId,
          channelId,
          controller.signal
        );
        if (!controller.signal.aborted) setResolved({ key, members });
      } catch {
        if (!controller.signal.aborted) {
          log.warnRateLimited(
            "roster-unavailable",
            60_000,
            "Channel mention roster unavailable"
          );
        }
        // Keep the audience unavailable on failure. A send with a mention
        // is refused by the composer instead of silently losing recipients.
      }
    })();
    return () => controller.abort();
  }, [channelId, getToken, key, orgId]);

  if (!enabled || !identity || !channel) return null;
  if (channel.visibility === "org")
    return orgRoster.loading || orgRoster.error ? null : orgRoster.members;
  return resolved?.key === key ? resolved.members : null;
}
