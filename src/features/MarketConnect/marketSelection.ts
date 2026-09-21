import type { MarketExecutionProfile } from "./marketProfiles";

interface AppliedMarketSelection {
  identityUserId: string;
  workspaceId: string;
  entitlementId: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKSPACE = /^ws_[A-Za-z0-9_-]{1,120}$/;
const ENTITLEMENT = /^(?:ent|pa)_[A-Za-z0-9_-]{1,60}$/;

/** Decode the metadata-only selection written to the managed app manifest.
 * It contains purchase identifiers, never a seller credential or access token.
 * Legacy target grants are decoded for display only; Rust still rejects them
 * as runtime sources and requires canonical ORG2 authorization. */
export function parseAppliedMarketSelection(
  value: string | null | undefined
): AppliedMarketSelection | null {
  if (!value?.startsWith("market:") || value.length > 1024) return null;
  try {
    const encoded = value.slice("market:".length);
    const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(padded), (character) =>
      character.charCodeAt(0)
    );
    const decoded = JSON.parse(new TextDecoder().decode(bytes)) as {
      metadata?: {
        identity_user_id?: unknown;
        workspace_id?: unknown;
        target?: unknown;
      };
      workspace_id?: unknown;
      entitlement_id?: unknown;
    };
    const identityUserId = decoded.metadata?.identity_user_id;
    const authorizationWorkspaceId = decoded.metadata?.workspace_id;
    const workspaceId = Object.prototype.hasOwnProperty.call(
      decoded,
      "workspace_id"
    )
      ? decoded.workspace_id
      : authorizationWorkspaceId;
    const entitlementId = decoded.entitlement_id;
    if (
      typeof identityUserId !== "string" ||
      !UUID.test(identityUserId) ||
      typeof authorizationWorkspaceId !== "string" ||
      !WORKSPACE.test(authorizationWorkspaceId) ||
      !["org2", "claude-code", "claude-app", "codex"].includes(
        String(decoded.metadata?.target)
      ) ||
      typeof workspaceId !== "string" ||
      !WORKSPACE.test(workspaceId) ||
      typeof entitlementId !== "string" ||
      !ENTITLEMENT.test(entitlementId)
    ) {
      return null;
    }
    return { identityUserId, workspaceId, entitlementId };
  } catch {
    return null;
  }
}

export function profileForAppliedMarketSelection(
  profiles: MarketExecutionProfile[],
  value: string | null | undefined
): MarketExecutionProfile | null {
  const selection = parseAppliedMarketSelection(value);
  if (!selection) return null;
  return (
    profiles.find(
      (profile) =>
        profile.connection.identity_user_id === selection.identityUserId &&
        profile.entitlementWorkspaceId === selection.workspaceId &&
        profile.entitlementId === selection.entitlementId
    ) ?? null
  );
}

/** Display-only decoder; Rust validates schema, aliases and identity on use. */
export function profilesForAppliedMarketSelection(
  profiles: MarketExecutionProfile[],
  value: string | null | undefined
): MarketExecutionProfile[] {
  if (!value?.startsWith("market-app:")) {
    const single = profileForAppliedMarketSelection(profiles, value);
    return single ? [single] : [];
  }
  if (value.length > 64 * 1024) return [];
  try {
    const encoded = value
      .slice("market-app:".length)
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const bytes = Uint8Array.from(
      atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")),
      (c) => c.charCodeAt(0)
    );
    const catalog: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (
      !catalog ||
      typeof catalog !== "object" ||
      !("version" in catalog) ||
      catalog.version !== 1 ||
      !("models" in catalog) ||
      !Array.isArray(catalog.models) ||
      catalog.models.length < 1 ||
      catalog.models.length > 64
    )
      return [];
    const found = new Map<string, MarketExecutionProfile>();
    for (const model of catalog.models) {
      if (
        !model ||
        typeof model !== "object" ||
        typeof model.selection !== "string"
      )
        return [];
      const selection = parseAppliedMarketSelection(model.selection);
      if (!selection) return [];
      const profile = profileForAppliedMarketSelection(
        profiles,
        model.selection
      );
      if (profile) found.set(profile.id, profile);
    }
    return [...found.values()];
  } catch {
    return [];
  }
}
