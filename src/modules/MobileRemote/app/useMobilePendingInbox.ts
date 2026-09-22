import { useCallback, useEffect, useRef, useState } from "react";

import { createLogger } from "@src/hooks/logger";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import { isPendingPermissions } from "../connection/sessionDiscoveryContract";
import type { MobilePendingPermission } from "../connection/types";
import type { MobileRemoteRuntimePort } from "../platform/types";

export interface MobilePendingInbox {
  items: MobilePendingPermission[];
  phase: "syncing" | "ready" | "error" | "unsupported";
  complete: boolean;
  refresh: () => void;
}

/** One connection-scoped snapshot owner, coalescing pushes; never polls. */
export function useMobilePendingInbox({
  client,
  scope,
  online,
  supported,
  runtime,
  onSnapshot,
}: {
  client: MobileRpcClient | null;
  scope: string;
  online: boolean;
  supported: boolean;
  runtime: MobileRemoteRuntimePort;
  onSnapshot: (items: MobilePendingPermission[]) => void;
}): MobilePendingInbox {
  const [state, setState] = useState<{
    scope: string;
    items: MobilePendingPermission[];
    phase: MobilePendingInbox["phase"];
    complete: boolean;
  }>({ scope, items: [], phase: "syncing", complete: false });
  const refreshRef = useRef(() => {});
  const refresh = useCallback(() => refreshRef.current(), []);
  useEffect(() => {
    if (!supported) return;
    let disposed = false;
    let inFlight = false;
    let dirty = true;
    let version = 0;
    const read = async () => {
      if (
        disposed ||
        inFlight ||
        !dirty ||
        !online ||
        !supported ||
        !client ||
        runtime.isHidden()
      )
        return;
      dirty = false;
      inFlight = true;
      const started = version;
      setState((prev) => ({
        scope,
        items: prev.scope === scope ? prev.items : [],
        phase: "syncing",
        complete: prev.scope === scope && prev.complete,
      }));
      try {
        const reply = await client.call<{
          interactions: MobilePendingPermission[];
          complete: boolean;
        }>("interaction/pending_all", {});
        if (disposed || started !== version) return;
        if (
          !reply ||
          !isPendingPermissions(reply.interactions) ||
          typeof reply.complete !== "boolean"
        )
          throw new Error("Invalid pending snapshot");
        setState({
          scope,
          items: reply.interactions,
          phase: "ready",
          complete: reply.complete,
        });
        // An incomplete snapshot cannot authoritatively delete missing prompts.
        if (reply.complete) onSnapshot(reply.interactions);
      } catch {
        if (!disposed && started === version)
          setState((prev) => ({
            ...prev,
            scope,
            items: prev.scope === scope ? prev.items : [],
            phase: "error",
          }));
      } finally {
        inFlight = false;
        if (!disposed && dirty)
          void read().catch((error) =>
            logger.warn("Background operation failed", error)
          );
      }
    };
    const invalidate = () => {
      version++;
      dirty = true;
      void read().catch((error) =>
        logger.warn("Background operation failed", error)
      );
    };
    refreshRef.current = invalidate;
    const unsubscribe = client?.onNotification((method) => {
      if (method === "interaction/pending_changed") invalidate();
    });
    const unwatch = runtime.subscribeVisibility(() => {
      if (!runtime.isHidden()) invalidate();
    });
    void read().catch((error) =>
      logger.warn("Background operation failed", error)
    );
    return () => {
      disposed = true;
      refreshRef.current = () => {};
      unsubscribe?.();
      unwatch();
    };
  }, [client, scope, online, supported, runtime, onSnapshot]);
  const scoped =
    state.scope === scope
      ? state
      : { items: [], phase: "syncing" as const, complete: false };
  return {
    ...scoped,
    phase: supported ? scoped.phase : "unsupported",
    refresh,
  };
}

const logger = createLogger("useMobilePendingInbox");
