/**
 * Settings value atoms: the in-memory read side of the settings store.
 *
 * Kept free of Tauri and the logger so browser-safe shared components (the
 * mobile remote's auth screen renders `PageNotice`, whose buttons use the
 * settings-timed `Tooltip`) can read a setting without pulling the
 * file-backed persistence layer in `settingsAtom.ts` into their graph.
 * Outside the desktop app the atom simply keeps its defaults.
 */
import { type Atom, atom } from "jotai";

import {
  type SettingValue,
  type SettingsKey,
  type SettingsObject,
  getSettingsDefaults,
} from "@src/config/settingsSchema";

// ============================================
// Core Atom
// ============================================

/**
 * The central settings atom.
 * Initialized with defaults; hydrated from file during app startup.
 */
export const settingsAtom = atom<SettingsObject>(getSettingsDefaults());
settingsAtom.debugLabel = "settingsAtom";

// ============================================
// Read-only atom for a single setting
// ============================================

/**
 * Create a derived read-only atom for a specific setting key.
 * Results are cached so the same key always returns the same atom instance,
 * which is critical for stable Jotai subscriptions (avoids re-mount loops).
 *
 * Usage:
 *   const fontSizeAtom = settingAtom("editor.fontSize");
 *   const fontSize = useAtomValue(fontSizeAtom); // 13
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const settingAtomCache = new Map<string, Atom<any>>();

export function settingAtom<K extends SettingsKey>(
  key: K
): Atom<SettingValue<K>> {
  const cached = settingAtomCache.get(key);
  if (cached) return cached as Atom<SettingValue<K>>;

  const derived = atom<SettingValue<K>>((get) => {
    const settings = get(settingsAtom);
    return settings[key];
  });
  derived.debugLabel = `setting:${key}`;
  settingAtomCache.set(key, derived);
  return derived;
}
