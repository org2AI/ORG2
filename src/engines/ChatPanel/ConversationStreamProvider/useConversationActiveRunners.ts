import { useAtomValue } from "jotai";
import { useMemo } from "react";

import { conversationRootKey } from "@src/engines/SessionCore/conversations/conversationTypes";
import { collectLandedTurnIds } from "@src/features/Org2Cloud/SessionConversation/conversationRunnerOverlay";
import type { Org2CloudAuthState } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import type { CloudConversationEvent } from "@src/features/Org2Cloud/org2CloudConversationEventsClient";
import type { SessionCommentTarget } from "@src/features/Org2Cloud/sessionCommentTarget";
import { normalizeSourceEndpointUrl } from "@src/features/TeamCollaboration/engine/collabImportIdentity";

import {
  conversationActiveDeliveriesAtom,
  selectConversationActiveRunners,
} from "./conversationActiveDeliveries";

interface UseConversationActiveRunnersArgs {
  auth: Org2CloudAuthState | null;
  authIdentityKey: string | null;
  target: SessionCommentTarget | null;
  localRootKey: string | null;
  planeEvents: readonly CloudConversationEvent[];
}

/**
 * Live overlay for THIS device's in-flight member turns: the runner is a
 * local session, so its thinking / tool / worked-for events stream in real
 * time — tap and merge them until the plane carries the turn's terminal
 * tail, so the sender sees the agent working instead of a dead wait.
 */
export function useConversationActiveRunners({
  auth,
  authIdentityKey,
  target,
  localRootKey,
  planeEvents,
}: UseConversationActiveRunnersArgs) {
  const planeRootId = target?.sessionId ?? null;
  const runnerRegistryKey = useMemo(() => {
    if (!auth || !authIdentityKey || !target || !planeRootId) return null;
    return conversationRootKey({
      authority: "org2-cloud",
      authorityScope: [
        normalizeSourceEndpointUrl(auth.supabaseUrl),
        target.orgId,
      ],
      conversationId: planeRootId,
    });
  }, [auth, authIdentityKey, planeRootId, target]);
  const scopedActiveDeliveriesAtom = useMemo(
    () =>
      conversationActiveDeliveriesAtom({
        cloudRootKey: runnerRegistryKey,
        cloudIdentityKey: authIdentityKey,
        localRootKey,
      }),
    [authIdentityKey, localRootKey, runnerRegistryKey]
  );
  const activeDeliveries = useAtomValue(scopedActiveDeliveriesAtom);
  const landedTurnIds = useMemo(
    () => collectLandedTurnIds(planeEvents),
    [planeEvents]
  );
  const activeRunners = useMemo(() => {
    return selectConversationActiveRunners(activeDeliveries, {
      cloudRootKey: runnerRegistryKey,
      cloudIdentityKey: authIdentityKey,
      localRootKey,
      landedTurnIds,
    });
  }, [
    activeDeliveries,
    authIdentityKey,
    landedTurnIds,
    localRootKey,
    runnerRegistryKey,
  ]);
  const activeRunnerIds = useMemo(
    () => new Set(activeRunners.map((runner) => runner.runnerSessionId)),
    [activeRunners]
  );
  // The in-flight runner drives the chat footer's running/typing indicator
  // so a member's long turn shows "Thinking…" instead of a frozen screen.
  const activeRunnerSessionId =
    activeRunners.length > 0
      ? activeRunners[activeRunners.length - 1].runnerSessionId
      : null;

  return {
    activeDeliveries,
    activeRunners,
    activeRunnerIds,
    activeRunnerSessionId,
  };
}
