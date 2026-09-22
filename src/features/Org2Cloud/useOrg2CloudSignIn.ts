/** Shared system-browser entry point for every ORG2 Cloud sign-in surface. */
import { openUrl } from "@tauri-apps/plugin-opener";
import { useCallback } from "react";

import { createLogger } from "@src/hooks/logger";

import { buildOrg2CloudLoginUrl, getCloudEndpoint } from "./config";
import {
  beginOrg2CloudAuthLoopback,
  cancelPendingOrg2CloudAuthLoopback,
} from "./org2CloudAuthLoopback";
import { beginOrg2CloudOAuth, org2CloudOAuth } from "./org2CloudOAuth";

const log = createLogger("Org2CloudSignIn");

export interface Org2CloudSignInDependencies {
  beginAuthLoopback?: (onSignedIn?: () => void) => Promise<string>;
  onSignedIn?: () => void;
  cancelAuthLoopback?: (url: string) => Promise<void>;
  openExternalUrl?: (url: string) => Promise<void>;
  isOfficial?: boolean;
  beginLegacyLoopback?: () => Promise<string>;
  cancelLegacyLoopback?: () => Promise<void>;
}

/**
 * Start the app-owned loopback receiver before opening the browser login.
 * This works from a bare dev executable as well as an installed app and keeps
 * every UI entry point on the same callback path.
 */
export async function openOrg2CloudSignIn(
  dependencies: Org2CloudSignInDependencies = {}
): Promise<void> {
  const beginAuthLoopback =
    dependencies.beginAuthLoopback ?? beginOrg2CloudOAuth;
  const cancelAuthLoopback =
    dependencies.cancelAuthLoopback ??
    (async (url: string) => org2CloudOAuth.cancelAuthorization(url));
  const openExternalUrl = dependencies.openExternalUrl ?? openUrl;

  // Self-hosted deployments retain their existing login contract. Only the
  // managed service is guaranteed to expose the first-party OAuth server.
  if (!(dependencies.isOfficial ?? getCloudEndpoint().isOfficial)) {
    org2CloudOAuth.cancel();
    const legacyCallback = await (
      dependencies.beginLegacyLoopback ?? beginOrg2CloudAuthLoopback
    )();
    try {
      await openExternalUrl(buildOrg2CloudLoginUrl(legacyCallback));
    } catch (error) {
      await (
        dependencies.cancelLegacyLoopback ?? cancelPendingOrg2CloudAuthLoopback
      )();
      throw error;
    }
    return;
  }

  const callbackUrl = await beginAuthLoopback(dependencies.onSignedIn);
  try {
    await openExternalUrl(callbackUrl);
  } catch (error) {
    await cancelAuthLoopback(callbackUrl);
    throw error;
  }
}

/** Stable click handler shared by Settings, Add ORG, invite, and share flows. */
export function useOrg2CloudSignIn(): () => Promise<boolean> {
  return useCallback(async () => {
    try {
      await openOrg2CloudSignIn();
      return true;
    } catch (error: unknown) {
      log.error("failed to open ORG2 Cloud login in system browser", error);
      return false;
    }
  }, []);
}
