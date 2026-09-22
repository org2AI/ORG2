import { useSetAtom, useStore } from "jotai";
import { useEffect, useRef } from "react";

import type { RunningLocation } from "@src/config/sessionCreatorConfig";
import {
  branchSelectorOpenAtom,
  locationSelectorOpenAtom,
  repoSelectorOpenAtom,
} from "@src/store/ui/overlayAtom";

interface SelectorShortcutBridgeState {
  disabled: boolean;
  showBranchRow: boolean;
  repoId?: string;
  worktreeLocation?: RunningLocation;
  isLocationDropdownOpen: boolean;
  openLocationSelector: () => void;
}

interface SelectorShortcutBridgeParams extends SelectorShortcutBridgeState {
  openBranchSelector: () => void;
  openRepoSelector: () => void;
}

export function useSelectorShortcutBridge({
  disabled,
  showBranchRow,
  repoId,
  worktreeLocation,
  isLocationDropdownOpen,
  openLocationSelector,
  openBranchSelector,
  openRepoSelector,
}: SelectorShortcutBridgeParams): void {
  const store = useStore();
  const setGlobalBranchSelectorOpen = useSetAtom(branchSelectorOpenAtom);
  const setGlobalRepoSelectorOpen = useSetAtom(repoSelectorOpenAtom);
  const setGlobalLocationSelectorOpen = useSetAtom(locationSelectorOpenAtom);

  // Latest gating flags + handlers accessed from the store subscription.
  // The subscription registers once per `store` instance; without a ref we
  // would have to re-subscribe on every prop change. The ref body is
  // refreshed in an effect (writing `.current` in render is disallowed by
  // the React Compiler `refs` rule).
  const bridgeStateRef = useRef<SelectorShortcutBridgeState>({
    disabled,
    showBranchRow,
    repoId,
    worktreeLocation,
    isLocationDropdownOpen,
    openLocationSelector,
  });

  useEffect(() => {
    bridgeStateRef.current = {
      disabled,
      showBranchRow,
      repoId,
      worktreeLocation,
      isLocationDropdownOpen,
      openLocationSelector,
    };
  });

  // Bridge global shortcut atoms (⌘., ⌥⌘., ⇧⌘.) → local dropdown state.
  // The atoms behave as one-shot signals: a shortcut handler flips them to
  // true, this component consumes the edge, opens the matching dropdown,
  // and flips the atom back to false so a second press re-triggers.
  //
  // We subscribe to the Jotai store directly (outside the React render
  // tree) rather than reading the atom via `useAtomValue` + `useEffect`.
  // That avoids the React Compiler `set-state-in-effect` rule, because
  // the setState calls run from a store subscription callback — the same
  // category as a DOM event listener — instead of synchronously inside a
  // render effect.
  useEffect(() => {
    const unsubBranch = store.sub(branchSelectorOpenAtom, () => {
      if (!store.get(branchSelectorOpenAtom)) return;
      setGlobalBranchSelectorOpen(false);
      const s = bridgeStateRef.current;
      if (s.disabled || !s.showBranchRow || !s.repoId) return;
      openBranchSelector();
    });
    const unsubRepo = store.sub(repoSelectorOpenAtom, () => {
      if (!store.get(repoSelectorOpenAtom)) return;
      setGlobalRepoSelectorOpen(false);
      const s = bridgeStateRef.current;
      if (s.disabled) return;
      openRepoSelector();
    });
    const unsubLocation = store.sub(locationSelectorOpenAtom, () => {
      if (!store.get(locationSelectorOpenAtom)) return;
      setGlobalLocationSelectorOpen(false);
      const s = bridgeStateRef.current;
      if (s.disabled || s.worktreeLocation === undefined) return;
      if (s.isLocationDropdownOpen) return;
      s.openLocationSelector();
    });
    return () => {
      unsubBranch();
      unsubRepo();
      unsubLocation();
    };
  }, [
    store,
    setGlobalBranchSelectorOpen,
    setGlobalRepoSelectorOpen,
    setGlobalLocationSelectorOpen,
    openBranchSelector,
    openRepoSelector,
  ]);
}
