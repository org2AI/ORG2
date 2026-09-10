import { useCallback, useSyncExternalStore } from "react";

import {
  getShortcutOverrides,
  subscribeShortcutBindings,
} from "./shortcutBindings";
import {
  type ShortcutDisplayOptions,
  getShortcutKeys,
} from "./shortcutDisplay";

export function useShortcutBindings() {
  return useSyncExternalStore(
    subscribeShortcutBindings,
    getShortcutOverrides,
    getShortcutOverrides
  );
}
const noSubscription = () => () => {};
export function useShortcutKeys(
  id: string,
  options?: ShortcutDisplayOptions
): string {
  const platform = options?.platform;
  const chatSendOnEnter = options?.chatSendOnEnter;
  const snapshot = useCallback(
    () => getShortcutKeys(id, { platform, chatSendOnEnter }),
    [id, platform, chatSendOnEnter]
  );
  return useSyncExternalStore(
    id ? subscribeShortcutBindings : noSubscription,
    snapshot,
    snapshot
  );
}
