import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import type { MobileRpcClient } from "../connection/mobileRpcClient";
import {
  type MobileReadStateSync,
  createMobileReadStateSync,
} from "./mobileReadStateSync";

export function useMobileReadStateSync(
  client: MobileRpcClient | null,
  scope: string
) {
  const sync = useMemo(() => createMobileReadStateSync(), []);
  useLayoutEffect(() => {
    sync.connect(client, scope);
    return () => sync.connect(null, scope);
  }, [client, scope, sync]);
  useEffect(() => () => sync.dispose(), [sync]);
  return sync;
}

const emptyVisited: ReadonlyMap<string, boolean> = new Map();
const emptySnapshot = () => emptyVisited;
const emptySubscribe = () => () => undefined;

/** Only the visible session list subscribes, not the entire connection/chat provider. */
export function useMobileVisitedSessions(
  sync: MobileReadStateSync | undefined
) {
  return useSyncExternalStore(
    sync?.subscribe ?? emptySubscribe,
    sync?.getSnapshot ?? emptySnapshot,
    sync?.getSnapshot ?? emptySnapshot
  );
}
