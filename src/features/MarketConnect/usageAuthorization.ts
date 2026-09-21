import { MARKET_PROFILES_CHANGED_EVENT } from "./events";
import { captureMarketOwner } from "./identity";
import type { MarketExecutionProfile } from "./marketProfiles";
import type { ManagedService } from "./rpc";
import { activateManagedService } from "./rpc";

export interface UsagePrompt {
  service: ManagedService;
  resolve: (accepted: boolean) => void;
}
export const USAGE_AUTHORIZATION_EVENT = "org2-managed-usage-authorization";
export const USAGE_AUTHORIZATION_CANCEL_EVENT = "org2-managed-usage-cancel";
let pending: object | null = null;
/** One explicit consent at a time. The host cancels on unmount and connection
 * changes; activation remains bound to the selected native authorization. */
export async function authorizedProfile(
  profile: MarketExecutionProfile,
  model: string
): Promise<MarketExecutionProfile> {
  const operation = {};
  let cancelPrompt: (() => void) | undefined;
  const owner = captureMarketOwner(
    profile.connection.identity_user_id,
    undefined,
    () => {
      if (pending === operation) pending = null;
      cancelPrompt?.();
      window.dispatchEvent(new Event(USAGE_AUTHORIZATION_CANCEL_EVENT));
    }
  );
  try {
    const service = profile.managed;
    if (!service) return profile;
    const selected = service.models.find((m) => m.model === model);
    if (!selected || selected.availability !== "available")
      throw new Error("model_temporarily_unavailable");
    if (
      !service.requires_confirmation &&
      service.access?.status === "active" &&
      service.access.billing_mode === "wallet"
    )
      return profile;
    if (pending) throw new Error("usage_authorization_in_progress");
    pending = operation;
    const accepted = await new Promise<boolean>((resolve) => {
      cancelPrompt = () => resolve(false);
      window.dispatchEvent(
        new CustomEvent<UsagePrompt>(USAGE_AUTHORIZATION_EVENT, {
          detail: { service, resolve },
        })
      );
    });
    if (!accepted) throw new Error("usage_authorization_cancelled");
    owner.assertCurrent();
    const access = await activateManagedService(profile.connection, service);
    owner.assertCurrent();
    window.dispatchEvent(new Event(MARKET_PROFILES_CHANGED_EVENT));
    return {
      ...profile,
      entitlementWorkspaceId: access.workspace_id,
      entitlementId: access.access_id,
      managed: {
        ...service,
        access,
        requires_confirmation: false,
      },
    };
  } finally {
    owner.dispose();
    if (pending === operation) pending = null;
  }
}
