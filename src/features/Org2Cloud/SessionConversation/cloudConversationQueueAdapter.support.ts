/**
 * Small collaborators for `cloudConversationQueueAdapter`: the turn-lease
 * renewal timer, the capability probe, the Cloud locator parser, and the
 * session lookup.
 */
import type { Store } from "jotai/vanilla/store";

import type { ConversationRootLocator } from "@src/engines/SessionCore/conversations/conversationTypes";
import {
  QueuedConversationBlockedError,
  QueuedConversationRecoveryPendingError,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import type { Org2CloudAuthState } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { getCloudCapabilitiesConfirmed } from "@src/features/Org2Cloud/org2CloudCapabilities";
import { createLogger } from "@src/hooks/logger";
import type { Session } from "@src/store/session";
import { sessionsAtom } from "@src/store/session";

const log = createLogger("CloudConversationQueueAdapter");
export const CLOUD_TURN_LEASE_SECONDS = 30;
const CLOUD_TURN_RENEW_INTERVAL_MS = 10_000;

export interface CloudTurnLeaseRenewal {
  stop: () => Promise<void>;
}

/**
 * One in-flight turn owns one recursive renewal timer. This is lease
 * maintenance for the existing queue owner, not a second dispatcher/watcher.
 */
export function startCloudTurnLeaseRenewal(
  renew: () => Promise<void>
): CloudTurnLeaseRenewal {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | undefined;
  const schedule = () => {
    if (stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      inFlight = renew()
        .catch((error) => {
          log.warn("Cloud conversation turn lease renewal failed", error);
        })
        .finally(() => {
          inFlight = undefined;
          schedule();
        });
    }, CLOUD_TURN_RENEW_INTERVAL_MS);
  };
  schedule();
  return {
    stop: async () => {
      if (stopped) return;
      stopped = true;
      if (timer !== undefined) clearTimeout(timer);
      await inFlight;
    },
  };
}

export function sessionById(
  store: Store,
  sessionId: string
): Session | undefined {
  return store
    .get(sessionsAtom)
    .find((candidate) => candidate.session_id === sessionId);
}

export function cloudLocator(root: ConversationRootLocator): {
  orgId: string;
  rootSessionId: string;
  sourceEndpointUrl?: string;
} {
  if (
    root.authority !== "org2-cloud" ||
    (root.authorityScope.length !== 1 && root.authorityScope.length !== 2)
  ) {
    throw new Error("invalid Cloud conversation identity");
  }
  const [first, second] = root.authorityScope;
  const orgId = second ?? first;
  if (!orgId) throw new Error("invalid Cloud conversation identity");
  return {
    orgId,
    rootSessionId: root.conversationId,
    ...(second ? { sourceEndpointUrl: first } : {}),
  };
}

/**
 * Confirmed capability probe for the bound endpoint. Idempotent conversation
 * events are mandatory; the result says whether 0028 turn coordination is on.
 */
export async function probeCloudTurnCoordination(
  auth: Org2CloudAuthState
): Promise<boolean> {
  const endpoint = {
    supabaseUrl: auth.supabaseUrl,
    anonKey: auth.supabaseAnonKey,
  };
  const capabilityProbe = await getCloudCapabilitiesConfirmed(
    auth.accessToken,
    endpoint
  );
  if (
    !capabilityProbe.confirmed ||
    !capabilityProbe.capabilities.conversationEventsIdempotency
  ) {
    if (!capabilityProbe.confirmed) {
      throw new QueuedConversationRecoveryPendingError(
        "Cloud conversation capability probe is temporarily unavailable"
      );
    }
    throw new QueuedConversationBlockedError(
      "Cloud conversation idempotency is unavailable; refusing an unsafe retry"
    );
  }
  return capabilityProbe.capabilities.conversationTurnCoordination === true;
}
