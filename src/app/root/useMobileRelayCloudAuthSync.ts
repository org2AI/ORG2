import { useAtomValue, useSetAtom, useStore } from "jotai";
import { useEffect, useRef } from "react";

import { awaitMirroredOrg2CloudAuth } from "@src/api/http/auth/sharedAuthStorage";
import { notifyCloudAuthChanged } from "@src/api/tauri/mobileRemote";
import {
  clearRejectedAuth,
  commitRefreshedAuth,
  org2CloudAuthAtom,
} from "@src/features/Org2Cloud/org2CloudAuthAtom";
import { ensureFreshSession } from "@src/features/Org2Cloud/org2CloudClient";
import { useTauriListen } from "@src/hooks/platform/useTauriListen";
import { useSetting } from "@src/hooks/settings/useSettings";

const RELAY_AUTH_REFRESH_EVENT = "mobile-relay-auth-refresh-needed";

/** Durable auth publication and notification belong to this mounted auth scope.
 * Market readiness is independent. Retry only failed work, with one bounded
 * timer; this connectivity repair remains active while Desktop is hidden.
 */
export function useMobileRelayCloudAuthSync(): void {
  const [enabled] = useSetting("mobileRemote.enabled");
  const [relayEnabled] = useSetting("mobileRemote.relayEnabled");
  const auth = useAtomValue(org2CloudAuthAtom);
  const setAuth = useSetAtom(org2CloudAuthAtom);
  const store = useStore();
  const requestRefresh = useRef<(() => void) | null>(null);
  const published = useRef<{ store: typeof store; signature: string } | null>(
    null
  );

  useEffect(() => {
    if (!enabled || !relayEnabled) {
      published.current = null;
      return;
    }
    // Hydration/focus can replace the auth object without changing credentials.
    // Profile-only changes must not tear down a healthy native connection.
    const signature = JSON.stringify(
      auth
        ? [
            auth.supabaseUrl,
            auth.supabaseAnonKey,
            auth.userId,
            auth.accessToken,
            auth.refreshToken,
            auth.expiresAt,
            auth.oauthClientId,
          ]
        : null
    );
    let disposed = false;
    let running = false;
    let forceRefresh = false;
    let retryAttempt = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => !disposed && store.get(org2CloudAuthAtom) === auth;

    const sync = async () => {
      if (running || !current()) return;
      clearTimeout(timer);
      running = true;
      const force = forceRefresh;
      forceRefresh = false;
      try {
        if (
          !force &&
          published.current?.store === store &&
          published.current.signature === signature
        )
          return;
        const fresh = auth
          ? await ensureFreshSession(auth, {
              forceRefresh: force,
              onRefreshRejected: () => {
                // Definitive rejection follows the existing canonical sign-out
                // policy. Network failures never clear a user's session.
                if (current()) clearRejectedAuth(setAuth, auth);
              },
            })
          : null;
        if (!current()) return;
        if (auth && !fresh)
          throw new Error("Relay credential refresh unavailable");
        if (auth && fresh && fresh !== auth) {
          // Publishing the rotation starts the next effect, which owns its
          // durable write. Never let the old effect notify after an auth switch.
          commitRefreshedAuth(setAuth, auth, fresh);
          return;
        }
        await awaitMirroredOrg2CloudAuth(fresh ? JSON.stringify(fresh) : null);
        if (!current()) return;
        await notifyCloudAuthChanged();
        if (current()) published.current = { store, signature };
        retryAttempt = 0;
      } catch {
        if (!current()) return;
        forceRefresh ||= force;
        retryAttempt = Math.min(retryAttempt + 1, 6);
      } finally {
        running = false;
        if (current() && (retryAttempt > 0 || forceRefresh)) {
          timer = setTimeout(
            () => void sync().catch(() => {}),
            Math.min(30_000, 1000 * 2 ** Math.max(0, retryAttempt - 1))
          );
        }
      }
    };
    requestRefresh.current = () => {
      forceRefresh = true;
      // Coalesce native refresh signals and preserve failure backoff.
      if (!running && retryAttempt === 0) void sync().catch(() => {});
    };
    // sync owns retry/backoff; event/effect entry points also consume rejection.
    void sync().catch(() => {});
    return () => {
      disposed = true;
      requestRefresh.current = null;
      clearTimeout(timer);
    };
  }, [auth, enabled, relayEnabled, setAuth, store]);

  useTauriListen(RELAY_AUTH_REFRESH_EVENT, () => requestRefresh.current?.());
}
