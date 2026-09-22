/**
 * useEditorRepoCacheSync Hook
 *
 * Syncs editor tab cache with repo changes.
 * When the selected repo changes, this hook:
 * 1. Saves current file tabs to cache
 * 2. Restores cached file tabs for new repo
 * 3. Keeps tool tabs (terminal, browser) in place
 *
 * Should be used at the app level (in CodeEditor or similar).
 *
 * Created: 2026-01-29
 */
import { useAtomValue } from "jotai";
import { useEffect, useRef } from "react";

import { activeWorkspaceRootPathAtom } from "@src/store/workspace";

import { useEditorCache } from "./useEditorCache";

// ============================================
// Hook
// ============================================

/**
 * Syncs editor tab cache when repo changes
 *
 * Usage:
 * ```tsx
 * // In CodeEditor or app-level component
 * useEditorRepoCacheSync();
 * ```
 */
export function useEditorRepoCacheSync(): void {
  const repoPath = useAtomValue(activeWorkspaceRootPathAtom) || null;

  // Editor cache hook
  const { switchRepo } = useEditorCache();

  // Track previous repo to detect changes
  const prevRepoPathRef = useRef<string | null>(null);
  const isInitializedRef = useRef(false);

  useEffect(() => {
    if (!repoPath) return;

    // Skip if same repo
    if (repoPath === prevRepoPathRef.current) return;

    // On first run, just set the initial repo without switching
    if (!isInitializedRef.current) {
      isInitializedRef.current = true;
      prevRepoPathRef.current = repoPath;

      // Just update the active repo atom without switching tabs
      // (tabs will load from existing workStationTabs state)
      return;
    }

    // Repo changed - switch and cache
    prevRepoPathRef.current = repoPath;
    switchRepo(repoPath);
  }, [repoPath, switchRepo]);
}
