/**
 * Performance Hooks
 *
 * Provides React hooks for:
 * - Debouncing callbacks (useDebouncedCallback)
 */

export { useDebouncedCallback, DEBOUNCE_DELAYS } from "./useDebouncedCallback";
export { formatRuntimeBytes, useRuntimeRamStats } from "./useRuntimeRamStats";
export {
  SIDEBAR_MEMORY_KIND,
  collectWebViewRuntimeDiagnostics,
  getLoadedScriptSourceStats,
  type LoadedScriptSourceStats,
  type WebViewRuntimeDiagnostics,
} from "./runtimeMemoryStats";
export { useSidebarMemoryEntry } from "./useSidebarMemoryEntry";
export {
  describeAppMemoryMeasurement,
  refreshAppMemorySnapshot,
  getAppMemoryRoleLabelKey,
  getAppMemoryTotals,
  useAppMemorySnapshot,
  type AppMemorySnapshotState,
  type AppMemorySnapshot,
} from "./appMemorySnapshot";
