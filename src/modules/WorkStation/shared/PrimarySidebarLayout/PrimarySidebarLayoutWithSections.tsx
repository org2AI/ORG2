/**
 * PrimarySidebarLayout Component
 *
 * Primary sidebar layout with collapsible, resizable sections.
 * Provides structure: Tabs -> Multiple collapsible sections
 *
 * Sections use grow for proportional sizing and resize by adjusting
 * the grow values of adjacent sections.
 *
 * Used by Workstation primary sidebars.
 *
 * PERFORMANCE (Jan 2026):
 * Uses lazy mounting - tabs only mount when first visited, then stay mounted
 * to preserve state. This prevents heavy components (Source Control, Search)
 * from initializing until needed.
 */
import React, {
  ReactNode,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";

import TabPill from "@src/components/TabPill";
import { NoDragRegion } from "@src/components/WindowChrome";
import { SIDEBAR_MEMORY_KIND, useSidebarMemoryEntry } from "@src/hooks/perf";

import { usePrimarySidebarSurface } from "../hooks/usePrimarySidebarSurface";
import CollapsibleSection from "./CollapsibleSection";

// ============================================
// Types
// ============================================

export interface PrimarySidebarTab {
  key: string;
  label: string;
  /** Tab icon (optional - when omitted, only label is shown) */
  icon?: ReactNode;
  /** Sections to display when this tab is active (optional when rawContent is used) */
  sections?: PanelSection[];
  /** Raw content to render instead of sections (for tabs with custom layout) */
  rawContent?: ReactNode;
}

export interface PanelSection {
  /** Unique key for the section */
  key: string;
  /** Section title */
  title: string | ReactNode;
  /** Section content */
  content: ReactNode;
  /** Initial grow value (proportional size) */
  defaultFlexGrow?: number;
  /** Whether the section starts collapsed */
  defaultCollapsed?: boolean;
  /** Whether the section can be collapsed */
  collapsible?: boolean;
  /** Whether the section can be resized */
  resizable?: boolean;
  /** Action buttons for the section header */
  actions?: import("@src/components/TreePanelSidebar/types").SectionHeaderAction[];
  /** Whether this section should use auto height instead of grow */
  autoHeight?: boolean;
  /** Optional icon for the section header */
  icon?: ReactNode;
  hideSeparator?: boolean;
  /** Stable selector for automated interaction with the section toggle. */
  headerTestId?: string;
}

export interface PrimarySidebarLayoutWithSectionsProps {
  /** Tab configuration */
  tabs: PrimarySidebarTab[];
  /** Active tab key */
  activeTab: string;
  /** Callback when tab changes */
  onTabChange: (tab: string) => void;
  /** When true, the tab pill row is not rendered (useful for single-tab sidebars) */
  hideTabs?: boolean;
}

// ============================================
// Main Component
// ============================================

export const PrimarySidebarLayoutWithSections: React.FC<PrimarySidebarLayoutWithSectionsProps> =
  memo(({ tabs, activeTab, onTabChange, hideTabs = false }) => {
    const { surfaceBgClass } = usePrimarySidebarSurface();
    const [mountedTabs, setMountedTabs] = useState<Set<string>>(
      () => new Set([activeTab])
    );
    const [, startTransition] = useTransition();

    useEffect(() => {
      if (!mountedTabs.has(activeTab)) {
        startTransition(() => {
          setMountedTabs((prev) => new Set([...prev, activeTab]));
        });
      }
    }, [activeTab, mountedTabs, startTransition]);

    // Track grow values for each section (per tab)
    // Initialize lazily - only for tabs that exist
    const [sectionSizes, setSectionSizes] = useState<
      Record<string, Record<string, number>>
    >(() => {
      const initial: Record<string, Record<string, number>> = {};
      tabs.forEach((tab) => {
        initial[tab.key] = {};
        (tab.sections ?? []).forEach((section) => {
          initial[tab.key][section.key] = section.defaultFlexGrow || 1;
        });
      });
      return initial;
    });

    // Track collapsed state for each section (per tab)
    const [collapsedSections, setCollapsedSections] = useState<
      Record<string, Record<string, boolean>>
    >(() => {
      const initial: Record<string, Record<string, boolean>> = {};
      tabs.forEach((tab) => {
        initial[tab.key] = {};
        (tab.sections ?? []).forEach((section) => {
          initial[tab.key][section.key] = section.defaultCollapsed || false;
        });
      });
      return initial;
    });

    // Track resize state
    const [resizeState, setResizeState] = useState<{
      tabKey: string;
      resizingIndex: number;
      startY: number;
      startSizes: Record<string, number>;
    } | null>(null);

    // Handle collapse change
    const handleCollapseChange = useCallback(
      (tabKey: string, sectionKey: string, collapsed: boolean) => {
        setCollapsedSections((prev) => ({
          ...prev,
          [tabKey]: {
            ...prev[tabKey],
            [sectionKey]: collapsed,
          },
        }));
      },
      []
    );

    // Handle resize start
    const handleResizeStart = useCallback(
      (tabKey: string, sectionIndex: number) => (event: React.MouseEvent) => {
        event.preventDefault();
        setResizeState({
          tabKey,
          resizingIndex: sectionIndex,
          startY: event.clientY,
          startSizes: { ...sectionSizes[tabKey] },
        });
      },
      [sectionSizes]
    );

    // Handle resize
    useEffect(() => {
      if (!resizeState) return;

      const tab = tabs.find((tabItem) => tabItem.key === resizeState.tabKey);
      if (!tab || !tab.sections) return;

      const handleMouseMove = (event: MouseEvent) => {
        const deltaY = event.clientY - resizeState.startY;
        const containerHeight = 600; // Approximate available height for sections
        const deltaFlex = (deltaY / containerHeight) * 2; // Convert pixels to flex ratio

        const sections = tab.sections!;
        const currentSection = sections[resizeState.resizingIndex];
        const nextSection = sections[resizeState.resizingIndex + 1];

        if (!currentSection || !nextSection) return;

        // Check if either section is collapsed
        if (
          collapsedSections[resizeState.tabKey]?.[currentSection.key] ||
          collapsedSections[resizeState.tabKey]?.[nextSection.key]
        ) {
          return;
        }

        // Calculate new sizes
        const currentNewSize = Math.max(
          0.2,
          resizeState.startSizes[currentSection.key] + deltaFlex
        );
        const nextNewSize = Math.max(
          0.2,
          resizeState.startSizes[nextSection.key] - deltaFlex
        );

        setSectionSizes((prev) => ({
          ...prev,
          [resizeState.tabKey]: {
            ...prev[resizeState.tabKey],
            [currentSection.key]: currentNewSize,
            [nextSection.key]: nextNewSize,
          },
        }));
      };

      const handleMouseUp = () => {
        setResizeState(null);
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";

      return () => {
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };
    }, [resizeState, tabs, collapsedSections]);

    // PERFORMANCE: Filter to only render tabs that have been mounted
    // This prevents heavy components from initializing until the tab is visited
    const tabsToRender = useMemo(
      () =>
        tabs.filter((tab) => mountedTabs.has(tab.key) || tab.key === activeTab),
      [activeTab, tabs, mountedTabs]
    );

    const activeTabConfig = tabs.find((tab) => tab.key === activeTab);
    const mountedSectionCount = tabsToRender.reduce(
      (sum, tab) => sum + (tab.sections?.length ?? (tab.rawContent ? 1 : 0)),
      0
    );
    const activeLabel =
      typeof activeTabConfig?.label === "string"
        ? activeTabConfig.label
        : activeTab;

    useSidebarMemoryEntry({
      kind: SIDEBAR_MEMORY_KIND.SECOND_LEVEL,
      label: activeLabel,
      items: tabs.length + mountedSectionCount,
      sections: mountedSectionCount,
      tabs: tabs.length,
      source: {
        activeTab,
        mountedTabs: Array.from(mountedTabs),
        tabs: tabs.map((tab) => ({
          key: tab.key,
          label: tab.label,
          sectionKeys: tab.sections?.map((section) => section.key) ?? [],
          hasRawContent: Boolean(tab.rawContent),
        })),
      },
    });

    return (
      <div
        className={`station-sidebar-scroll-area flex h-full min-h-0 w-full flex-col ${surfaceBgClass}`}
      >
        {/* Tab pills: transparent chrome (no banded fill) */}
        <div
          className="flex shrink-0 flex-col bg-transparent"
          data-tauri-drag-region
          style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
        >
          {/* Tabs row */}
          {!hideTabs && (
            <div className="relative flex h-[40px] shrink-0 items-center bg-transparent">
              <NoDragRegion className="mx-auto flex items-center justify-center gap-1">
                <TabPill
                  activeTab={activeTab}
                  tabs={tabs}
                  onChange={(key) => onTabChange(key)}
                  variant="pill"
                  fillWidth={false}
                  iconOnly
                  size="small"
                  className="bg-transparent"
                />
              </NoDragRegion>
            </div>
          )}
        </div>

        {/* PERFORMANCE: Render the active tab immediately, then keep previously visited tabs mounted hidden. */}
        {tabsToRender.map((tab) => {
          const isActive = tab.key === activeTab;
          const tabSizes = sectionSizes[tab.key] || {};
          const tabCollapsed = collapsedSections[tab.key] || {};

          return (
            <div
              key={tab.key}
              className={`flex min-h-0 flex-1 flex-col ${isActive ? "" : "hidden"}`}
            >
              {/* Use rawContent if provided, otherwise render sections */}
              {tab.rawContent
                ? tab.rawContent
                : (tab.sections ?? []).map((section, index) => (
                    <CollapsibleSection
                      key={section.key}
                      title={section.title}
                      flexGrow={tabSizes[section.key] || 1}
                      resizable={section.resizable !== false}
                      isLast={index === (tab.sections ?? []).length - 1}
                      collapsed={tabCollapsed[section.key]}
                      collapsible={section.collapsible !== false}
                      onCollapseChange={(collapsed) =>
                        handleCollapseChange(tab.key, section.key, collapsed)
                      }
                      actions={section.actions}
                      onResizeStart={handleResizeStart(tab.key, index)}
                      autoHeight={section.autoHeight}
                      hideSeparator={section.hideSeparator}
                      headerTestId={section.headerTestId}
                    >
                      {section.content}
                    </CollapsibleSection>
                  ))}
            </div>
          );
        })}
      </div>
    );
  });

PrimarySidebarLayoutWithSections.displayName =
  "PrimarySidebarLayoutWithSections";

export default PrimarySidebarLayoutWithSections;
