/**
 * WorkStation Shared Components
 *
 * Components shared across CodeEditor and Browser.
 */

// Layout shell
export { WorkStationShell } from "./WorkStationShell";

// Shell configuration
export { buildPrimarySidebarConfig } from "./WorkStationShell/config";
export type { PrimarySidebarConfig } from "./WorkStationShell/config";

// Shared panel tab-bar chrome (position-aware tab header + position toggle)
export { default as PanelTabBar, PanelPositionToggle } from "./PanelTabBar";
export type { PanelTabBarTab } from "./PanelTabBar";

export { TerminalInfoButton } from "./TerminalInfoButton";
export { TerminalNewSessionSplitButton } from "./TerminalNewSessionSplitButton";

// Diff display
export type { DiffFileSectionData } from "./DiffFileSection";
export { default as DiffSectionList } from "./DiffSectionList";
export type { DiffSectionListViewState } from "./DiffSectionList";
export { default as DiffFileNavigationList } from "./DiffFileNavigationList";
export type { DiffFileNavigationItem } from "./DiffFileNavigationList";
export {
  buildConsolidatedSessionReplayDiffSectionItems,
  buildSessionReplayDiffSectionItems,
} from "./DiffSectionList/sessionReplaySections";

// Count badges (for diagnostic counts: errors, warnings, etc.)
export { CountBadge } from "./CountBadge";

// Primary sidebar layout
export {
  PrimarySidebarLayout,
  PrimarySidebarLayoutWithSections,
} from "./PrimarySidebarLayout";
export type { PrimarySidebarTab } from "./PrimarySidebarLayout";

// Reusable sidebar modules (tab-specific sidebar substrate) are NOT
// re-exported here on purpose: `./SidebarModules/index.ts` evaluates the
// Terminal/Benchmark/SourceControl tab sidebars (module-side-effect
// registrations), which pulls xterm + engines/TerminalCore into every
// consumer of this barrel. Hosts import from
// `@src/modules/WorkStation/shared/SidebarModules` directly (see
// CodeEditor/index.tsx, which also carries the side-effect import).

// Tab bar
export { TabBar } from "./TabBar";
export type { WorkStationTab } from "./TabBar";

// File header with breadcrumb navigation (relocated to shared)
export { default as FileHeader } from "@src/features/FileHeader";

export { default as GitFileList } from "./GitFileList";
export {
  gitFileListWidthAtom,
  GIT_FILE_LIST_MAX_WIDTH,
  GIT_FILE_LIST_MIN_WIDTH,
} from "./GitFileList/widthAtom";

// Floating bar (unsaved changes, review next, etc.)
export { FloatingBar, UnsavedChangesBar } from "./UnsavedChangesBar";

// Quick action item type (rendered by NoTabsPlaceholder)
export type { QuickAction } from "./QuickActionsPanel/types";

// No tabs placeholder (with quick actions)
export { NoTabsPlaceholder } from "./NoTabsPlaceholder";

export {
  useSimulatorAwaitingAgentCaption,
  useSimulatorPlaceholderActions,
} from "./useSimulatorPlaceholderActions";
export type { SessionReplayPlaceholderMode } from "./useSimulatorPlaceholderActions";

// Session-replay shared building blocks (tab bar, sidebar selection helpers, …)
export {
  ReplayShellLayout,
  SimulatorReplayChrome,
  capNewestWithActive,
  mergeNewestFirstByTimestamp,
  type ReplayTab,
  type TimestampedReplayTab,
} from "./SessionReplay";

// Station-mode chip + product-bound app-switcher wrappers.
// The shared chip view (AppSwitcherChip), its dropdown panel, the
// AppSwitcherMenuItem/AppSwitcherChipData types, and the
// useSimulatorAppSwitcher data hook are internal to AppSwitcherWrappers and
// are no longer re-exported here — nothing outside imports them from the
// barrel. SimulatorTabBarLeading is imported directly from
// ./AppSwitcherWrappers by SessionReplay, so it is not re-exported either.
export { StationModeChip } from "./StationModeChip";
export {
  SimulatorAgentChip,
  WorkStationTabBarLeading,
} from "./AppSwitcherWrappers";

// Sidebar collapse toggle (lives in tab bar trailing slots)
export { WorkStationSidebarToggleButton } from "./SidebarToggleButton";

// Header and typography tokens (shared dimensions, button styles, class strings)
export {
  WORK_STATION_PLACEHOLDER_PAGE_BG_CLASS,
  HEADER_ICON_SIZE,
} from "@src/config/workstation/tokens";

// Text tokens (i18n keys for Workstation)
export { HUMANTOOLS_TEXT_KEYS } from "./textTokens";

export type { CommitInfo, CursorPosition } from "./StatusBar";
