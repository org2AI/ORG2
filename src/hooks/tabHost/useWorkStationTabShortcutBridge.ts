/**
 * Bridges the global ⌘W (dispatched as a custom event from `useTabShortcuts`)
 * into the Workstation content host that owns the active tab.
 *
 * # Why the host has to be part of the condition
 *
 * The bridge listens on `window`, so every mounted host hears every event.
 * The AppShell deliberately keeps previously-visited hosts mounted-but-hidden
 * so tab switches stay instant (see `hostMountPolicy.ts`), which means two or
 * three hosts are commonly listening at once. A bridge that registered on
 * mount alone would run several close handlers for one keystroke — closing a
 * tab the user cannot see, in a host they are not looking at.
 *
 * Callers therefore declare which host they are, and the bridge compares that
 * against `activeHostAtom` rather than trusting each call site to derive its
 * own "am I active" flag. Making it a required input is the point: the
 * previous contract was an optional `enabled` boolean, and two of the three
 * call sites passed a bare `true`.
 */
import { useAtomValue } from "jotai";
import { useEffect } from "react";

import {
  type WorkstationTabHost,
  activeHostAtom,
} from "@src/store/workstation/tabHost";

export interface WorkStationTabShortcutBridgeOptions {
  /** The content host registering this handler. */
  host: WorkstationTabHost;
  /**
   * Extra gate for hosts with their own notion of being live. ANDed with the
   * active-host check; it can never widen the condition. Defaults to `true`.
   */
  enabled?: boolean;
  onCloseActiveTab: () => void;
}

const WORKSTATION_CLOSE_ACTIVE_TAB = "workstation-close-active-tab";

export function useWorkStationTabShortcutBridge(
  options: WorkStationTabShortcutBridgeOptions
): void {
  const { host, enabled = true, onCloseActiveTab } = options;
  const activeHost = useAtomValue(activeHostAtom);
  const listening = enabled && activeHost === host;

  useEffect(() => {
    if (!listening) return;

    const handleClose = () => {
      onCloseActiveTab();
    };
    window.addEventListener(WORKSTATION_CLOSE_ACTIVE_TAB, handleClose);
    return () => {
      window.removeEventListener(WORKSTATION_CLOSE_ACTIVE_TAB, handleClose);
    };
  }, [listening, onCloseActiveTab]);
}
