import { useEffect } from "react";

import Message from "@src/components/Message";
import { syncNativeShortcuts } from "@src/config/keyboard/nativeShortcutSync";
import { subscribeShortcutBindings } from "@src/config/keyboard/shortcutBindings";
import i18n from "@src/i18n";

export function useCustomizedShortcuts() {
  useEffect(() => {
    let active = true;
    const sync = () => {
      void syncNativeShortcuts().catch(() => {
        if (active)
          Message.error(i18n.t("settings:shortcuts.nativeSyncFailed"));
      });
    };
    const unsubscribe = subscribeShortcutBindings(sync);
    sync();
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
}
