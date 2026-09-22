import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import {
  MobileSessionIdentityInvalidated,
  cachedMobileSessionIdentity,
  invalidateMobileSessionIdentities,
  mobileSessionIdentityGeneration,
  needsMobileSessionIdentityResolution,
  resolveMobileSessionIdentity,
  subscribeMobileSessionIdentities,
} from "../connection/mobileSessionIdentityCache";

type Resolution = {
  client: MobileRpcClient;
  requested: string;
  generation: number;
  sessionId?: string;
  managed?: boolean;
  error?: string;
};

/**
 * Only imported Codex mirrors need an owner lookup. Native and other provider
 * IDs already name their owner; do not put their chat behind a redundant RPC.
 * A resolved mirror keeps config, send, stop and subscription on one owner.
 */
export function useMobileSessionIdentity(
  client: MobileRpcClient | null,
  requested: string,
  supported: boolean,
  online: boolean
) {
  const requiresResolution =
    supported && needsMobileSessionIdentityResolution(requested);
  const subscribe = useCallback(
    (listener: () => void) =>
      client && requiresResolution
        ? subscribeMobileSessionIdentities(client, listener)
        : () => {},
    [client, requiresResolution]
  );
  const getGeneration = useCallback(
    () => (client ? mobileSessionIdentityGeneration(client) : 0),
    [client]
  );
  const generation = useSyncExternalStore(
    subscribe,
    getGeneration,
    getGeneration
  );
  const [resolution, setResolution] = useState<Resolution | null>(null);
  const [previousOnline, setPreviousOnline] = useState(online);
  const [attempt, setAttempt] = useState(0);
  // A relay can restore Desktop on the same phone socket. An error belongs
  // to the old presence interval, not the recovered actor. Adjust it before
  // committing children; keep successful history readable while offline.
  if (previousOnline !== online) {
    setPreviousOnline(online);
    if (online || resolution?.error) setResolution(null);
  }
  const retry = useCallback(() => {
    setResolution(null);
    setAttempt((value) => value + 1);
  }, []);
  const cached =
    client && online
      ? cachedMobileSessionIdentity(client, requested)
      : undefined;
  const cachedResolution = useMemo(
    () =>
      cached && client ? { client, requested, generation, ...cached } : null,
    [cached, client, requested, generation]
  );
  // Retain a cache hit in this mounted view as well, so taking the connection
  // offline does not erase already displayed read-only content.
  if (cachedResolution && resolution !== cachedResolution) {
    setResolution(cachedResolution);
  }
  const current: Resolution | null =
    resolution?.client === client &&
    (!requiresResolution ||
      !online ||
      (resolution.generation === generation &&
        (!resolution.sessionId || cached !== undefined))) &&
    (resolution?.requested === requested || resolution?.sessionId === requested)
      ? resolution
      : cachedResolution;
  useEffect(() => {
    if (client && !online) invalidateMobileSessionIdentities(client);
  }, [client, online]);
  useEffect(() => {
    if (!requiresResolution || !online || !client || current) return;
    let active = true;
    void resolveMobileSessionIdentity(client, requested)
      .then((result) => {
        if (active) {
          setResolution({
            client,
            requested,
            generation,
            sessionId: result.sessionId,
            managed: result.managed,
          });
        }
      })
      .catch((error: unknown) => {
        if (active) {
          if (error instanceof MobileSessionIdentityInvalidated) {
            setAttempt((value) => value + 1);
            return;
          }
          setResolution({
            client,
            requested,
            generation,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      });
    return () => {
      active = false;
    };
  }, [
    client,
    requested,
    requiresResolution,
    online,
    attempt,
    current,
    generation,
  ]);
  return {
    sessionId: requiresResolution ? current?.sessionId : requested,
    managed: supported && current?.managed === true,
    error: requiresResolution ? current?.error : undefined,
    retry,
  };
}
