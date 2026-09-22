import { useAtomValue } from "jotai";
import { useMemo } from "react";

import { useCloudConversationSource } from "@src/features/Org2Cloud/SessionConversation/useCloudConversationSource";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import {
  org2CloudOrgsLoadedAtom,
  sidebarActiveCloudOrgIdAtom,
} from "@src/features/Org2Cloud/org2CloudOrgsAtom";
import {
  org2CloudPushCursorsAtom,
  org2CloudPushedMetadataAtom,
} from "@src/features/Org2Cloud/org2CloudSyncAtoms";
import {
  pushedCloudOrgIdsForSession,
  resolvePendingCloudConversationTarget,
  sessionCommentTargetForConversationRoot,
  useSessionCommentTarget,
} from "@src/features/Org2Cloud/sessionCommentTarget";
import { sessionOrgTagsAtom } from "@src/features/TeamCollaboration/sessionOrgTagsAtom";
import { reposAtom } from "@src/store/repo";
import type { Session } from "@src/store/session/sessionAtom";

import {
  conversationRootForSession,
  conversationSourceFromImportedHistory,
} from "./conversationSourceResolution";

interface UseConversationCloudTargetArgs {
  sessionId: string | null | undefined;
  session: Session | undefined;
  sessions: Session[];
}

/**
 * Resolves the imported-history source, the Cloud comment target (settled or
 * pending while orgs load) and the Cloud conversation source for a session.
 */
export function useConversationCloudTarget({
  sessionId,
  session,
  sessions,
}: UseConversationCloudTargetArgs) {
  const repos = useAtomValue(reposAtom);
  const cloudAuth = useAtomValue(org2CloudAuthAtom);
  const cloudOrgsLoaded = useAtomValue(org2CloudOrgsLoadedAtom);
  const sessionOrgTags = useAtomValue(sessionOrgTagsAtom);
  const selectedCloudOrg = useAtomValue(sidebarActiveCloudOrgIdAtom);
  const pushCursors = useAtomValue(org2CloudPushCursorsAtom);
  const pushedMetadata = useAtomValue(org2CloudPushedMetadataAtom);
  const externalSource = useMemo(
    () => conversationSourceFromImportedHistory({ sessionId, session }),
    [session, sessionId]
  );
  const commentTargetSession = useMemo(
    () =>
      session ??
      (externalSource && sessionId
        ? ({ session_id: sessionId } as Session)
        : null),
    [externalSource, session, sessionId]
  );
  const encodedCloudTarget = useMemo(
    () =>
      commentTargetSession
        ? sessionCommentTargetForConversationRoot(
            conversationRootForSession(commentTargetSession)
          )
        : null,
    [commentTargetSession]
  );
  const cloudTarget = useSessionCommentTarget(
    commentTargetSession,
    encodedCloudTarget
  );
  const pendingCloudTarget = useMemo(() => {
    if (cloudTarget || !cloudAuth || cloudOrgsLoaded || !commentTargetSession) {
      return null;
    }
    return resolvePendingCloudConversationTarget({
      session: commentTargetSession,
      tags: sessionOrgTags,
      preferredOrgId: selectedCloudOrg,
      pushedOrgIds: pushedCloudOrgIdsForSession(
        commentTargetSession.session_id,
        pushCursors,
        pushedMetadata
      ),
    });
  }, [
    cloudAuth,
    cloudOrgsLoaded,
    cloudTarget,
    commentTargetSession,
    pushCursors,
    pushedMetadata,
    selectedCloudOrg,
    sessionOrgTags,
  ]);
  const executionCloudTarget = cloudTarget ?? pendingCloudTarget;
  const cloudSource = useCloudConversationSource({
    sessionId,
    session,
    target: executionCloudTarget,
    sessions,
    repos,
  });

  return { externalSource, cloudTarget, pendingCloudTarget, cloudSource };
}
