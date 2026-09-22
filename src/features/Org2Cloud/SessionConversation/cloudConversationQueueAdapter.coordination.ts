/**
 * 0028 turn-coordination bookkeeping for one `dispatchQueuedCloudConversation`
 * attempt: device identity, claim/accept/finish receipts, and the lease
 * renewal timer. The dispatcher mutates `state` as the turn crosses each
 * boundary; the receipt helpers read it.
 */
import { QueuedConversationRecoveryPendingError } from "@src/engines/SessionCore/conversations/queuedConversationContract";
import {
  finishCloudConversationTurn,
  markCloudConversationTurnAccepted,
  renewCloudConversationTurn,
} from "@src/features/Org2Cloud/org2CloudConversationTurnClient";
import { isRetryableCloudRequestError } from "@src/features/Org2Cloud/org2CloudFetchRetry";

import type { BoundCloudAuth } from "./cloudConversationQueueAdapter.boundAuth";
import {
  CLOUD_TURN_LEASE_SECONDS,
  type CloudTurnLeaseRenewal,
  startCloudTurnLeaseRenewal,
} from "./cloudConversationQueueAdapter.support";

export interface CloudTurnCoordinationState {
  deviceId: string | undefined;
  claimed: boolean;
  alreadyTerminal: boolean;
  accepted: boolean;
}

export interface CloudTurnCoordination {
  state: CloudTurnCoordinationState;
  stopLeaseRenewal: () => Promise<void>;
  startLeaseRenewal: () => void;
  identity: () => {
    orgId: string;
    rootSessionId: string;
    turnId: string;
    deviceId: string;
  };
  markAccepted: () => Promise<void>;
  finish: (status: "completed" | "failed" | "cancelled") => Promise<void>;
}

export function createCloudTurnCoordination(input: {
  enabled: boolean;
  orgId: string;
  rootSessionId: string;
  turnId: string;
  auth: BoundCloudAuth;
}): CloudTurnCoordination {
  const { enabled: coordinationEnabled, orgId, rootSessionId, turnId } = input;
  const { requireBoundAuth, refreshBoundAuth } = input.auth;
  const state: CloudTurnCoordinationState = {
    deviceId: undefined,
    claimed: false,
    alreadyTerminal: false,
    accepted: false,
  };
  let leaseRenewal: CloudTurnLeaseRenewal | undefined;
  const stopLeaseRenewal = async () => {
    const current = leaseRenewal;
    leaseRenewal = undefined;
    await current?.stop();
  };
  const coordinationIdentity = () => {
    if (!state.deviceId) {
      throw new Error("Cloud conversation coordination has no device owner");
    }
    return {
      orgId,
      rootSessionId,
      turnId,
      deviceId: state.deviceId,
    };
  };
  const markCoordinationAccepted = async () => {
    if (!coordinationEnabled || state.accepted) return;
    try {
      const fresh = await refreshBoundAuth();
      await markCloudConversationTurnAccepted(
        fresh.accessToken,
        {
          ...coordinationIdentity(),
          leaseSeconds: CLOUD_TURN_LEASE_SECONDS,
        },
        {
          supabaseUrl: fresh.supabaseUrl,
          anonKey: fresh.supabaseAnonKey,
        }
      );
      state.accepted = true;
      requireBoundAuth();
    } catch (error) {
      if (isRetryableCloudRequestError(error)) {
        throw new QueuedConversationRecoveryPendingError(
          error instanceof Error ? error.message : String(error)
        );
      }
      throw error;
    }
  };
  const finishCoordination = async (
    status: "completed" | "failed" | "cancelled"
  ) => {
    if (!coordinationEnabled || !state.claimed) return;
    try {
      const fresh = await refreshBoundAuth();
      await finishCloudConversationTurn(
        fresh.accessToken,
        { ...coordinationIdentity(), status },
        {
          supabaseUrl: fresh.supabaseUrl,
          anonKey: fresh.supabaseAnonKey,
        }
      );
      requireBoundAuth();
    } catch (error) {
      // Provider/tail completion is already durable locally and possibly in
      // Cloud. Keep this same queue owner until the idempotent finish receipt
      // succeeds; never turn a bookkeeping failure into another provider run.
      throw new QueuedConversationRecoveryPendingError(
        error instanceof Error ? error.message : String(error)
      );
    }
  };
  const startLeaseRenewal = () => {
    leaseRenewal = startCloudTurnLeaseRenewal(async () => {
      const current = requireBoundAuth();
      await renewCloudConversationTurn(
        current.accessToken,
        {
          ...coordinationIdentity(),
          leaseSeconds: CLOUD_TURN_LEASE_SECONDS,
        },
        {
          supabaseUrl: current.supabaseUrl,
          anonKey: current.supabaseAnonKey,
        }
      );
    });
  };
  return {
    state,
    stopLeaseRenewal,
    startLeaseRenewal,
    identity: coordinationIdentity,
    markAccepted: markCoordinationAccepted,
    finish: finishCoordination,
  };
}
