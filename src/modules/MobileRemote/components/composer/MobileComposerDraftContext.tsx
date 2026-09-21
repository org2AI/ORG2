import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
} from "react";

import { createMobileComposerDraftStore } from "./mobileComposerDraftStore";
import type {
  MobileComposerDraftHandle,
  MobileComposerDraftStore,
} from "./mobileComposerDraftStore";

export const MobileComposerDraftContext =
  createContext<MobileComposerDraftStore | null>(null);

export function useMobileComposerDraft(
  scope = "standalone",
  providedHandle?: MobileComposerDraftHandle
) {
  const owner = useContext(MobileComposerDraftContext);
  // Standalone composers (tests/embeds) remain isolated, not module-global.
  const local = useMemo(() => createMobileComposerDraftStore(), []);
  useEffect(() => () => local.clear(), [local]);
  const store = owner ?? local;
  const handle = useMemo(
    () => providedHandle ?? store.scope(scope),
    [providedHandle, store, scope]
  );
  const snapshot = useSyncExternalStore(
    handle.subscribe,
    handle.getSnapshot,
    handle.getSnapshot
  );
  return { handle, snapshot };
}
