import Message from "@src/components/Message";
import { org2CloudAuthAtom } from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { openOrg2CloudSignIn } from "@src/features/Org2Cloud/useOrg2CloudSignIn";
import i18n from "@src/i18n";
import { getInstrumentedStore } from "@src/util/core/state/instrumentedStore";

import { marketActivationErrorCode } from "./activationError";
import {
  MARKET_CONNECTION_OPEN_EVENT,
  dispatchMarketConnection,
  dispatchMarketConnectionError,
} from "./events";
import { captureMarketOwner } from "./identity";
import { loadConnections } from "./rpc";
import { isMarketAppUrl } from "./urlPolicy";

let busy = false;
/** Website links are navigation shortcuts. Account authorization and package
 * discovery use the same API path as opening the app's model picker directly. */
export function handleMarketConnectionUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (!isMarketAppUrl(url)) return false;
  // Retired website authorization callbacks cannot complete any enrollment.
  if (url.pathname !== "/connect") return true;
  if (
    raw.length > 2048 ||
    url.username ||
    url.password ||
    url.port ||
    url.hash ||
    busy
  )
    return true;
  const params = [...url.searchParams];
  if (
    params.length !== 2 ||
    !/^ws_[A-Za-z0-9_-]{1,120}$/.test(
      url.searchParams.get("workspace_id") ?? ""
    ) ||
    !["org2", "claude-code", "claude-app", "codex"].includes(
      url.searchParams.get("target") ?? ""
    )
  )
    return true;
  busy = true;
  (async () => {
    let resume = false;
    const signInAndResume = () =>
      openOrg2CloudSignIn({
        onSignedIn: () => {
          resume = true;
          if (!busy) handleMarketConnectionUrl(raw);
        },
      });
    try {
      const store = getInstrumentedStore();
      if (!store.get(org2CloudAuthAtom)) {
        await signInAndResume();
        return;
      }
      const auth = store.get(org2CloudAuthAtom)!;
      const owner = captureMarketOwner(auth.userId, store);
      try {
        const status = await loadConnections(store);
        owner.assertCurrent();
        const connection = status.connections.find(
          (c) =>
            c.identity_user_id === auth.userId &&
            c.target === "org2" &&
            c.phase === "authorization_saved"
        );
        if (!connection) throw Error("market_reauthorization_required");
        dispatchMarketConnection(MARKET_CONNECTION_OPEN_EVENT, connection);
      } catch (error) {
        owner.assertCurrent();
        if (
          !auth.oauthClientId &&
          marketActivationErrorCode(error) === "market_reauthorization_required"
        ) {
          await signInAndResume();
          return;
        }
        throw error;
      } finally {
        owner.dispose();
      }
    } catch (error) {
      dispatchMarketConnectionError(error, "load-profiles", "org2");
      Message.error(i18n.t("integrations:marketConnection.failed"));
    } finally {
      busy = false;
      if (resume) handleMarketConnectionUrl(raw);
    }
  })().catch(() => console.error("Market navigation failed"));
  return true;
}
