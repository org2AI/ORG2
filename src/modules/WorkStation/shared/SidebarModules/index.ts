/**
 * Sidebar Modules
 *
 * Reusable, self-contained sidebar tabs that can be mounted in any
 * `PrimarySidebarLayoutWithSections` host. Each module owns its own state,
 * actions, refs and dropdowns; callers pass only domain inputs (e.g.
 * `repoPath`).
 *
 * This is the substrate for the "tab-specific sidebar" pattern: each tab
 * declares (via `TAB_SIDEBAR_REGISTRY`) which sidebar component to render
 * when active, and `SidebarSlot` resolves it. Tabs
 * without a registered sidebar fall through to the host's default sidebar.
 */
// Side-effect only: evaluating `./Terminal` runs
// `registerTabSidebar("terminal", …)`. `TerminalTabSidebar` is resolved
// through the registry, never imported by name, so there is nothing to
// re-export — but deleting this line silently unregisters the terminal
// sidebar and the tab falls back to the host's default sidebar at runtime.
import "./Terminal";

// Evaluating `./SourceControl` is what runs
// `registerTabSidebar("source-control", …)`; `SidebarSlot` resolves the
// component out of the registry, so the component itself is never imported
// by name. Keep this import even if every named export below goes away.
export {
  SourceControlFilterHeader,
  type SourceControlFilterCounts,
  type SourceControlFilterMode,
} from "./SourceControl";

export {
  registerTabSidebar,
  getTabSidebarDescriptor,
  hasTabSidebar,
  type TabSidebarComponent,
  type TabSidebarProps,
  type TabSidebarRuntimeContext,
} from "./registry";

export { SidebarSlot } from "./SidebarSlot";
