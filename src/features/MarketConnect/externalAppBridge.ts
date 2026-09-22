import { rpc } from "@src/api/tauri/rpc";
import type { HarnessConnectionView } from "@src/api/tauri/rpc/schemas/agentOrgs";

import { captureMarketOwner } from "./identity";
import type {
  MarketExecutionProfile,
  MarketProfileAgent,
} from "./marketProfiles";
import { configureMarketCatalog, configureMarketProfile } from "./rpc";
import { authorizedProfile } from "./usageAuthorization";

export type ExternalMarketTarget = "claude_code" | "claude_desktop" | "codex";

function profileAgent(target: ExternalMarketTarget): MarketProfileAgent {
  return target === "codex" ? "codex" : "claude_code";
}

/** Match the server's exact native target and current model availability. */
export function modelsForExternalTarget(
  profile: MarketExecutionProfile,
  target: ExternalMarketTarget
): string[] {
  const engineModels = profile.modelsByAgent[profileAgent(target)];
  if (!profile.managed) return engineModels;
  return engineModels.filter((model) =>
    profile.managed?.models.some(
      (candidate) =>
        candidate.model === model &&
        candidate.availability === "available" &&
        candidate.clients.includes(target)
    )
  );
}

export function modelForExternalTarget(
  profile: MarketExecutionProfile,
  target: ExternalMarketTarget,
  preferredAgent?: MarketProfileAgent,
  preferredModel?: string
): string | null {
  const agent = profileAgent(target);
  const models = modelsForExternalTarget(profile, target);
  if (
    preferredAgent === agent &&
    preferredModel &&
    models.includes(preferredModel)
  ) {
    return preferredModel;
  }
  return models[0] ?? null;
}

export function isMarketManagedView(
  view: HarnessConnectionView | null | undefined
): boolean {
  return Boolean(
    view?.config.mode === "orgii_managed" &&
    (view.config.selectedKeyId?.startsWith("market:") ||
      view.config.selectedKeyId?.startsWith("market-app:"))
  );
}

function expectedHashes(view: HarnessConnectionView) {
  return Object.fromEntries(
    view.config.targetFiles.map((file) => [file.id, file.currentHash ?? null])
  );
}

async function readTarget(target: ExternalMarketTarget) {
  return rpc.agentOrgs.connections.status({ agentName: target });
}

export async function configureExternalMarketTarget(
  profile: MarketExecutionProfile,
  target: ExternalMarketTarget,
  preferredAgent?: MarketProfileAgent,
  preferredModel?: string
) {
  const owner = captureMarketOwner(profile.connection.identity_user_id);
  try {
    const view = await readTarget(target);
    owner.assertCurrent();
    const model = modelForExternalTarget(
      profile,
      target,
      preferredAgent,
      preferredModel
    );
    if (!view.installed) throw new Error("client_not_installed");
    if (!view.config.supported) throw new Error("client_not_supported");
    if (view.config.conflict) throw new Error("client_config_conflict");
    if (!model) throw new Error("workspace_not_supported");
    const authorized = await authorizedProfile(profile, model);
    owner.assertCurrent();
    const result = await configureMarketProfile(
      authorized.connection,
      authorized.entitlementWorkspaceId,
      authorized.entitlementId,
      target,
      model,
      expectedHashes(view)
    );
    owner.assertCurrent();
    return result;
  } finally {
    owner.dispose();
  }
}

export async function restoreExternalMarketTarget(
  target: ExternalMarketTarget
) {
  const view = await readTarget(target);
  if (!isMarketManagedView(view)) return;
  await rpc.agentOrgs.managedConfig.restoreDefault({
    agentName: target,
    force: false,
  });
}

/** Authorize every selected package, then atomically install one native catalog. */
export async function configureExternalMarketCatalog(
  profiles: MarketExecutionProfile[],
  target: ExternalMarketTarget,
  defaultProfileId: string,
  defaultModel: string
) {
  if (
    profiles.length < 1 ||
    profiles.length > 8 ||
    new Set(profiles.map((profile) => profile.id)).size !== profiles.length
  )
    throw new Error("invalid_package_selection");
  const owner = captureMarketOwner(profiles[0].connection.identity_user_id);
  try {
    const view = await readTarget(target);
    owner.assertCurrent();
    if (!view.installed) throw new Error("client_not_installed");
    if (!view.config.supported) throw new Error("client_not_supported");
    if (view.config.conflict) throw new Error("client_config_conflict");
    const defaultPackage = profiles.findIndex(
      (profile) => profile.id === defaultProfileId
    );
    if (
      defaultPackage < 0 ||
      !modelsForExternalTarget(profiles[defaultPackage], target).includes(
        defaultModel
      )
    )
      throw new Error("workspace_not_supported");
    const identity = profiles[0].connection.identity_user_id;
    if (
      profiles.some(
        (profile) => profile.connection.identity_user_id !== identity
      )
    )
      throw new Error("market_identity_mismatch");
    const authorized: MarketExecutionProfile[] = [];
    for (const [index, profile] of profiles.entries()) {
      const model =
        index === defaultPackage
          ? defaultModel
          : modelForExternalTarget(profile, target);
      if (!model) throw new Error("workspace_not_supported");
      owner.assertCurrent();
      authorized.push(await authorizedProfile(profile, model));
      owner.assertCurrent();
    }
    const result = await configureMarketCatalog(
      authorized,
      target,
      defaultPackage,
      defaultModel,
      expectedHashes(view)
    );
    owner.assertCurrent();
    return result;
  } finally {
    owner.dispose();
  }
}
