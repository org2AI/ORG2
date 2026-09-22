/**
 * useSelectedFile Hook
 *
 * SINGLE SOURCE OF TRUTH for file selection across the editor.
 *
 * The active editor tab is THE source of truth for which file is selected.
 * Panels (Explorer, Search) read the selected file through this hook instead
 * of keeping competing local selections; selecting a file anywhere opens a
 * tab, which becomes the new selection.
 *
 * Uses workstationLayoutAtom (via activeWorkStationFilePathAtom) as the
 * single source of truth.
 */
import { useAtomValue } from "jotai";

import { activeWorkStationFilePathAtom } from "@src/store/workstation/tabs";

export interface UseSelectedFileReturn {
  /** Currently selected file path (from active tab in the unified mainPane) */
  selectedFilePath: string | null;
}

/**
 * Hook providing the single source of truth for file selection.
 *
 * Usage:
 * ```tsx
 * const { selectedFilePath } = useSelectedFile();
 * ```
 */
export function useSelectedFile(): UseSelectedFileReturn {
  const selectedFilePath = useAtomValue(activeWorkStationFilePathAtom);
  return { selectedFilePath };
}
