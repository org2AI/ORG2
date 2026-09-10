/**
 * Unified Tab Content — types
 *
 * Every renderer registered in `registry.ts` is a tiny wrapper that accepts the same
 * `UnifiedTabContentProps` and adapts the generic `WorkStationTab` into
 * whatever the underlying view component expects.
 *
 * Renderer wrappers are intentionally narrow: they own ONLY the
 * `tab.data` → component-props adaptation. Host concerns (atoms, contexts,
 * ActionSystem wiring) stay outside this layer in the content hosts.
 */
import type { ComponentType, LazyExoticComponent } from "react";

import type {
  WorkStationTab,
  WorkStationTabType,
} from "@src/store/workstation/tabs/types";

export interface UnifiedTabContentProps<
  TTab extends WorkStationTab = WorkStationTab,
> {
  /** The tab whose content this renderer is responsible for. */
  tab: TTab;
  /** ID of the pane that owns this tab (for split-pane awareness). */
  /** Whether this tab is the active tab in its pane. */
  isActive: boolean;
}

export interface RendererEntry {
  /** Lazy component that renders this tab's content. */
  Component: LazyExoticComponent<ComponentType<UnifiedTabContentProps>>;
}

export type TabContentRegistry = Record<WorkStationTabType, RendererEntry>;
