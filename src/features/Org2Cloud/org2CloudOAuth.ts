import { cancel, start } from "@fabianlars/tauri-plugin-oauth";

import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { CloudOAuthFlow } from "./cloudOAuthFlow";
import { completeOrg2CloudSignIn } from "./completeSignIn";
import { getCloudEndpoint } from "./config";
import { org2CloudAuthAtom } from "./org2CloudAuthAtom";
import { cancelPendingOrg2CloudAuthLoopback } from "./org2CloudAuthLoopback";

export const org2CloudOAuth = new CloudOAuthFlow({
  start: async () => {
    await cancelPendingOrg2CloudAuthLoopback();
    return start({
      response:
        "<!doctype html><html><head><title>ORG2</title></head><body><p>Return to ORG2 to finish signing in. You can close this tab.</p></body></html>",
    });
  },
  stop: cancel,
  fetch: (...args) => fetch(...args),
  endpoint: getCloudEndpoint,
  identity: () => {
    const auth = getInstrumentedStore().get(org2CloudAuthAtom);
    return auth
      ? `${auth.supabaseUrl}|${auth.userId}|${auth.refreshToken}`
      : "";
  },
  watch: (invalidate) =>
    getInstrumentedStore().sub(org2CloudAuthAtom, invalidate),
  commit: (session) =>
    completeOrg2CloudSignIn(session, (value) =>
      getInstrumentedStore().set(org2CloudAuthAtom, value)
    ),
});
export async function beginOrg2CloudOAuth(
  onSignedIn?: () => void
): Promise<string> {
  return org2CloudOAuth.begin(onSignedIn);
}
