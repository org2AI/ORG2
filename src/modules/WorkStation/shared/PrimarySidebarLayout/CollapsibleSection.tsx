/**
 * CollapsibleSection Component
 *
 * A resizable, collapsible section for panel layouts.
 * Used to create multiple stacked sections (Files, Outline, etc.)
 * Uses grow for proportional space distribution.
 *
 * Shared by: CodeEditor, Browser
 */
import React, { memo, useCallback, useState } from "react";

import Button from "@src/components/Button";
import { SidebarSectionHeader } from "@src/components/SidebarSectionHeader";
import {
  type SectionHeaderAction,
  isSectionHeaderCustomAction,
} from "@src/components/TreePanelSidebar/types";
import { TreeRowActionGroup } from "@src/components/TreeRow/TreeRowActionGroup";
import { HorizontalResizeHandle } from "@src/scaffold/Resize";

import { SectionHeaderActionsContext } from "./SectionHeaderActions";

// ============================================
// Types
// ============================================

export interface CollapsibleSectionProps {
  /** Section title */
  title: string | React.ReactNode;
  /** Section content */
  children: React.ReactNode;
  /** Whether the section is collapsed */
  collapsed?: boolean;
  /** Callback when collapse state changes */
  onCollapseChange?: (collapsed: boolean) => void;
  /** Whether the section can be collapsed */
  collapsible?: boolean;
  /** Flex grow value (proportional size) */
  flexGrow?: number;
  /** Whether this section can be resized */
  resizable?: boolean;
  /** Whether this section is the last one (no resize handle at bottom) */
  isLast?: boolean;
  /** Action buttons for the section header */
  actions?: SectionHeaderAction[];
  /** Callback when resize starts */
  onResizeStart?: (event: React.MouseEvent) => void;
  /** Whether this section should use auto height instead of grow */
  autoHeight?: boolean;
  hideSeparator?: boolean;
  /** Stable selector for automated interaction with the section toggle. */
  headerTestId?: string;
}

// ============================================
// Main Component
// ============================================

export const CollapsibleSection: React.FC<CollapsibleSectionProps> = memo(
  ({
    title,
    children,
    collapsed = false,
    onCollapseChange,
    collapsible = true,
    flexGrow = 1,
    resizable = true,
    isLast = false,
    actions = [],
    onResizeStart,
    autoHeight = false,
    hideSeparator = false,
    headerTestId,
  }) => {
    const [actionsHost, setActionsHost] = useState<HTMLDivElement | null>(null);
    const effectiveCollapsed = collapsible ? collapsed : false;

    // Handle collapse toggle
    const handleToggle = useCallback(() => {
      if (!collapsible) return;
      onCollapseChange?.(!effectiveCollapsed);
    }, [collapsible, effectiveCollapsed, onCollapseChange]);

    // Handle resize start
    const handleResizeStart = useCallback(
      (event: React.MouseEvent) => {
        if (!resizable || isLast || effectiveCollapsed || autoHeight) return;
        event.preventDefault();
        onResizeStart?.(event);
      },
      [resizable, isLast, effectiveCollapsed, autoHeight, onResizeStart]
    );

    // Calculate style based on autoHeight flag
    const sectionStyle: React.CSSProperties = effectiveCollapsed
      ? {
          flexGrow: 0,
          flexShrink: 0,
          flexBasis: "auto",
          minHeight: "auto",
        }
      : autoHeight
        ? {
            flexGrow: 0,
            flexShrink: 0,
            flexBasis: "auto",
            minHeight: "auto",
          }
        : {
            flexGrow: flexGrow,
            flexShrink: 0,
            flexBasis: 0,
            minHeight: "100px",
          };

    const showSeparator = !hideSeparator && !isLast;

    return (
      <div
        className={`group/section relative flex flex-col ${
          !autoHeight && !effectiveCollapsed ? "min-h-0" : ""
        }`}
        style={sectionStyle}
      >
        {showSeparator && (
          <div
            className="pointer-events-none absolute right-2 bottom-0 left-2 h-px bg-border-1"
            aria-hidden
          />
        )}
        {/* Header */}
        <SidebarSectionHeader
          surface="panel"
          title={title}
          expanded={!effectiveCollapsed}
          onToggle={collapsible ? handleToggle : undefined}
          toggleTestId={headerTestId}
          actionsAlwaysVisible
          actions={
            <>
              <div
                ref={setActionsHost}
                className="flex shrink-0 items-center gap-px"
              />
              {/* Action buttons - show on hover, or always when forceVisible */}
              {actions.length > 0 && (
                <TreeRowActionGroup
                  hoverGroup="section"
                  alwaysVisible={actions.some((action) => action.forceVisible)}
                >
                  {actions.map((action) => {
                    // Support custom rendering for complex actions (dropdowns, etc.)
                    if (isSectionHeaderCustomAction(action)) {
                      return <div key={action.key}>{action.customRender}</div>;
                    }

                    const hasLabel = !!action.label;
                    const button = (
                      <Button
                        variant="tertiary"
                        size="sidebar"
                        iconOnly={!hasLabel}
                        icon={action.icon}
                        aria-label={action.tooltip}
                        disabled={action.disabled}
                        onClick={(event) => {
                          event.stopPropagation();
                          action.onClick();
                        }}
                        title={action.tooltip}
                      >
                        {action.label}
                      </Button>
                    );

                    return <div key={action.key}>{button}</div>;
                  })}
                </TreeRowActionGroup>
              )}
            </>
          }
        />

        {/* Content - only render when not collapsed */}
        {!effectiveCollapsed && (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <SectionHeaderActionsContext.Provider value={actionsHost}>
              {children}
            </SectionHeaderActionsContext.Provider>
          </div>
        )}

        {/* Resize handle - only show when not collapsed, resizable, not auto height, and not last */}
        {!effectiveCollapsed && resizable && !autoHeight && !isLast && (
          <HorizontalResizeHandle
            variant="transparent"
            onMouseDown={handleResizeStart}
          />
        )}
      </div>
    );
  }
);

CollapsibleSection.displayName = "CollapsibleSection";

export default CollapsibleSection;
