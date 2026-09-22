/**
 * Sender-bound auth guards for `cloudConversationQueueAdapter`: every read
 * in a dispatch attempt must run under the exact account (and deployment)
 * the queued turn was authored with.
 */
import type { Store } from "jotai/vanilla/store";

import {
  QueuedConversationBlockedError,
  QueuedConversationRecoveryPendingError,
} from "@src/engines/SessionCore/conversations/queuedConversationContract";
import { refreshOrg2CloudAuthForAction } from "@src/features/Org2Cloud/org2CloudAuthAction";
import {
  type Org2CloudAuthState,
  org2CloudAuthAtom,
  org2CloudAuthIdentityKey,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { normalizeSourceEndpointUrl } from "@src/features/TeamCollaboration/engine/collabImportIdentity";

export interface BoundCloudAuth {
  requireBoundAuth: () => Org2CloudAuthState;
  refreshBoundAuth: () => Promise<Org2CloudAuthState>;
}

export function createBoundCloudAuth(input: {
  store: Store;
  expectedIdentityKey: string;
  sourceEndpointUrl: string | undefined;
}): BoundCloudAuth {
  const { store, expectedIdentityKey, sourceEndpointUrl } = input;
  const requireBoundAuth = (): Org2CloudAuthState => {
    const current = store.get(org2CloudAuthAtom);
    if (!current) {
      throw new QueuedConversationBlockedError("cloud sign-in required");
    }
    if (org2CloudAuthIdentityKey(current) !== expectedIdentityKey) {
      throw new QueuedConversationBlockedError(
        "This queued turn belongs to a different Cloud account; switch back to its author account to send it"
      );
    }
    if (
      sourceEndpointUrl &&
      normalizeSourceEndpointUrl(current.supabaseUrl) !== sourceEndpointUrl
    ) {
      throw new QueuedConversationBlockedError(
        "This queued turn belongs to a different Cloud deployment"
      );
    }
    return current;
  };
  const refreshBoundAuth = async (): Promise<Org2CloudAuthState> => {
    const current = requireBoundAuth();
    const result = await refreshOrg2CloudAuthForAction(current, (update) =>
      store.set(org2CloudAuthAtom, update)
    );
    if (result.status === "unavailable") {
      throw new QueuedConversationRecoveryPendingError(
        "cloud auth refresh is temporarily unavailable"
      );
    }
    if (result.status !== "ready") {
      throw new QueuedConversationBlockedError(
        result.status === "expired"
          ? "cloud sign-in expired"
          : "cloud account changed during delivery"
      );
    }
    const fresh = result.auth;
    if (org2CloudAuthIdentityKey(fresh) !== expectedIdentityKey) {
      throw new QueuedConversationBlockedError(
        "cloud account changed during delivery"
      );
    }
    requireBoundAuth();
    return fresh;
  };
  return { requireBoundAuth, refreshBoundAuth };
}
